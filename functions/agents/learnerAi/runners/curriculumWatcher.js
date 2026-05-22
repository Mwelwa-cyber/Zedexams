/**
 * Curriculum Update Checker Agent (stub).
 *
 * Daily scheduled job. Compares stored sha256 in approvedSyllabi
 * against the live Storage object metadata; flags changed blobs and
 * stale learnerAiGenerations docs that referenced them. Writes ONE
 * curriculumUpdateReports doc per scan. Never mutates cbcKnowledgeBase.
 *
 * The stub body writes an empty report so the scheduled function is
 * observable today. A future PR fills in the SHA comparison.
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState} = require("../logger");

const AGENT_ID = "curriculumWatcher";

async function runCurriculumWatcher({task} = {}) {
  const startedAt = Date.now();
  await updateLiveAgentState(AGENT_ID, {status: "running", currentTaskId: task && task.id || null});

  const report = {
    schemaVersion: 1,
    kbVersion: "cbc-kb-2026-04-seed",
    scannedAt: admin.firestore.FieldValue.serverTimestamp(),
    scannedBy: AGENT_ID,
    newDocuments: [],
    changedDocuments: [],
    staleKbModules: [],
    staleLearnerArtifacts: [],
    requiresAdminAction: false,
    note: "Stub scan — SHA comparison and staleness analysis pending.",
  };

  const ref = await admin.firestore()
      .collection("curriculumUpdateReports")
      .add(report);

  await writeAgentLog({
    agentId: AGENT_ID,
    taskId: task && task.id || null,
    action: "curriculum_scan",
    inputSummary: {kbVersion: report.kbVersion},
    outputSummary: {reportId: ref.id, stub: true},
    level: "info",
    curriculumGrounded: false,
    durationMs: Date.now() - startedAt,
  });

  await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});
  return {ok: true, reportId: ref.id};
}

module.exports = {runCurriculumWatcher, AGENT_ID};
