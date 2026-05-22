/**
 * Zambian Curriculum & Exam Standards Agent — v2 (live).
 *
 * Reference-data agent. For each (grade, subject, assessmentType)
 * combo this runner resolves the matching `assessmentStandards` doc
 * (the v2 collection from PR #536) and surfaces its `structure` block
 * on `chainContext.standards` so the Exam Quiz Generator + Quality
 * Check can condition on it without each re-reading Firestore.
 *
 * When no approved standard exists yet (very common for fresh
 * deployments), the runner falls back to a per-school-level defaults
 * table derived from typical Zambian school papers. The fallback is
 * clearly labelled (`source:'default'`) so admins can see when a
 * paper was structured against the bundled defaults vs an
 * admin-approved standard.
 *
 * Does NOT call an LLM. Pure reference-data lookup. The Standards
 * agent is also responsible for AUTHORING new standards drafts when
 * triggered explicitly, but that path lives in a separate future
 * task type (`standards_draft`) — out of scope for this PR.
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState, writeTaskStep} = require("../logger");
const {COLLECTIONS, TASK_STATUS, TASK_STEP_STATUS, SEVERITY} =
  require("../v2Collections");

const AGENT_ID = "standards";

// ── Default Zambian assessment structures ────────────────────────────
//
// These are reasonable defaults for typical Zambian school papers
// when no admin-approved `assessmentStandards` doc exists yet. Each
// entry is keyed by assessmentType and roughly mirrors what you'd
// see in an ECZ-style or internal school test.
//
// Section sizing: A = MCQ count, B = short-answer count, C =
// structured-question count. Marks per section roughly: A 1 mark each,
// B 2 marks each, C 5–10 marks each. Bloom's distribution is in
// percentages (sum to 100).

const DEFAULTS = Object.freeze({
  practice_quiz: {
    sectionASize: 6, sectionBSize: 3, sectionCSize: 0,
    totalMarks: 12, timeAllowed: "20 minutes",
    bloomsDistribution: {remember: 40, understand: 30, apply: 20, analyze: 10, evaluate: 0, create: 0},
    paperName: "Practice",
  },
  topic_test: {
    sectionASize: 10, sectionBSize: 5, sectionCSize: 1,
    totalMarks: 25, timeAllowed: "45 minutes",
    bloomsDistribution: {remember: 30, understand: 35, apply: 25, analyze: 10, evaluate: 0, create: 0},
    paperName: "Topic Test",
  },
  monthly_test: {
    sectionASize: 15, sectionBSize: 6, sectionCSize: 2,
    totalMarks: 40, timeAllowed: "1 hour",
    bloomsDistribution: {remember: 25, understand: 30, apply: 30, analyze: 10, evaluate: 5, create: 0},
    paperName: "Monthly Test",
  },
  midterm_test: {
    sectionASize: 20, sectionBSize: 8, sectionCSize: 3,
    totalMarks: 60, timeAllowed: "1 hour 30 minutes",
    bloomsDistribution: {remember: 20, understand: 30, apply: 30, analyze: 15, evaluate: 5, create: 0},
    paperName: "Mid-term Test",
  },
  end_of_term_test: {
    sectionASize: 25, sectionBSize: 10, sectionCSize: 4,
    totalMarks: 80, timeAllowed: "2 hours",
    bloomsDistribution: {remember: 15, understand: 30, apply: 30, analyze: 15, evaluate: 8, create: 2},
    paperName: "End-of-Term Examination",
  },
  composite_exam: {
    sectionASize: 30, sectionBSize: 12, sectionCSize: 5,
    totalMarks: 100, timeAllowed: "2 hours 30 minutes",
    bloomsDistribution: {remember: 15, understand: 25, apply: 30, analyze: 20, evaluate: 8, create: 2},
    paperName: "Composite Revision Exam",
  },
});

/**
 * Look up the admin-approved `assessmentStandards` doc for this
 * (grade, subject, assessmentType) triple. Returns its `structure`
 * block on hit, or null on miss.
 */
