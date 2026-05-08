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
 *   - Per-agent circuit breaker via agentControl/{agentId}.paused.
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

const TRIGGER_OPTS = {
  document: "agentJobs/{jobId}",
  region: "us-central1",
  timeoutSeconds: 300,
  memory: "512MiB",
};

async function isAgentPaused(agentId) {
  const snap = await admin.firestore()
    .doc(`agentControl/${agentId}`)
    .get()
    .catch(() => null);
  if (!snap || !snap.exists) return false;
  return Boolean((snap.data() || {}).paused);
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
    return;
  }
  await setJobFields(jobRef, {
    "output.aria": ariaOut,
    "publishedRefs": [
      {collection: "aiGenerations", docId: ariaOut.generationId},
    ],
  });

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
function createAgentJobsOnCreate(anthropicApiKeySecret) {
  return onDocumentCreated(
    {...TRIGGER_OPTS, secrets: [anthropicApiKeySecret]},
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
function createAgentJobsOnApproved() {
  return onDocumentUpdated(
    TRIGGER_OPTS,
    async (event) => {
      const before = event.data && event.data.before && event.data.before.data();
      const after = event.data && event.data.after && event.data.after.data();
      if (!before || !after) return;
      // Fire only on the approved transition. Rejected transitions are
      // terminal but require no work — Pubo never publishes them.
      if (before.status === "approved") return;
      if (after.status !== "approved") return;
      if (after.department !== "content") return;
      if (after.seed === true) return;

      const jobId = event.params.jobId;
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
      }
    },
  );
}

module.exports = {
  createAgentJobsOnCreate,
  createAgentJobsOnApproved,
};
