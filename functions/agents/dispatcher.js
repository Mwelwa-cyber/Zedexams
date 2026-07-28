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
 *
 * The pure decisions (status transitions, stage sequencing, failure
 * classification, payload validation) live in dispatcherCore.js; this
 * module keeps the Firestore/trigger/runner wiring and delegates.
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
const core = require("./dispatcherCore");

/**
 * Record a runner failure against the circuit breaker. On the trip transition
 * the breaker pauses the agent and we email ADMIN_EMAILS. Best-effort — never
 * throws, so the caller's own status='failed' handling is unaffected.
 */
async function noteAgentFailure(agentId, err) {
  const errorMessage = core.agentErrorMessage(err);
  await recordAgentFailure({
    db: admin.firestore(),
    agentId,
    errorMessage,
    fieldValue: admin.firestore.FieldValue,
    alert: async ({failuresInWindow}) => {
      await sendOpsAlert(
        core.breakerAlertContent({agentId, errorMessage, failuresInWindow}),
      );
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

// Paused-agents cache (TTL + refresh decision live in dispatcherCore).
let pausedCache = {expiresAt: 0, paused: new Set()};

async function refreshPausedCache() {
  const snap = await admin.firestore()
    .collection("agentControl")
    .where("paused", "==", true)
    .get()
    .catch(() => null);
  const pausedIds = [];
  if (snap && !snap.empty) {
    snap.forEach((doc) => pausedIds.push(doc.id));
  }
  pausedCache = core.buildPausedCache(pausedIds, Date.now());
  return pausedCache;
}

async function isAgentPaused(agentId) {
  if (core.isPausedCacheExpired(pausedCache, Date.now())) {
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
  const owner = core.resolveJobOwner(jobData);
  if (!owner.ok) {
    await setJobFields(jobRef, owner.fields);
    return;
  }
  try {
    const role = await getUserRole(owner.ownerUid);
    await assertDailyLimit(owner.ownerUid, role, "agentJob");
  } catch (err) {
    await setJobFields(jobRef, core.meteringFailureFields(err));
    return;
  }

  // 1. Aria
  if (await isAgentPaused("aria")) {
    await setJobFields(jobRef, core.pausedJobFields("aria"));
    return;
  }
  await setJobFields(jobRef, {status: "running", agentId: "aria"});
  let ariaOut;
  try {
    ariaOut = await runAria({jobId: jobRef.id, job: jobData, anthropicApiKeySecret});
  } catch (err) {
    console.error("Aria failed", err);
    await setJobFields(jobRef, core.runnerFailureFields("Aria", err));
    await noteAgentFailure("aria", err);
    return;
  }
  await setJobFields(jobRef, core.ariaSuccessFields(ariaOut));

  // Empty-draft rationale lives with core.isEmptyAriaDraft in dispatcherCore.
  if (core.isEmptyAriaDraft(ariaOut)) {
    const err = new Error(core.EMPTY_DRAFT_MESSAGE);
    await setJobFields(jobRef, core.runnerFailureFields("Aria", err));
    await noteAgentFailure("aria", err);
    return;
  }

  // 2. Cala
  if (await isAgentPaused("cala")) {
    await setJobFields(jobRef, core.pausedJobFields("cala"));
    return;
  }
  await setJobFields(jobRef, {agentId: "cala"});
  let calaOut;
  try {
    calaOut = await runCala({job: await readJob()});
  } catch (err) {
    console.error("Cala failed", err);
    await setJobFields(jobRef, core.runnerFailureFields("Cala", err));
    await noteAgentFailure("cala", err);
    return;
  }
  await setJobFields(jobRef, {"output.cala": calaOut});

  // 3. Reva
  if (await isAgentPaused("reva")) {
    await setJobFields(jobRef, core.pausedJobFields("reva"));
    return;
  }
  await setJobFields(jobRef, {agentId: "reva"});
  let revaOut;
  try {
    revaOut = await runReva({job: await readJob(), anthropicApiKeySecret});
  } catch (err) {
    console.error("Reva failed", err);
    await setJobFields(jobRef, core.runnerFailureFields("Reva", err));
    await noteAgentFailure("reva", err);
    return;
  }
  await setJobFields(jobRef, core.chainCompleteFields(revaOut));
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
    await setJobFields(jobRef, core.pausedJobFields("cala"));
    return;
  }
  await setJobFields(jobRef, {status: "running", agentId: "cala"});
  let calaOut;
  try {
    calaOut = await runCala({job: await readJob()});
  } catch (err) {
    console.error("Cala failed (retry)", err);
    await setJobFields(jobRef, core.runnerFailureFields("Cala", err));
    await noteAgentFailure("cala", err);
    return;
  }
  await setJobFields(jobRef, {"output.cala": calaOut});

  // Reva.
  if (await isAgentPaused("reva")) {
    await setJobFields(jobRef, core.pausedJobFields("reva"));
    return;
  }
  await setJobFields(jobRef, {agentId: "reva"});
  let revaOut;
  try {
    revaOut = await runReva({job: await readJob(), anthropicApiKeySecret});
  } catch (err) {
    console.error("Reva failed (retry)", err);
    await setJobFields(jobRef, core.runnerFailureFields("Reva", err));
    await noteAgentFailure("reva", err);
    return;
  }
  await setJobFields(jobRef, core.chainCompleteFields(revaOut));
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
      // Guard rationale (department/agent/status/seed) in dispatcherCore.
      if (!core.shouldRunContentChain(jobData)) return;

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
        for (const entry of core.approvalAuditEntries({jobId, before, after})) {
          await writeAuditLog(entry);
        }
      } catch (err) {
        console.warn("[dispatcher] audit log write failed", err?.message);
      }

      // Transition + rollup/seed guard rationale in dispatcherCore.
      if (!core.shouldRunPubo(before, after)) return;

      // Eventarc delivers AT-LEAST-ONCE: a duplicate delivery of THIS SAME
      // approved transition carries identical before/after and would sail past
      // the state guards above and run Pubo a second time (re-publishing the
      // generation, re-stamping approval, re-notifying). Claim the event id
      // once so the body runs at most once per delivery. Fails open — the
      // guard prevents double work, it must never drop a real approval.
      const {claimEventOnce} = require("../idempotency");
      const claim = await claimEventOnce(admin.firestore(), {
        scope: "agentJobsOnApproved",
        eventId: event.id,
      });
      if (!claim.claimed) return;

      const jobData = {id: jobId, ...after};
      const jobRef = admin.firestore().collection("agentJobs").doc(jobId);

      if (await isAgentPaused("pubo")) {
        await setJobFields(jobRef, core.pausedJobFields("pubo"));
        return;
      }

      await setJobFields(jobRef, {agentId: "pubo"});
      try {
        const puboOut = await runPubo({job: jobData});
        await setJobFields(jobRef, core.puboSuccessFields(puboOut));
      } catch (err) {
        console.error("Pubo failed", err);
        await setJobFields(jobRef, core.runnerFailureFields("Pubo", err));
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
