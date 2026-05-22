/**
 * Learner-AI dispatcher — Firestore triggers for the aiAgentTasks
 * collection. Mirrors the agentJobs dispatcher pattern (paused-cache,
 * department guard, sequential runner invocation) but on a SEPARATE
 * collection so the existing teacher pipeline is untouched.
 *
 * Triggers:
 *   1. aiAgentTasksOnCreate — runs Supervisor → step graph → terminal
 *      status. Stops at awaiting_approval for admin review.
 *   2. aiAgentTasksOnApproved — on approve, flips the
 *      learnerAiGenerations doc visibility from pending_review →
 *      published.  On reject, no side effects beyond the status change.
 *
 * Hard rule: this file (and every runner under runners/) MUST NOT write
 * to the `quizzes` collection. Enforced by
 * scripts/test-learner-ai-isolation.mjs in `npm run test:all`.
 */

const admin = require("firebase-admin");
const {onDocumentCreated, onDocumentUpdated} =
  require("firebase-functions/v2/firestore");

const {runSupervisor} = require("./runners/supervisor");
const {runCurriculumReader} = require("./runners/curriculumReader");
const {runPracticeQuiz} = require("./runners/practiceQuiz");
const {runExamQuiz} = require("./runners/examQuiz");
const {runNotes} = require("./runners/notes");
const {runStudyTips} = require("./runners/studyTips");
const {runWeakness} = require("./runners/weakness");
const {runFeedback} = require("./runners/feedback");
const {runStandards} = require("./runners/standards");
const {runQualityCheck} = require("./runners/qualityCheck");
const {runCurriculumWatcher} = require("./runners/curriculumWatcher");
const {writeAgentLog} = require("./logger");
const {assertLearnerDailyLimit} = require("./costGuard");

const TRIGGER_OPTS = {
  document: "aiAgentTasks/{taskId}",
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "512MiB",
};

const RUNNER_MAP = {
  supervisor: runSupervisor,
  curriculumReader: runCurriculumReader,
  practiceQuiz: runPracticeQuiz,
  examQuiz: runExamQuiz,
  notes: runNotes,
  studyTips: runStudyTips,
  weakness: runWeakness,
  feedback: runFeedback,
  standards: runStandards,
  qualityCheck: runQualityCheck,
  curriculumWatcher: runCurriculumWatcher,
};

// Paused-cache mirrors functions/agents/dispatcher.js. Each task may
// check 3-4 agent pause states in a row; reading agentControl once per
// minute is enough.
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

