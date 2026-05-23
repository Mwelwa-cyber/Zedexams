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
const {runSupervisorReview} = require("./runners/supervisorReview");
const {runQualityCheck} = require("./runners/qualityCheck");
const {runCurriculumWatcher} = require("./runners/curriculumWatcher");
const {writeAgentLog, writeTaskStep} = require("./logger");
const {
  assertLearnerDailyLimit, taskExceedsBudget, DEFAULT_TASK_BUDGET,
  MAX_REGENERATION_ATTEMPTS,
} = require("./costGuard");
const {
  assertAutomationAllowed, assertDailyQuotas, estimateQuestionCount,
} = require("./automationGate");
const {
  recordContentVersion, CHANGE_TYPES: VERSION_CHANGE_TYPES,
} = require("./versionRecorder");
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
  supervisorReview: runSupervisorReview,
  qualityCheck: runQualityCheck,
  curriculumWatcher: runCurriculumWatcher,
});

// Per-agent pause cache. Reads aiAgentControls. Mirrors the pattern
// from functions/agents/dispatcher.js for the teacher pipeline.
// TTL is intentionally short (5s) so an admin pause toggle in the
// Live Monitor takes effect on new task pickup within ~5s instead
// of the previous ~60s. Cost: ~12× more single-doc reads from
// aiAgentControls. That collection has ≤15 docs so the impact is
// negligible — well worth the responsiveness improvement.
const PAUSED_CACHE_TTL_MS = 5_000;
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

  // 0b. Automation policy gate (per aiAutomationSettings/global). Refuses
  // tasks when admin has paused automation, when the task's grade or
  // subject is not on the whitelist, or when today's question / quiz
  // quota would be breached. See functions/agents/learnerAi/automationGate.js.
  try {
    await assertAutomationAllowed({task});
    await assertDailyQuotas({
      estimatedQuestionCount: estimateQuestionCount(task),
      contentType: task.taskType,
    });
  } catch (err) {
    await setTaskFields(taskRef, {
      status: TASK_STATUS.ERROR,
      errorMessage: err && err.code ?
        `${err.code}:${String(err.message || "").slice(0, 200)}` :
        `automation_gate_failed:${String(err && err.message || err).slice(0, 200)}`,
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
  // Per-task usage accumulator. Runners that call the LLM should
  // push their token + cost stats here so taskExceedsBudget can
  // detect runaway chains. For now we track step count; token/cost
  // accumulation is a follow-up that requires runner-side wiring
  // to push the Anthropic response usage onto chainContext.usage.
  chainContext.usage = {steps: 0, tokensTotal: 0, costUsdCents: 0};
  const taskBudget = (task.supervisorPlan && task.supervisorPlan.budget) ||
    DEFAULT_TASK_BUDGET;
  let lastContentId = null;
  for (let i = 0; i < steps.length; i++) {
    const agentId = steps[i];
    chainContext.usage.steps = i;
    // Per-task budget gate (cost-guard F1). Refuses to start the next
    // runner if the chain has already burned past its budget — defends
    // against accidental long step plans + future runner-side
    // token/cost overruns. DEFAULT_TASK_BUDGET.maxSteps=8 gives
    // headroom over the longest current plan (exam_quiz=6 steps).
    const breach = taskExceedsBudget(chainContext.usage, taskBudget);
    if (breach) {
      await writeAgentLog({
        taskId, agentName: "dispatcher", action: "budget_breach",
        message: `Task budget exceeded at step ${i + 1}/${steps.length}: ${breach}`,
        taskType: task.taskType,
        grade: task.grade, subject: task.subject, topic: task.topic,
        severity: SEVERITY.ERROR,
      });
      await setTaskFields(taskRef, {
        status: TASK_STATUS.ERROR,
        errorMessage: `task_budget_exceeded:${breach}`,
      });
      return;
    }
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
    // Quality Check agent: surfaces the full v3 verdict
    // (status / confidence / issues / fixedSuggestions /
    //  requiresHumanReview) so future agents (and the auto-publish
    // gate, indirectly via task.status) can read the verdict without
    // re-reading the artifact doc.
    if (result.qualityCheckVerdict && agentId === "qualityCheck") {
      chainContext.qualityCheck = result.qualityCheckVerdict;
    }
    // Final Supervisor decision — drives terminal task status below.
    if (result.supervisorDecision && agentId === "supervisorReview") {
      chainContext.supervisorDecision = result.supervisorDecision;
    }
    if (result.contentId) lastContentId = result.contentId;

    // Quality Check verdict shapes an interim task status. Supervisor
    // Review (the next/last step) is the authoritative source for the
    // FINAL status — see block 3 below.
    if (agentId === "qualityCheck") {
      await setTaskFields(taskRef, {
        status: result.verdict === "pass" ?
          TASK_STATUS.PASSED_QUALITY_CHECK :
          TASK_STATUS.FAILED_QUALITY_CHECK,
      });
    }
  }

  // 3. All steps green → Supervisor decision drives the terminal
  // task status. The decision was made by the supervisorReview agent
  // (last step) and stashed on chainContext.supervisorDecision.
  //
  //   approved             → TASK_STATUS.APPROVED  (then aiAgentTasksOnApproved
  //                          fires + flips aiGeneratedContent → 'published')
  //   sent_for_review      → TASK_STATUS.NEEDS_REVIEW
  //   regenerate_required  → TASK_STATUS.REGENERATING
  //   rejected             → TASK_STATUS.REJECTED
  //
  // If the chain produced no Supervisor decision (e.g. supervisorReview
  // crashed or wasn't planned for this task type), fall back to the
  // legacy shouldAutoPublish gate. That guard is the safety net.
  const sd = chainContext.supervisorDecision;
  let terminalStatus;
  if (sd && typeof sd.decision === "string") {
    if (sd.decision === "approved") terminalStatus = TASK_STATUS.APPROVED;
    else if (sd.decision === "sent_for_review") terminalStatus = TASK_STATUS.NEEDS_REVIEW;
    else if (sd.decision === "regenerate_required") terminalStatus = TASK_STATUS.REGENERATING;
    else if (sd.decision === "rejected") terminalStatus = TASK_STATUS.REJECTED;
  }
  if (!terminalStatus) {
    const lastTask = await readTask(taskRef);
    const autoPublishOk = await shouldAutoPublish({
      task: lastTask, contentId: lastContentId,
    });
    terminalStatus = autoPublishOk ?
      TASK_STATUS.APPROVED : TASK_STATUS.NEEDS_REVIEW;
  }

  // Honour mid-flight admin cancellation. The Cancel Task button in
  // the Live Monitor (LiveAgentStatusCards.handleCancelTask) writes
  // status='rejected' + errorMessage='Cancelled from Live Monitor'
  // while the chain may still be walking the step plan. The dispatcher
  // does not signal-abort the chain (runners share no abort channel),
  // so by the time we reach this terminal write the supervisor may
  // have already decided 'approved' — which would overwrite the admin's
  // cancellation AND fire the aiAgentTasksOnApproved trigger AND
  // publish the artifact.
  //
  // Re-read the task here. If the admin set status='rejected' OR
  // errorMessage starts with 'Cancelled', skip the terminal write +
  // log the cancellation. The artifact already-written by the
  // generator runner stays at status='needs_review' (its default) and
  // is therefore not learner-visible.
  const finalTask = await readTask(taskRef);
  const cancelled =
    finalTask.status === TASK_STATUS.REJECTED &&
    typeof finalTask.errorMessage === "string" &&
    finalTask.errorMessage.toLowerCase().startsWith("cancelled");
  if (cancelled) {
    await writeAgentLog({
      taskId, agentName: "dispatcher", action: "honour_cancellation",
      message: `runChain finished but admin cancelled mid-flight. ` +
        `Skipping terminal write — leaving status='rejected', errorMessage='${finalTask.errorMessage}'.`,
      taskType: finalTask.taskType,
      grade: finalTask.grade, subject: finalTask.subject, topic: finalTask.topic,
      severity: SEVERITY.WARNING,
    });
    return;
  }

  await setTaskFields(taskRef, {
    status: terminalStatus,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    resultContentId: lastContentId,
  });
}

/**
 * Auto-publish gate per task type.
 *
 * Allow-list:
 *   practice_quiz → settings/global.learnerAi.autoPublishPracticeQuizzes
 *   notes         → settings/global.learnerAi.autoPublishNotes
 *
 * When the matching flag is true AND Quality Check verdict was 'pass'
 * AND qualityCheck.requiresHumanReview !== true, the dispatcher
 * transitions straight to APPROVED (which then fires
 * aiAgentTasksOnApproved → flips the aiGeneratedContent doc to
 * 'published'). Every other task type — including exam_quiz,
 * curriculum_update_check, weakness_analysis, learner_feedback,
 * study_tips — always lands at needs_review.
 *
 * Safe-by-default: returns false on any error, missing setting, or
 * unknown task type. Admins opt-out by setting the per-type flag
 * to false in /admin/settings.
 *
 * Per-type extra preconditions can be wired alongside the setting
 * key — e.g. study_tips refuses to auto-publish unless the task
 * carries `parameters.weakLearnerId` (enforcing the user rule:
 * "Study tips may auto-publish if based on real learner weakness
 * data"). Auto-publish for exam_quiz / curriculum_update_check /
 * weakness_analysis / learner_feedback is never granted (those types
 * are absent from the table).
 */
const AUTO_PUBLISH_SETTING_BY_TASK = Object.freeze({
  practice_quiz: {settingKey: "autoPublishPracticeQuizzes", precondition: null},
  // Notes auto-publish requires a non-empty task.topic. Defends
  // against a malformed task slipping past the schema (e.g. a
  // teacher form that didn't validate topic) and shipping a topic-
  // less notes doc straight to learners. The generator runner
  // already requires topic via the schema, but pinning it here is
  // belt-and-braces — a notes artifact without a clear topic
  // would be useless to a learner anyway.
  notes:         {settingKey: "autoPublishNotes",
    precondition: (task) => !!(task && typeof task.topic === "string" &&
      task.topic.trim().length > 0)},
  study_tips:    {settingKey: "autoPublishStudyTips",
    precondition: (task) => !!(task && task.parameters &&
      typeof task.parameters.weakLearnerId === "string" &&
      task.parameters.weakLearnerId.length > 0)},
  // Learner feedback is shown on the learner's dashboard right after
  // a quiz, so auto-publish is the expected default once an admin
  // turns on settings.autoPublishLearnerFeedback. Precondition
  // enforces "based on actual quiz attempt data": both learnerId AND
  // attemptId must be on the task parameters. Without them the
  // feedback runner would have refused upstream anyway, but pinning
  // it at the publish boundary is belt-and-braces.
  learner_feedback: {settingKey: "autoPublishLearnerFeedback",
    precondition: (task) => !!(task && task.parameters &&
      typeof task.parameters.learnerId === "string" &&
      task.parameters.learnerId.length > 0 &&
      typeof task.parameters.attemptId === "string" &&
      task.parameters.attemptId.length > 0)},
});

async function shouldAutoPublish({task, contentId}) {
  if (!task) return false;
  const entry = AUTO_PUBLISH_SETTING_BY_TASK[task.taskType];
  if (!entry) return false;
  if (typeof entry.precondition === "function" && !entry.precondition(task)) return false;
  if (task.status === TASK_STATUS.FAILED_QUALITY_CHECK) return false;
  if (task.status !== TASK_STATUS.PASSED_QUALITY_CHECK) return false;
  if (!contentId) return false;
  try {
    // Quality Check v3 sets `requiresHumanReview:true` on every exam
    // quiz, on any artifact that failed checks, and on anything below
    // confidence 0.8. Refuse to auto-publish if the verdict on the
    // artifact says human review is required — this is the
    // server-side enforcement of the v3 rule independent of the
    // task.status branch above.
    const contentSnap = await admin.firestore()
        .collection(COLLECTIONS.CONTENT).doc(contentId).get();
    if (contentSnap.exists) {
      const qc = (contentSnap.data() || {}).qualityCheck || {};
      if (qc.requiresHumanReview === true) return false;
      if (qc.status === "failed") return false;
    }
    const settingsSnap = await admin.firestore()
        .doc("settings/global")
        .get();
    const learnerAi = settingsSnap.exists ?
      (settingsSnap.data() || {}).learnerAi || {} : {};
    return learnerAi[entry.settingKey] === true;
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

    // Resolve the linked content doc up front so the audit hooks +
    // the publish step + the version-history append all share a ref.
    // v2 schema doesn't carry taskId on the content doc, so we resolve
    // by (grade, subject, topic) and pick the newest. Falls back to
    // the resultContentId stamped on aiAgentTasks if present.
    const resolvedContentRef = await resolveContentRefForTask(after);

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
        // Snapshot the content at the moment of approval.
        if (resolvedContentRef) {
          recordContentVersion({
            contentId: resolvedContentRef.id,
            changedBy: "system",
            changeType: VERSION_CHANGE_TYPES.APPROVED,
            changeReason: null,
          }).catch(() => { /* swallow */ });
        }
      }
      if (before.status !== TASK_STATUS.REJECTED && after.status === TASK_STATUS.REJECTED) {
        await writeAuditLog({
          actorUid: "system",
          action: "learner_ai.reject",
          targetType: "aiAgentTask",
          targetId: taskId,
          metadata: {taskType: after.taskType || null},
        });
        // Snapshot the rejected content. The admin's rejection notes
        // live on the task (after.errorMessage / after.adminNotes);
        // we propagate them as the changeReason so admins reading
        // the version history see WHY this artifact was rejected.
        if (resolvedContentRef) {
          recordContentVersion({
            contentId: resolvedContentRef.id,
            changedBy: "system",
            changeType: VERSION_CHANGE_TYPES.REJECTED,
            changeReason: after.errorMessage || after.adminNotes || null,
          }).catch(() => { /* swallow */ });
        }
      }
      // Admin re-queued a previously-terminal task. The Live Monitor /
      // ArtifactCard / ExamDraftDetailPage all open the
      // RegenerateWithNotesModal which writes status='regenerating'.
      // (The legacy 'queued' transition is also accepted so any future
      // direct-re-queue UI keeps working.)
      const wasTerminal =
        before.status === TASK_STATUS.APPROVED ||
        before.status === TASK_STATUS.REJECTED ||
        before.status === TASK_STATUS.NEEDS_REVIEW ||
        before.status === TASK_STATUS.PUBLISHED ||
        before.status === TASK_STATUS.ERROR ||
        before.status === TASK_STATUS.FAILED_QUALITY_CHECK;
      const isRegenerateRequest =
        wasTerminal && (
          after.status === TASK_STATUS.REGENERATING ||
          after.status === TASK_STATUS.QUEUED
        );
      if (isRegenerateRequest) {
        // 0. Loop guard. Refuse the re-run if this task has already
        //    burned through MAX_REGENERATION_ATTEMPTS — protects
        //    against tight regenerate loops that would drain the
        //    daily question quota on a single bad artifact.
        const attemptsSoFar = Number.isInteger(after.regenerationAttempts) ?
          after.regenerationAttempts : 0;
        if (attemptsSoFar >= MAX_REGENERATION_ATTEMPTS) {
          await writeAgentLog({
            taskId, agentName: "dispatcher", action: "regenerate_blocked",
            message: `Refused: ${attemptsSoFar}/${MAX_REGENERATION_ATTEMPTS} regeneration attempts already consumed.`,
            taskType: after.taskType,
            grade: after.grade, subject: after.subject, topic: after.topic,
            severity: SEVERITY.WARNING,
          });
          await setTaskFields(taskRef, {
            status: TASK_STATUS.ERROR,
            errorMessage: `regeneration_loop_blocked:attempts=${attemptsSoFar}`,
          });
          return;
        }
        // 1. Audit: record a `regenerated` version snapshot on the
        //    OLD content doc so its history shows it was replaced.
        if (resolvedContentRef) {
          recordContentVersion({
            contentId: resolvedContentRef.id,
            changedBy: "system",
            changeType: VERSION_CHANGE_TYPES.REGENERATED,
            changeReason: after.regenerateNotes || after.adminNotes ||
              after.errorMessage || null,
          }).catch(() => { /* swallow */ });
        }
        // 2. Reset pipeline fields + bump the attempt counter so the
        //    chain runs cleanly with the guard primed for next time.
        await setTaskFields(taskRef, {
          startedAt: null,
          completedAt: null,
          resultContentId: null,
          errorMessage: null,
          regenerationAttempts: attemptsSoFar + 1,
        });
        // 3. Re-trigger the chain. Without this, the admin's
        //    regenerate request silently sits forever — the
        //    onDocumentCreated trigger fires only on doc creation,
        //    not on status updates.
        await writeAgentLog({
          taskId, agentName: "dispatcher", action: "regenerate",
          message: `Admin re-queued task (before='${before.status}', after='${after.status}'). Re-running chain.`,
          taskType: after.taskType,
          grade: after.grade, subject: after.subject, topic: after.topic,
          severity: SEVERITY.INFO,
        });
        await runChain({taskId});
        return;
      }
    } catch (err) {
      console.warn("[learner-ai dispatcher] audit log write failed", err && err.message);
    }

    if (before.status === TASK_STATUS.APPROVED) return;
    if (after.status !== TASK_STATUS.APPROVED) return;

    if (resolvedContentRef) {
      await resolvedContentRef.set({
        status: CONTENT_STATUS.PUBLISHED,
        reviewedBy: "admin",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      // Snapshot the now-published content. This is the version
      // learners actually see — pin it in the audit trail so admins
      // can later confirm "this exact content was published on X
      // date by Y".
      recordContentVersion({
        contentId: resolvedContentRef.id,
        changedBy: "system",
        changeType: VERSION_CHANGE_TYPES.PUBLISHED,
        changeReason: null,
      }).catch(() => { /* swallow */ });

      // Demote any sibling docs that were already published for the
      // same (type, grade, subject, topic, subtopic). After admin
      // regenerates an approved quiz, the new content is published
      // — the OLD published doc is no longer current and must not
      // surface in the learner-facing list. Setting status='superseded'
      // pulls it out of the rule's `status=='published'` gate without
      // deleting it (admin retains audit visibility).
      await demoteSiblingPublishedContent({
        keepContentId: resolvedContentRef.id,
        taskType: after.taskType,
        grade: after.grade,
        subject: after.subject,
        topic: after.topic,
        subtopic: after.subtopic,
      }).catch((err) => {
        console.warn("[learner-ai dispatcher] sibling demote failed",
            err && err.message);
      });
    }

    await setTaskFields(taskRef, {status: TASK_STATUS.PUBLISHED});
  });
}

/**
 * Find every other aiGeneratedContent doc with status='published'
 * matching the same (type, grade, subject, topic, subtopic) tuple
 * and demote it to status='superseded'. Used after admin regenerate
 * + admin approve so the learner-facing list shows only the latest.
 *
 * Best-effort: caller .catch()s any failure. The demotion is an
 * audit improvement, not a hard correctness guarantee — the new
 * content is already published and learners see it ordered by
 * createdAt desc, so worst case they see two versions briefly.
 *
 * Writes:
 *   - aiGeneratedContent/<oldId>.status = 'superseded'
 *   - aiGeneratedContent/<oldId>.supersededBy = <keepContentId>
 *   - aiGeneratedContentVersions/<auto> with changeType='superseded'
 */
async function demoteSiblingPublishedContent({
  keepContentId, taskType, grade, subject, topic, subtopic,
}) {
  if (!taskType || !grade || !subject || !topic) return;
  const snap = await admin.firestore()
      .collection(COLLECTIONS.CONTENT)
      .where("type", "==", String(taskType))
      .where("grade", "==", String(grade))
      .where("subject", "==", String(subject))
      .where("topic", "==", String(topic))
      .where("subtopic", "==", String(subtopic || ""))
      .where("status", "==", CONTENT_STATUS.PUBLISHED)
      .get();
  if (snap.empty) return;
  const batch = admin.firestore().batch();
  let demoted = 0;
  for (const doc of snap.docs) {
    if (doc.id === keepContentId) continue;
    batch.update(doc.ref, {
      status: "superseded",
      supersededBy: keepContentId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    demoted += 1;
    recordContentVersion({
      contentId: doc.id,
      changedBy: "system",
      changeType: "superseded",
      changeReason: `Superseded by ${keepContentId}`,
    }).catch(() => { /* swallow */ });
  }
  if (demoted > 0) await batch.commit();
}

// Resolve the content doc the task points at. Pulled out of
// `createAiAgentTasksOnApproved` so the same logic feeds the audit
// hooks + the publish step. Returns null when nothing matches.
async function resolveContentRefForTask(task) {
  if (!task) return null;
  if (task.resultContentId) {
    return admin.firestore()
        .collection(COLLECTIONS.CONTENT)
        .doc(task.resultContentId);
  }
  const snap = await admin.firestore()
      .collection(COLLECTIONS.CONTENT)
      .where("grade", "==", String(task.grade || ""))
      .where("subject", "==", String(task.subject || ""))
      .where("topic", "==", String(task.topic || ""))
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
    return docs[0].ref;
  }
  return null;
}

module.exports = {
  createAiAgentTasksOnCreate,
  createAiAgentTasksOnApproved,
  statusForRunner,
  RUNNER_MAP,
};