async function loadApprovedStandard({grade, subject, assessmentType}) {
  if (!grade || !subject || !assessmentType) return null;
  try {
    const snap = await admin.firestore()
        .collection(COLLECTIONS.ASSESSMENT_STANDARDS)
        .where("grade", "==", String(grade))
        .where("subject", "==", String(subject))
        .where("assessmentType", "==", assessmentType)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() || {};
    if (data.approvedByAdmin !== true) return null;
    return {id: doc.id, ...data};
  } catch (err) {
    console.warn("[standards] loadApprovedStandard failed", err && err.message);
    return null;
  }
}

/**
 * Build the chainContext.standards object. Either pulled from the
 * approved Firestore doc OR derived from DEFAULTS.
 */
function buildStandardsContext({task, approved}) {
  const assessmentType = task.assessmentType ||
    (task.parameters && task.parameters.assessmentType) ||
    "topic_test";
  if (approved) {
    return {
      source: "approved",
      assessmentType,
      structure: approved.structure || {},
      sourceReference: approved.sourceReference || "",
      standardId: approved.id || null,
    };
  }
  const fb = DEFAULTS[assessmentType] || DEFAULTS.topic_test;
  return {
    source: "default",
    assessmentType,
    structure: {
      headerFields: ["School name", "Grade", "Subject", "Term",
        "Year", "Learner name", "Date", "Time"],
      sections: [
        {id: "A", title: "Section A — Multiple Choice",
          questionType: "mcq", count: fb.sectionASize,
          marksPerQuestion: 1, totalMarks: fb.sectionASize},
        {id: "B", title: "Section B — Short Answer",
          questionType: "short_answer", count: fb.sectionBSize,
          marksPerQuestion: 2, totalMarks: fb.sectionBSize * 2},
        {id: "C", title: "Section C — Structured Questions",
          questionType: "structured", count: fb.sectionCSize,
          marksPerQuestion: 10, totalMarks: fb.sectionCSize * 10},
      ],
      instructions: [
        "Answer ALL questions in Sections A and B.",
        "Answer ALL questions in Section C, showing all working.",
        "Write your answers in the spaces provided.",
        "Calculators may NOT be used unless otherwise stated.",
      ],
      markDistribution: {
        sectionA: fb.sectionASize,
        sectionB: fb.sectionBSize * 2,
        sectionC: fb.sectionCSize * 10,
      },
      timeLimit: fb.timeAllowed,
      bloomsDistribution: fb.bloomsDistribution,
      paperName: fb.paperName,
    },
    sourceReference: "ZedExams bundled defaults (no approved standard)",
    standardId: null,
  };
}

async function runStandards({task, stepNumber = 2}) {
  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID,
    status: TASK_STATUS.CHECKING,
    currentTaskId: task.id,
    currentTask: "Resolve assessment standard",
    progress: 25,
    grade: task.grade || null,
    subject: task.subject || null,
    term: task.term || null,
    topic: task.topic || null,
    subtopic: task.subtopic || null,
    lastMessage: "Looking up assessmentStandards",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Resolve assessment standard",
    message: `Looking up (${task.grade}, ${task.subject}, ${task.assessmentType || "?"})`,
    status: TASK_STEP_STATUS.RUNNING, progress: 50,
  });

  const approved = await loadApprovedStandard({
    grade: task.grade,
    subject: task.subject,
    assessmentType: task.assessmentType ||
      (task.parameters && task.parameters.assessmentType) ||
      null,
  });

  const standards = buildStandardsContext({task, approved});

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "resolve_standard",
    message: `source=${standards.source} assessmentType=${standards.assessmentType} ` +
      `time=${standards.structure.timeLimit || "?"}`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: standards.source === "default" ? SEVERITY.WARNING : SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Resolve assessment standard",
    message: `${standards.source} standard for ${standards.assessmentType}`,
    status: TASK_STEP_STATUS.COMPLETED, progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `${standards.source}/${standards.assessmentType}`,
  });

  return {ok: true, standards};
}

module.exports = {
  runStandards,
  loadApprovedStandard,
  buildStandardsContext,
  DEFAULTS,
  AGENT_ID,
};
