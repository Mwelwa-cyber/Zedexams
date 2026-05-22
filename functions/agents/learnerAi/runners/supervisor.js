/**
 * AI Supervisor Agent — v2.
 *
 * The orchestrator. Decides which agents to run for each task type and
 * in what order. Returns the plan to the dispatcher as a JS array
 * (not persisted on aiAgentTasks — v2 schema doesn't carry it; steps
 * are observable through the aiTaskSteps collection instead).
 *
 * Step plans by taskType:
 *   practice_quiz, exam_quiz, notes, study_tips, learner_feedback,
 *   weakness_analysis        → [curriculumReader, <generator>, qualityCheck]
 *   curriculum_update_check  → [curriculumWatcher]
 */

const {writeAgentLog, updateLiveAgentState, writeTaskStep} = require("../logger");
const {TASK_STATUS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "AI Supervisor Agent";

const TASK_TYPE_TO_GENERATOR = Object.freeze({
  practice_quiz:     "practiceQuiz",
  exam_quiz:         "examQuiz",
  notes:             "notes",
  study_tips:        "studyTips",
  weakness_analysis: "weakness",
  learner_feedback:  "feedback",
});

function planStepsFor(taskType) {
  if (taskType === "curriculum_update_check") {
    return ["curriculumWatcher"];
  }
  const gen = TASK_TYPE_TO_GENERATOR[taskType];
  if (!gen) return null;
  // exam_quiz: insert Standards between Reader and the generator so
  // the formal Zambian school test structure (sections, marks, time,
  // Blooms mix) is available on chainContext.standards when the
  // generator runs. Every other task type uses the slim
  // [Reader → generator → QualityCheck] chain.
  if (taskType === "exam_quiz") {
    return ["curriculumReader", "standards", gen, "qualityCheck"];
  }
  return ["curriculumReader", gen, "qualityCheck"];
}

async function runSupervisor({task}) {
  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID,
    status: TASK_STATUS.RUNNING,
    currentTaskId: task.id,
    currentTask: `Plan ${task.taskType}`,
    progress: 0,
    grade: task.grade || null,
    subject: task.subject || null,
    term: task.term || null,
    topic: task.topic || null,
    subtopic: task.subtopic || null,
    lastMessage: "Planning step graph",
  });

  const steps = planStepsFor(task.taskType);
  if (!steps) {
    await writeAgentLog({
      taskId: task.id,
      agentName: AGENT_ID,
      action: "plan",
      message: `Unsupported task type: ${task.taskType}`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "failed", currentTaskId: null, lastMessage: "unsupported_task_type",
    });
    return {ok: false, reason: "unsupported_task_type"};
  }

  // Pre-create one aiTaskSteps row per planned step (status:'queued')
  // so the UI can render the full plan immediately. Each runner then
  // updates its own step record to 'running'/'completed'/'failed'.
  for (let i = 0; i < steps.length; i++) {
    await writeTaskStep({
      taskId: task.id,
      agentName: steps[i],
      stepNumber: i + 1,
      stepTitle: `Run ${steps[i]}`,
      message: `Planned by ${AGENT_ID}`,
      status: TASK_STEP_STATUS.QUEUED,
      progress: 0,
    });
  }

  await writeAgentLog({
    taskId: task.id,
    agentName: AGENT_ID,
    action: "plan",
    message: `Planned ${steps.length} steps: ${steps.join(" → ")}`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: SEVERITY.INFO,
  });

  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `Planned ${steps.length} steps`,
  });
  return {ok: true, steps};
}

module.exports = {runSupervisor, planStepsFor, AGENT_ID, TASK_TYPE_TO_GENERATOR};
