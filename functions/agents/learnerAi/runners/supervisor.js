/**
 * AI Supervisor Agent (Sage) — the orchestrator.
 *
 * Plans the step graph for each task, enforces cost caps, and decides
 * which agent to wake next. Does NOT call an LLM — orchestration is
 * deterministic and cheap. Every decision is logged.
 *
 * Step plans by taskType:
 *   practice_quiz, exam_quiz, notes, study_tips → [curriculumReader, generator, qualityCheck]
 *   weakness_scan, feedback                     → [curriculumReader, generator, qualityCheck]
 *   standards_draft                             → [curriculumReader, standards, qualityCheck]
 *   curriculum_check                            → [curriculumWatcher]
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState} = require("../logger");
const {DEFAULT_TASK_BUDGET} = require("../costGuard");

const AGENT_ID = "supervisor";

const TASK_TYPE_TO_GENERATOR = {
  practice_quiz: "practiceQuiz",
  exam_quiz: "examQuiz",
  notes: "notes",
  study_tips: "studyTips",
  weakness_scan: "weakness",
  feedback: "feedback",
  standards_draft: "standards",
};

function planStepsFor(taskType) {
  if (taskType === "curriculum_check") {
    return ["curriculumWatcher"];
  }
  const gen = TASK_TYPE_TO_GENERATOR[taskType];
  if (!gen) return null;
  return ["curriculumReader", gen, "qualityCheck"];
}

async function runSupervisor({task}) {
  const startedAt = Date.now();
  await updateLiveAgentState(AGENT_ID, {status: "running", currentTaskId: task.id});

  const steps = planStepsFor(task.taskType);
  if (!steps) {
    await writeAgentLog({
      agentId: AGENT_ID,
      taskId: task.id,
      correlationId: task.correlationId || null,
      action: "plan",
      inputSummary: {taskType: task.taskType},
      outputSummary: {reason: "unsupported_task_type"},
      level: "error",
      curriculumGrounded: false,
      durationMs: Date.now() - startedAt,
    });
    await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});
    return {ok: false, reason: "unsupported_task_type"};
  }

  const supervisorPlan = {
    steps: steps.map((agentId, i) => ({
      agentId,
      stepNumber: i + 1,
      status: "pending",
    })),
    currentStep: 0,
    nextAgentId: steps[0],
    ...DEFAULT_TASK_BUDGET,
    plannedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await admin.firestore()
      .collection("aiAgentTasks")
      .doc(task.id)
      .set({
        supervisorPlan,
        agentId: AGENT_ID,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

  await writeAgentLog({
    agentId: AGENT_ID,
    taskId: task.id,
    correlationId: task.correlationId || null,
    action: "plan",
    inputSummary: {taskType: task.taskType, grade: task.grade, subject: task.subject},
    outputSummary: {steps, budget: DEFAULT_TASK_BUDGET},
    level: "info",
    curriculumGrounded: false,
    durationMs: Date.now() - startedAt,
  });

  await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});
  return {ok: true, supervisorPlan};
}

module.exports = {runSupervisor, planStepsFor, AGENT_ID};
