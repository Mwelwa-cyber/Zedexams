/**
 * Learner-AI dispatcher — v2.
 *
 * Firestore triggers on the aiAgentTasks collection. v2 schema does NOT
 * carry orchestration metadata on aiAgentTasks; instead the dispatcher
 * carries `chainContext` in-memory and persists observability through
 * aiTaskSteps, aiAgentLogs, aiSupervisorLogs.
 *
 * Triggers:
 *   1. aiAgentTasksOnCreate — wakes Supervisor; walks the planned step
 *      graph; flips terminal status to `needs_review` once all steps
 *      pass (or `failed_quality_check` / `error` on failure).
 *   2. aiAgentTasksOnApproved — fires when admin sets status='approved'.
 *      Flips the corresponding aiGeneratedContent doc status to
 *      'published' and stamps `reviewedBy`.
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
const {runStandardsCheck} = require("./runners/standardsCheck");
const {runQualityCheck} = require("./runners/qualityCheck");
const {runCurriculumWatcher} = require("./runners/curriculumWatcher");
const {writeAgentLog, writeTaskStep} = require("./logger");
const {assertLearnerDailyLimit} = require("./costGuard");
const {
  COLLECTIONS, TASK_STATUS, CONTENT_STATUS, TASK_STEP_STATUS, SEVERITY,
} = require("./v2Collections");

const TRIGGER_OPTS = {
  document: `${COLLECTIONS.TASKS}/{taskId}`,
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "512MiB",
};

const RUNNER_MAP = Object.freeze({
  supervisor: runSupervisor,
  curriculumReader: runCurriculumReader,
  practiceQuiz: runPracticeQuiz,
  examQuiz: runExamQuiz,
  notes: runNotes,
  studyTips: runStudyTips,
  weakness: runWeakness,
  feedback: runFeedback,
  standards: runStandards,
  standardsCheck: runStandardsCheck,
  qualityCheck: runQualityCheck,
  curriculumWatcher: runCurriculumWatcher,
});

// Per-agent pause cache (1-minute TTL). Reads aiAgentControls. Mirrors
// the pattern from functions/agents/dispatcher.js for the teacher pipeline.
const PAUSED_CACHE_TTL_MS = 60_000;
let pausedCache = {expiresAt: 0, paused: new Set()};

async function refreshPausedCache() {
  const snap = await admin.firestore()
      .collection(COLLECTIONS.CONTROLS)
      .where("paused", "==", true)
      .get()
      .catch(() => null);
  const paused = new Set();
  if (snap && !snap.empty) snap.forEach((doc) => paused.add(doc.id));
  pausedCache = {expiresAt: Date.now() + PAUSED_CACHE_TTL_MS, paused};
  return pausedCache;
}

async function isAgentPaused(agentId) {
  if (Date.now() >= pausedCache.expiresAt) await refreshPausedCache();
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

// Pipeline status flow (v2):
//   queued → running → (per-runner: thinking|generating|checking|waiting)
//          → completed → passed_quality_check → needs_review
//                      | failed_quality_check → regenerating | rejected
//          → approved → published
//   any branch → error
function statusForRunner(agentId) {
  if (agentId === "supervisor")          return TASK_STATUS.RUNNING;
  if (agentId === "curriculumReader")    return TASK_STATUS.CHECKING;
  if (agentId === "qualityCheck")        return TASK_STATUS.CHECKING;
  if (agentId === "curriculumWatcher")   return TASK_STATUS.RUNNING;
  return TASK_STATUS.GENERATING;
}

async function runChain({taskId}) {
  const db = admin.firestore();
  const taskRef = db.collection(COLLECTIONS.TASKS).doc(taskId);
  let task = await readTask(taskRef);

  // 0. Per-user daily cap — distinct from teacher caps.
  const owner = String(task.createdBy || task.learnerId || "");
  if (!owner || owner === "system") {
    await setTaskFields(taskRef, {
      status: TASK_STATUS.ERROR,
      errorMessage: "missing_owner_uid",
    });
    return;
  }
  try {
    await assertLearnerDailyLimit(owner);
  } catch (err) {
    const exhausted = err && err.code === "resource-exhausted";
    await setTaskFields(taskRef, {
      status: TASK_STATUS.ERROR,
      errorMessage: exhausted ?
        "daily_learner_ai_limit_reached" :
        `meter_check_failed:${String(err && err.message || err).slice(0, 200)}`,
    });
    return;
  }

  // 1. Supervisor — plans the step graph (in-memory).
  if (await isAgentPaused("supervisor")) {
    await setTaskFields(taskRef, {
      status: TASK_STATUS.ERROR, errorMessage: "supervisor_paused",
    });
    return;
  }
  await setTaskFields(taskRef, {
    status: TASK_STATUS.RUNNING,
    agentName: "AI Supervisor Agent",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const planResult = await runSupervisor({task});
  if (!planResult.ok) {
    await setTaskFields(taskRef, {
      status: TASK_STATUS.ERROR,
      errorMessage: planResult.reason || "supervisor_plan_failed",
    });
    return;
  }
  task = await readTask(taskRef);
  const steps = planResult.steps;

  // 2. Walk the planned steps. chainContext carries the in-memory
  //    curriculumReference from the Reader forward to the generator
  //    and Quality Check.
  const chainContext = {};
  let lastContentId = null;
  for (let i = 0; i < steps.length; i++) {
    const agentId = steps[i];
    const runner = RUNNER_MAP[agentId];
    if (!runner) {
      await setTaskFields(taskRef, {
        status: TASK_STATUS.ERROR,
        errorMessage: `unknown_agent:${agentId}`,
      });
      return;
    }
    if (await isAgentPaused(agentId)) {
      await setTaskFields(taskRef, {
        status: TASK_STATUS.ERROR,
        errorMessage: `${agentId}_paused`,
      });
      return;
    }
    await setTaskFields(taskRef, {
      status: statusForRunner(agentId),
      agentName: agentId,
    });

    let result;
    try {
      result = await runner({task, chainContext, stepNumber: i + 1});
    } catch (err) {
      console.error(`learner-ai runner ${agentId} threw`, err);
      await writeAgentLog({
        taskId, agentName: agentId, action: "uncaught_error",
        message: String(err && err.message || err).slice(0, 400),
        taskType: task.taskType,
        grade: task.grade, subject: task.subject, topic: task.topic,
        severity: SEVERITY.ERROR,
      });
      await writeTaskStep({
        taskId, agentName: agentId, stepNumber: i + 1,
        stepTitle: `Run ${agentId}`,
        message: String(err && err.message || err).slice(0, 200),
        status: TASK_STEP_STATUS.FAILED, progress: 100,
      });
      await setTaskFields(taskRef, {
        status: TASK_STATUS.ERROR,
        errorMessage: `${agentId}_threw:${String(err && err.message || err).slice(0, 200)}`,
      });
      return;
    }

    if (!result || result.ok === false) {
      await setTaskFields(taskRef, {
        status: TASK_STATUS.ERROR,
        errorMessage: `${agentId}:${(result && result.reason) || "failed"}`,
      });
      return;
    }

    // Hoist returned values into the chain context.
    //   - curriculumReference (slim {persist, inMemory}) feeds the
    //     _stubFactory's write of aiGeneratedContent.curriculumReference.
    //   - curriculumReader (the rich v2 agent output, see
    //     src/schemas/learnerAi.js → curriculumReaderOutputSchema)
    //     is what every downstream agent (PracticeQuiz, ExamQuiz,
    //     Notes, StudyTips, Standards, QualityCheck, Supervisor)
    //     reads to get structured curriculum context.
    if (result.curriculumReference) {
      chainContext.curriculumReference = result.curriculumReference;
    }
    if (result.output && agentId === "curriculumReader") {
      chainContext.curriculumReader = result.output;
    }
    // Standards agent: surfaces the (admin-approved or default)
    // assessment structure that the Exam Quiz Generator + Quality
    // Check use to size sections, allocate marks, and enforce the
    // Blooms mix.
    if (result.standards && agentId === "standards") {
      chainContext.standards = result.standards;
    }
    // Verification agent: surfaces the Zambian-curriculum + assessment
    // verdict so Quality Check can incorporate it without re-running
    // the alignment checks.
    if (result.standardsCheckVerdict && agentId === "standardsCheck") {
      chainContext.standardsCheck = result.standardsCheckVerdict;
    }
    if (result.contentId) lastContentId = result.contentId;

    // Quality Check verdict shapes the terminal task status.
    if (agentId === "qualityCheck") {
      await setTaskFields(taskRef, {
        status: result.verdict === "pass" ?
          TASK_STATUS.PASSED_QUALITY_CHECK :
          TASK_STATUS.FAILED_QUALITY_CHECK,
      });
    }
  }

  // 3. All steps green. Two paths from here:
  //    (a) Practice quizzes MAY auto-publish when
  //        settings/global.learnerAi.autoPublishPracticeQuizzes is on
  //        AND the Quality Check verdict was 'pass'. We treat that as
  //        the equivalent of an admin approval (audit log is still
  //        written by aiAgentTasksOnApproved so the trail stays
  //        intact).
  //    (b) Otherwise → admin review gate (NEEDS_REVIEW).
  const lastTask = await readTask(taskRef);
  const autoPublishOk = await shouldAutoPublish({
    task: lastTask,
    contentId: lastContentId,
  });
  await setTaskFields(taskRef, {
    status: autoPublishOk ? TASK_STATUS.APPROVED : TASK_STATUS.NEEDS_REVIEW,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    resultContentId: lastContentId,
  });
}

/**
 * Auto-publish gate for practice quizzes.
 *
 * Reads settings/global.learnerAi.autoPublishPracticeQuizzes. When
 * true AND the task is a practice_quiz AND Quality Check verdict was
 * 'pass', returns true so the dispatcher transitions straight to
 * 'approved' (which then fires aiAgentTasksOnApproved → flips the
 * aiGeneratedContent doc to 'published').
 *
 * Safe-by-default: returns false on any error, missing setting, or
 * unknown task type. The admin can always opt-out by setting the
 * flag to false in /admin/settings.
 */
