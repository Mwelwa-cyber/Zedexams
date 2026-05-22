/**
 * Curriculum Update Checker Agent — v2.
 *
 * Daily scheduled job. Writes a curriculumUpdateReports doc in the v2
 * schema (sourceName, sourceUrl, trustLevel, updateType, affectedGrades,
 * affectedSubjects, summary, recommendation, status, checkedAt,
 * reviewedBy, reviewedAt). Stub body until SHA comparison + diff
 * extraction land.
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState} = require("../logger");
const {COLLECTIONS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "Curriculum Update Checker Agent";

async function runCurriculumWatcher({task} = {task: {id: `scheduled-${Date.now()}`}}) {
  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID, status: "running", currentTaskId: task && task.id || null,
    currentTask: "Scan approvedSyllabi", progress: 0,
    lastMessage: "Starting scheduled scan",
  });

  const report = {
    sourceName: "ZedExams Approved Syllabi index",
    sourceUrl: "https://zedexams.com/admin/cbc-kb",
    trustLevel: "very_high",
    updateType: "syllabus",
    affectedGrades: [],
    affectedSubjects: [],
    summary: "Stub scan: no diff engine implemented yet.",
    recommendation: "No action required.",
    status: "pending_review",
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: null,
    reviewedAt: null,
  };

  const ref = await admin.firestore()
      .collection(COLLECTIONS.CURRICULUM_REPORTS)
      .add(report);

  await writeAgentLog({
    taskId: task && task.id || "",
    agentName: AGENT_ID, action: "curriculum_scan",
    message: `Wrote ${COLLECTIONS.CURRICULUM_REPORTS}/${ref.id} (stub)`,
    taskType: "curriculum_update_check",
    grade: null, subject: null, topic: null,
    severity: SEVERITY.INFO,
  });

  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `Wrote report ${ref.id}`,
  });
  return {ok: true, reportId: ref.id};
}

module.exports = {runCurriculumWatcher, AGENT_ID};