async function setTaskFields(taskRef, fields) {
  await taskRef.set({
    ...fields,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

async function readTask(taskRef) {
  const snap = await taskRef.get();
  return {id: snap.id, ...(snap.data() || {})};
}

// Status flow for taskType=practice_quiz (and most learner-AI tasks):
//   queued → supervisor_planning → curriculum_read → generating
//          → quality_check → awaiting_approval
// Generators map to status='generating'; qualityCheck → 'quality_check'.
function statusForAgent(agentId) {
  if (agentId === "supervisor") return "supervisor_planning";
  if (agentId === "curriculumReader") return "curriculum_read";
  if (agentId === "qualityCheck") return "quality_check";
  return "generating";
}

async function runChain({taskId}) {
  const db = admin.firestore();
  const taskRef = db.collection("aiAgentTasks").doc(taskId);
  let task = await readTask(taskRef);

  // 0. Per-user daily cap, distinct kind from the teacher pipeline.
  const owner = String(task.createdBy || "");
  if (!owner || owner === "system") {
    await setTaskFields(taskRef, {
      status: "failed",
      errorReason: "missing_owner_uid",
    });
    return;
  }
  try {
    await assertLearnerDailyLimit(owner);
  } catch (err) {
    const exhausted = err && err.code === "resource-exhausted";
    await setTaskFields(taskRef, {
      status: "failed",
      errorReason: exhausted ?
        "daily_learner_ai_limit_reached" :
        `meter_check_failed:${String(err && err.message || err).slice(0, 200)}`,
    });
    return;
  }

  // 1. Supervisor — plans the step graph onto task.supervisorPlan.
  if (await isAgentPaused("supervisor")) {
    await setTaskFields(taskRef, {
      status: "failed",
      errorReason: "supervisor_paused",
    });
    return;
  }
  await setTaskFields(taskRef, {
    status: "supervisor_planning",
    agentId: "supervisor",
    attempts: (task.attempts || 0) + 1,
    lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const planResult = await runSupervisor({task});
  if (!planResult.ok) {
    await setTaskFields(taskRef, {
      status: "failed",
      errorReason: planResult.reason || "supervisor_plan_failed",
    });
    return;
  }
  task = await readTask(taskRef);

  // 2. Walk the supervisor plan in order. The first runner is always
  //    Curriculum Reader for generator tasks (the safety gate); the
  //    Supervisor itself was already invoked above so we skip its
  //    plan-entry if it's present.
  const steps = (task.supervisorPlan && task.supervisorPlan.steps) || [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentId = step.agentId;
    if (agentId === "supervisor") continue;
    const runner = RUNNER_MAP[agentId];
    if (!runner) {
      await setTaskFields(taskRef, {
        status: "failed",
        errorReason: `unknown_agent:${agentId}`,
      });
      return;
    }
    if (await isAgentPaused(agentId)) {
      await setTaskFields(taskRef, {
        status: "failed",
        errorReason: `${agentId}_paused`,
      });
      return;
    }
    await setTaskFields(taskRef, {
      status: statusForAgent(agentId),
      agentId,
      [`supervisorPlan.steps.${i}.status`]: "running",
      [`supervisorPlan.steps.${i}.startedAt`]:
        admin.firestore.FieldValue.serverTimestamp(),
      [`supervisorPlan.currentStep`]: i,
      [`supervisorPlan.nextAgentId`]: steps[i + 1] ? steps[i + 1].agentId : null,
    });

    let result;
    try {
      result = await runner({task});
    } catch (err) {
      console.error(`learner-ai runner ${agentId} threw`, err);
      await writeAgentLog({
        agentId,
        taskId,
        action: "uncaught_error",
        level: "error",
        outputSummary: {error: String(err && err.message || err).slice(0, 400)},
        curriculumGrounded: false,
      });
      await setTaskFields(taskRef, {
        status: "failed",
        errorReason: `${agentId}_threw:${String(err && err.message || err).slice(0, 200)}`,
        [`supervisorPlan.steps.${i}.status`]: "failed",
        [`supervisorPlan.steps.${i}.completedAt`]:
          admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    if (!result || result.ok === false) {
      await setTaskFields(taskRef, {
        status: "failed",
        errorReason: `${agentId}:${(result && result.reason) || "failed"}`,
        [`supervisorPlan.steps.${i}.status`]: "failed",
        [`supervisorPlan.steps.${i}.completedAt`]:
          admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    await setTaskFields(taskRef, {
      [`supervisorPlan.steps.${i}.status`]: "succeeded",
      [`supervisorPlan.steps.${i}.completedAt`]:
        admin.firestore.FieldValue.serverTimestamp(),
    });
    task = await readTask(taskRef);
  }

  // 3. All steps green → admin approval gate.
  await setTaskFields(taskRef, {
    status: "awaiting_approval",
    agentId: null,
  });
}

function createAiAgentTasksOnCreate() {
  return onDocumentCreated(TRIGGER_OPTS, async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    if (data.department !== "learner_ai") return;
    if (data.status !== "queued") return;
    if (data.seed === true) return;
    await runChain({taskId: snap.id});
  });
}

function createAiAgentTasksOnApproved() {
  return onDocumentUpdated(TRIGGER_OPTS, async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after = event.data && event.data.after && event.data.after.data();
    if (!before || !after) return;
    if (after.department !== "learner_ai") return;
    if (after.seed === true) return;
    const taskId = event.params.taskId;
    const taskRef = admin.firestore().collection("aiAgentTasks").doc(taskId);

    // Audit hook reuses the same audit log writer as the teacher pipeline.
    try {
      const {writeAuditLog} = require("../../auditLog");
      if (before.status !== "approved" && after.status === "approved") {
        await writeAuditLog({
          actorUid: after.reviewedBy || "system",
          action: "learner_ai.approve",
          targetType: "aiAgentTask",
          targetId: taskId,
          metadata: {taskType: after.taskType || null},
        });
      }
      if (before.status !== "rejected" && after.status === "rejected") {
        await writeAuditLog({
          actorUid: after.reviewedBy || "system",
          action: "learner_ai.reject",
          targetType: "aiAgentTask",
          targetId: taskId,
          metadata: {reason: after.reviewNotes || null},
        });
      }
    } catch (err) {
      console.warn("[learner-ai dispatcher] audit log write failed", err && err.message);
    }

    if (before.status === "approved") return;
    if (after.status !== "approved") return;

    // Find every learnerAiGenerations row for this task and flip
    // visibility → published. Stub artifacts are still flipped because
    // the admin explicitly approved them.
    const gens = await admin.firestore()
        .collection("learnerAiGenerations")
        .where("taskId", "==", taskId)
        .get()
        .catch(() => null);
    if (gens && !gens.empty) {
      const batch = admin.firestore().batch();
      gens.forEach((g) => {
        batch.set(g.ref, {
          visibility: "published",
          approvedBy: after.reviewedBy || null,
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
      });
      await batch.commit();
    }

    await setTaskFields(taskRef, {status: "published"});
  });
}

module.exports = {
  createAiAgentTasksOnCreate,
  createAiAgentTasksOnApproved,
  // Exposed for unit tests:
  statusForAgent,
  RUNNER_MAP,
};
