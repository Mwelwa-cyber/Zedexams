/**
 * Agent dispatcher — Firestore triggers that drive the Content pipeline.
 *
 * Two triggers:
 *   1. agentJobsOnCreate (onDocumentCreated('agentJobs/{id}'))
 *      Runs the Aria → Cala → Reva chain sequentially in a single
 *      execution. After Reva, sets status='awaiting_approval' so a human
 *      admin can decide in /admin/agents.
 *
 *   2. agentJobsOnApproved (onDocumentUpdated('agentJobs/{id}'))
 *      Fires when status flips to 'approved'. Runs Pubo → flips the
 *      reserved aiGenerations doc from private to public, stamps
 *      approval metadata, and sets status='done'. On 'rejected', no
 *      side effects beyond the status change.
 *
 * Guardrails:
 *   - Per-agent circuit breaker via agentControl/{agentId}.paused. A manual
 *     admin pause and an AUTOMATIC trip both set this flag: each runner
 *     failure is recorded against agentControl/{agentId}, and at >=3 failures
 *     within ~1h (see circuitBreaker.js) the agent is paused automatically and
 *     ADMIN_EMAILS is emailed — so a runaway failing agent stops re-billing
 *     model calls and pages a human instead of failing silently forever.
 *   - Status transitions are guarded: each runner refuses to run twice.
 *   - Errors land in agentJobs.error with status='failed'; the UI
 *     surfaces a Retry path (Phase 3).
 */

const admin = require("firebase-admin");
const {onDocumentCreated, onDocumentUpdated} =
  require("firebase-functions/v2/firestore");

const {runAria} = require("./runners/aria");
const {runCala} = require("./runners/cala");
const {runReva} = require("./runners/reva");
const {runPubo} = require("./runners/pubo");
const {getUserRole, assertDailyLimit} = require("../aiService");
const {recordAgentFailure} = require("./circuitBreaker");
const {sendOpsAlert} = require("../opsAlert");

/**
 * Record a runner failure against the circuit breaker. On the trip transition
 * the breaker pauses the agent and we email ADMIN_EMAILS. Best-effort — never
 * throws, so the caller's own status='failed' handling is unaffected.
 */
async function noteAgentFailure(agentId, err) {
  const errorMessage = String((err && err.message) || err || "");
  await recordAgentFailure({
    db: admin.firestore(),
    agentId,
    errorMessage,
    fieldValue: admin.firestore.FieldValue,
    alert: async ({failuresInWindow}) => {
      await sendOpsAlert({
        title: `Agent "${agentId}" auto-paused by circuit breaker`,
        severity: "critical",
        lines: [
          `${agentId} hit ${failuresInWindow} failures within the breaker ` +
            "window and was paused automatically to stop re-billing model calls.",
          `Last error: ${errorMessage.slice(0, 300)}`,
          `Investigate, then clear agentControl/${agentId}.paused to resume.`,
        ],
      });
    },
  });
}

// Firestore-triggered functions must be collocated with the database to
// avoid a cross-region Eventarc hop on every event. The project's
// (default) Firestore database lives in africa-south1, so the trigger is
// created there regardless of where the function runs; pinning the
// function to africa-south1 too keeps compute next to the trigger
// (lower latency + no cross-region egress). HTTP/callable functions have
// no regional trigger and stay in us-central1 — see firebase.json.
const TRIGGER_OPTS = {
  document: "agentJobs/{jobId}",
  region: "africa-south1",
  timeoutSeconds: 300,
  memory: "512MiB",
};

// Cached snapshot of paused agentIds. Each content job triggers 3 pause
// checks (aria, cala, reva); without a cache that's 3 sequential Firestore
// reads per job in a hot path. Refresh the cache every 60s — agentControl
// only changes when an admin pauses an agent, so a minute of staleness is
// safe and saves ~95% of reads at burst.
const PAUSED_CACHE_TTL_MS = 60_000;
let pausedCache = {expiresAt: 0, paused: new Set()};