async function shouldAutoPublish({task, contentId}) {
  if (!task) return false;
  if (task.taskType !== "practice_quiz") return false;
  if (task.status === TASK_STATUS.FAILED_QUALITY_CHECK) return false;
  if (task.status !== TASK_STATUS.PASSED_QUALITY_CHECK) return false;
  if (!contentId) return false;
  try {
    const settingsSnap = await admin.firestore()
        .doc("settings/global")
        .get();
    const learnerAi = settingsSnap.exists ?
      (settingsSnap.data() || {}).learnerAi || {} : {};
    return learnerAi.autoPublishPracticeQuizzes === true;
  } catch (err) {
    console.warn("[learner-ai dispatcher] auto-publish check failed", err && err.message);
    return false;
  }
}

function createAiAgentTasksOnCreate() {
  return onDocumentCreated(TRIGGER_OPTS, async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    if (data.status !== TASK_STATUS.QUEUED) return;
    if (data.seed === true) return;
    await runChain({taskId: snap.id});
  });
}

function createAiAgentTasksOnApproved() {
  return onDocumentUpdated(TRIGGER_OPTS, async (event) => {
    const before = event.data && event.data.before && event.data.before.data();
    const after = event.data && event.data.after && event.data.after.data();
    if (!before || !after) return;
    if (after.seed === true) return;
    const taskId = event.params.taskId;
    const taskRef = admin.firestore().collection(COLLECTIONS.TASKS).doc(taskId);

    // Audit hook — reuses the same writer as the teacher pipeline.
    try {
      const {writeAuditLog} = require("../../auditLog");
      if (before.status !== TASK_STATUS.APPROVED && after.status === TASK_STATUS.APPROVED) {
        await writeAuditLog({
          actorUid: "system",
          action: "learner_ai.approve",
          targetType: "aiAgentTask",
          targetId: taskId,
          metadata: {taskType: after.taskType || null},
        });
      }
      if (before.status !== TASK_STATUS.REJECTED && after.status === TASK_STATUS.REJECTED) {
        await writeAuditLog({
          actorUid: "system",
          action: "learner_ai.reject",
          targetType: "aiAgentTask",
          targetId: taskId,
          metadata: {taskType: after.taskType || null},
        });
      }
    } catch (err) {
      console.warn("[learner-ai dispatcher] audit log write failed", err && err.message);
    }

    if (before.status === TASK_STATUS.APPROVED) return;
    if (after.status !== TASK_STATUS.APPROVED) return;

    // Flip the latest aiGeneratedContent doc for this task to published.
    // v2 schema doesn't carry taskId on the content doc, so we resolve
    // by (grade, subject, topic, subtopic) and pick the newest. Falls
    // back to the resultContentId stamped on aiAgentTasks if present.
    let contentRef = null;
    if (after.resultContentId) {
      contentRef = admin.firestore()
          .collection(COLLECTIONS.CONTENT)
          .doc(after.resultContentId);
    } else {
      const snap = await admin.firestore()
          .collection(COLLECTIONS.CONTENT)
          .where("grade", "==", String(after.grade || ""))
          .where("subject", "==", String(after.subject || ""))
          .where("topic", "==", String(after.topic || ""))
          .get()
          .catch(() => null);
      if (snap && !snap.empty) {
        const docs = [...snap.docs];
        docs.sort((a, b) => {
          const at = a.data().createdAt && a.data().createdAt.toMillis ?
            a.data().createdAt.toMillis() : 0;
          const bt = b.data().createdAt && b.data().createdAt.toMillis ?
            b.data().createdAt.toMillis() : 0;
          return bt - at;
        });
        contentRef = docs[0].ref;
      }
    }

    if (contentRef) {
      await contentRef.set({
        status: CONTENT_STATUS.PUBLISHED,
        reviewedBy: "admin",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    await setTaskFields(taskRef, {status: TASK_STATUS.PUBLISHED});
  });
}

module.exports = {
  createAiAgentTasksOnCreate,
  createAiAgentTasksOnApproved,
  statusForRunner,
  RUNNER_MAP,
};
