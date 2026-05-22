/**
 * Append-only logger for the learner-AI pipeline (v2).
 *
 * Writes to:
 *   - aiAgentLogs       — per-step structured audit log (info|warning|error)
 *   - aiLiveAgentStates — per-agent heartbeat + current task
 *   - aiSupervisorLogs  — Supervisor's pass/reject decisions (separate
 *                         from aiAgentLogs because they carry a
 *                         confidence score and are scarcer)
 *   - aiTaskSteps       — per-step execution record
 *
 * v2 schema (mirrors src/schemas/learnerAi.js):
 *   aiAgentLogs/{logId}
 *     { taskId, agentName, action, message, taskType,
 *       grade, subject, topic, severity, createdAt }
 *
 *   aiLiveAgentStates/{agentId}
 *     { agentName, status, currentTaskId, currentTask, progress,
 *       grade, subject, term, topic, subtopic, lastMessage, updatedAt }
 */

const admin = require("firebase-admin");
const {COLLECTIONS, SEVERITY} = require("./v2Collections");

function trim(value, limit) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, limit);
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (err) {
    return String(value).slice(0, limit);
  }
}

/**
 * @param {object} entry
 * @param {string} entry.taskId
 * @param {string} entry.agentName
 * @param {string} entry.action          short verb, e.g. "plan", "generate"
 * @param {string} [entry.message]
 * @param {string} [entry.taskType]
 * @param {string|null} [entry.grade]
 * @param {string|null} [entry.subject]
 * @param {string|null} [entry.topic]
 * @param {("info"|"warning"|"error")} [entry.severity]
 */
async function writeAgentLog(entry) {
  const doc = {
    taskId: String(entry.taskId || ""),
    agentName: String(entry.agentName || "unknown"),
    action: String(entry.action || "noop"),
    message: trim(entry.message, 2000) || "",
    taskType: String(entry.taskType || ""),
    grade: entry.grade ?? null,
    subject: entry.subject ?? null,
    topic: entry.topic ?? null,
    severity: entry.severity || SEVERITY.INFO,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await admin.firestore().collection(COLLECTIONS.LOGS).add(doc);
  } catch (err) {
    // Logging must never fail the pipeline.
    console.warn("writeAgentLog failed", err && err.message);
  }
}

/**
 * @param {object} entry
 * @param {string} entry.taskId
 * @param {string} entry.agentName
 * @param {string} entry.contentType
 * @param {string} entry.grade
 * @param {string} entry.subject
 * @param {string} [entry.term]
 * @param {string} [entry.topic]
 * @param {string} [entry.subtopic]
 * @param {("approved"|"rejected"|"sent_for_review"|"regenerate_required")} entry.actionTaken
 * @param {string} entry.reason
 * @param {number} entry.confidenceScore   0..1
 */
async function writeSupervisorLog(entry) {
  const doc = {
    taskId: String(entry.taskId || ""),
    agentName: String(entry.agentName || "AI Supervisor Agent"),
    contentType: String(entry.contentType || ""),
    grade: String(entry.grade || ""),
    subject: String(entry.subject || ""),
    term: String(entry.term || ""),
    topic: String(entry.topic || ""),
    subtopic: String(entry.subtopic || ""),
    actionTaken: entry.actionTaken,
    reason: trim(entry.reason, 2000) || "",
    confidenceScore: Number.isFinite(entry.confidenceScore) ?
      Math.max(0, Math.min(1, entry.confidenceScore)) : 0,
    checkedBy: "AI Supervisor Agent",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await admin.firestore().collection(COLLECTIONS.SUPERVISOR_LOGS).add(doc);
  } catch (err) {
    console.warn("writeSupervisorLog failed", err && err.message);
  }
}

/**
 * @param {string} agentId
 * @param {object} patch                 partial aiLiveAgentStates fields
 */
async function updateLiveAgentState(agentId, patch) {
  if (!agentId) return;
  try {
    await admin.firestore()
        .collection(COLLECTIONS.LIVE_STATES)
        .doc(agentId)
        .set({
          agentName: agentId,
          ...patch,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
  } catch (err) {
    console.warn("updateLiveAgentState failed", agentId, err && err.message);
  }
}

/**
 * Append a step record. One row per (taskId, stepNumber).
 * @param {object} entry
 * @param {string} entry.taskId
 * @param {string} entry.agentName
 * @param {number} entry.stepNumber
 * @param {string} entry.stepTitle
 * @param {string} [entry.message]
 * @param {("queued"|"running"|"completed"|"failed"|"skipped")} entry.status
 * @param {number} [entry.progress]      0..100
 */
async function writeTaskStep(entry) {
  const doc = {
    taskId: String(entry.taskId || ""),
    agentName: String(entry.agentName || ""),
    stepNumber: Number.isInteger(entry.stepNumber) ? entry.stepNumber : 0,
    stepTitle: trim(entry.stepTitle, 200) || "",
    message: trim(entry.message, 2000) || "",
    status: entry.status,
    progress: Number.isFinite(entry.progress) ?
      Math.max(0, Math.min(100, entry.progress)) : 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await admin.firestore().collection(COLLECTIONS.STEPS).add(doc);
  } catch (err) {
    console.warn("writeTaskStep failed", err && err.message);
  }
}

module.exports = {
  writeAgentLog,
  writeSupervisorLog,
  updateLiveAgentState,
  writeTaskStep,
};