async function refreshPausedCache() {
  const snap = await admin.firestore()
    .collection("agentControl")
    .where("paused", "==", true)
    .get()
    .catch(() => null);
  const paused = new Set();
  if (snap && !snap.empty) {
    snap.forEach((doc) => paused.add(doc.id));
  }
  pausedCache = {expiresAt: Date.now() + PAUSED_CACHE_TTL_MS, paused};
  return pausedCache;
}

async function isAgentPaused(agentId) {
  if (Date.now() >= pausedCache.expiresAt) {
    await refreshPausedCache();
  }
  return pausedCache.paused.has(agentId);
}

async function setJobFields(jobRef, fields) {
  await jobRef.set({
    ...fields,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

/**
 * Run Aria → Cala → Reva in sequence. Each step writes its result back
 * to the agentJobs doc so the UI shows progress, and so a downstream
 * step can read the previous step's output.
 */
async function runContentChain({jobId, jobData, anthropicApiKeySecret}) {
  const db = admin.firestore();
  const jobRef = db.collection("agentJobs").doc(jobId);

  // Re-read for hand-off so each runner sees fresh state.
  async function readJob() {
    const snap = await jobRef.get();
    return {id: snap.id, ...(snap.data() || {})};
  }

  // 0. Per-user daily cap. agentJobs creation is a DIRECT client write
  // (firestore.rules only pins createdBy == auth.uid + status == queued —
  // no count constraint), and each chain is ~2 Sonnet calls (Aria + Reva)
  // with only a global pause kill-switch. Without this, one teacher
  // account could queue unlimited chains and run up unbounded Anthropic
  // spend. Count each chain against the same daily AI budget as
  // chat/explain/etc. (aiDailyLimits/{uid}_{day}); fail-closed so a metering
  // outage can't be used to bypass the cap. createdBy is server-trusted
  // (pinned by the create rule).
  const ownerUid = typeof jobData.createdBy === "string" ? jobData.createdBy : "";
  if (!ownerUid || ownerUid === "system") {
    await setJobFields(jobRef, {
      status: "failed",
      error: "Job has no valid owner (createdBy) — refusing to run.",
    });
    return;
  }
  try {
    const role = await getUserRole(ownerUid);
    await assertDailyLimit(ownerUid, role, "agentJob");
  } catch (err) {
    const exhausted = err && err.code === "resource-exhausted";
    await setJobFields(jobRef, {
      status: "failed",
      error: exhausted ?
        "Daily AI limit reached for this account — agent job not run. " +
          "Please try again tomorrow." :
        `Metering check failed: ${String(err && err.message || err).slice(0, 300)}`,
    });
    return;
  }

  // 1. Aria
  if (await isAgentPaused("aria")) {
    await setJobFields(jobRef, {
      status: "failed",
      error: "Aria is paused (agentControl/aria.paused = true).",
    });
    return;
  }
  await setJobFields(jobRef, {status: "running", agentId: "aria"});
  let ariaOut;
  try {
    ariaOut = await runAria({job: jobData, anthropicApiKeySecret});
  } catch (err) {
    console.error("Aria failed", err);
    await setJobFields(jobRef, {
      status: "failed",
      error: `Aria: ${String(err && err.message || err).slice(0, 500)}`,
    });
    await noteAgentFailure("aria", err);
    return;
  }
  await setJobFields(jobRef, {
    "output.aria": ariaOut,
    "publishedRefs": [
      {collection: "aiGenerations", docId: ariaOut.generationId},
    ],
  });

  // Aria "succeeded" but produced no usable draft — the underlying generator
  // returned a falsy value under the mapped draft key (aria.js maps it to
  // null). Cala and Reva have nothing to work on, so stop here and attribute
  // the failure to Aria. Letting it fall through to Cala would surface the
  // misleading "Aria must run first" AND trip CALA's circuit breaker for an
  // upstream problem — auto-pausing a healthy deterministic agent.
  if (!ariaOut.draft) {
    const err = new Error(
      "Aria produced an empty draft — the generator returned no content.",
    );
    await setJobFields(jobRef, {
      status: "failed",
      error: `Aria: ${err.message}`,
    });
    await noteAgentFailure("aria", err);
    return;
  }

  // 2. Cala
  if (await isAgentPaused("cala")) {
    await setJobFields(jobRef, {
      status: "awaiting_approval",
      error: "Cala is paused — review manually.",
    });
    return;
  }
  await setJobFields(jobRef, {agentId: "cala"});
  let calaOut;
  try {
    calaOut = await runCala({job: await readJob()});
  } catch (err) {
    console.error("Cala failed", err);
    await setJobFields(jobRef, {
      status: "failed",
      error: `Cala: ${String(err && err.message || err).slice(0, 500)}`,
    });
    await noteAgentFailure("cala", err);
    return;
  }
  await setJobFields(jobRef, {"output.cala": calaOut});

  // 3. Reva
  if (await isAgentPaused("reva")) {
    await setJobFields(jobRef, {
      status: "awaiting_approval",
      error: "Reva is paused — review manually.",
    });
    return;
  }
  await setJobFields(jobRef, {agentId: "reva"});
  let revaOut;
  try {
    revaOut = await runReva({job: await readJob(), anthropicApiKeySecret});
  } catch (err) {
    console.error("Reva failed", err);
    await setJobFields(jobRef, {
      status: "failed",
      error: `Reva: ${String(err && err.message || err).slice(0, 500)}`,
    });
    await noteAgentFailure("reva", err);
    return;
  }
  await setJobFields(jobRef, {
    "output.reva": revaOut,
    status: "awaiting_approval",
    agentId: "reva",
  });
}

/**
 * Resume a job at the Cala step. Used by the admin "Retry Cala" callable
 * when a previous Cala run failed (e.g. the matcher threw on malformed
 * KB data). Identical to steps 2-3 of runContentChain but additive — we
 * deliberately don't refactor runContentChain so existing dispatcher
 * trace tests continue to exercise the exact same code path.
 *
 * Caller has already verified: admin, status was 'failed', output.aria.draft
 * exists. Caller cleared error/status before calling.
 */
async function runFromCala({jobId, anthropicApiKeySecret}) {
  const db = admin.firestore();
  const jobRef = db.collection("agentJobs").doc(jobId);
  async function readJob() {
    const snap = await jobRef.get();
    return {id: snap.id, ...(snap.data() || {})};
  }

  // Cala.
  if (await isAgentPaused("cala")) {
    await setJobFields(jobRef, {
      status: "awaiting_approval",
      error: "Cala is paused — review manually.",
    });
    return;
  }
  await setJobFields(jobRef, {status: "running", agentId: "cala"});
  let calaOut;
  try {
    calaOut = await runCala({job: await readJob()});
  } catch (err) {
    console.error("Cala failed (retry)", err);
    await setJobFields(jobRef, {
      status: "failed",
      error: `Cala: ${String(err && err.message || err).slice(0, 500)}`,
    });
    await noteAgentFailure("cala", err);
    return;
  }
  await setJobFields(jobRef, {"output.cala": calaOut});

  // Reva.
  if (await isAgentPaused("reva")) {
    await setJobFields(jobRef, {
      status: "awaiting_approval",
      error: "Reva is paused — review manually.",
    });
    return;
  }
  await setJobFields(jobRef, {agentId: "reva"});
  let revaOut;
  try {
    revaOut = await runReva({job: await readJob(), anthropicApiKeySecret});
  } catch (err) {
    console.error("Reva failed (retry)", err);
    await setJobFields(jobRef, {
      status: "failed",
      error: `Reva: ${String(err && err.message || err).slice(0, 500)}`,
    });
    await noteAgentFailure("reva", err);
    return;
  }
  await setJobFields(jobRef, {
    "output.reva": revaOut,
    status: "awaiting_approval",
    agentId: "reva",
  });
}

/**
 * Factory for the onCreate trigger. The secret is passed in by index.js
 * (mirrors the createGenerateLessonPlan factory pattern).
 */
function createAgentJobsOnCreate(anthropicApiKeySecret, opsAlertSecrets = []) {
  return onDocumentCreated(
    {...TRIGGER_OPTS, secrets: [anthropicApiKeySecret, ...opsAlertSecrets]},
    async (event) => {
      const snap = event.data;
      if (!snap) return;
      const jobData = {id: snap.id, ...(snap.data() || {})};
      // Only the Content department's Aria-rooted pipeline runs here.
      if (jobData.department !== "content") return;
      if (jobData.agentId !== "aria") return;
      if (jobData.status !== "queued") return;
      // Ignore seed docs — they're for UI dev only.
      if (jobData.seed === true) return;

      await runContentChain({
        jobId: snap.id,
        jobData,
        anthropicApiKeySecret,
      });
    },
  );
}

/**
 * Factory for the onUpdate trigger that runs Pubo on approval.
 */
function createAgentJobsOnApproved(opsAlertSecrets = []) {
  return onDocumentUpdated(
    {...TRIGGER_OPTS, secrets: opsAlertSecrets},
    async (event) => {
      const before = event.data && event.data.before && event.data.before.data();
      const after = event.data && event.data.after && event.data.after.data();
      if (!before || !after) return;

      const jobId = event.params.jobId;

      // Audit hook — capture every approve / reject transition in the
      // admin audit log so the new /admin/activity page has data the
      // moment it's live. We write the entry before the publish work
      // so an in-flight Pubo failure still leaves a record of the
      // approval decision.
      try {
        const {writeAuditLog} = require("../auditLog");
        if (before.status !== "approved" && after.status === "approved") {
          await writeAuditLog({
            actorUid: after.reviewedBy || "system",
            action: "agent.approve",
            targetType: "agentJob",
            targetId: jobId,
            metadata: {agentId: after.agentId || null, department: after.department || null},
          });
        }
        if (before.status !== "rejected" && after.status === "rejected") {
          await writeAuditLog({
            actorUid: after.reviewedBy || "system",
            action: "agent.reject",
            targetType: "agentJob",
            targetId: jobId,
            metadata: {agentId: after.agentId || null, reason: after.reviewNotes || null},
          });
        }
      } catch (err) {
        console.warn("[dispatcher] audit log write failed", err?.message);
      }

      // Fire only on the approved transition. Rejected transitions are
      // terminal but require no work — Pubo never publishes them.
      if (before.status === "approved") return;
      if (after.status !== "approved") return;
      if (after.department !== "content") return;
      // Scheduled rollups (input.runType) are read-only reports — Compass
      // files them under the content department, and acknowledging one must
      // not invoke Pubo (it would fail on the missing aria.generationId and
      // count against Pubo's circuit breaker).
      if (after.input && after.input.runType) return;
      if (after.seed === true) return;
      const jobData = {id: jobId, ...after};
      const jobRef = admin.firestore().collection("agentJobs").doc(jobId);

      if (await isAgentPaused("pubo")) {
        await setJobFields(jobRef, {
          status: "failed",
          error: "Pubo is paused — admin must publish manually.",
        });
        return;
      }

      await setJobFields(jobRef, {agentId: "pubo"});
      try {
        const puboOut = await runPubo({job: jobData});
        await setJobFields(jobRef, {
          "output.pubo": puboOut,
          status: "done",
        });
      } catch (err) {
        console.error("Pubo failed", err);
        await setJobFields(jobRef, {
          status: "failed",
          error: `Pubo: ${String(err && err.message || err).slice(0, 500)}`,
        });
        await noteAgentFailure("pubo", err);
      }
    },
  );
}

module.exports = {
  createAgentJobsOnCreate,
  createAgentJobsOnApproved,
  runFromCala,
};
