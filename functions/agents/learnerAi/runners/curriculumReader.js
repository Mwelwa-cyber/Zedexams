/**
 * Curriculum Reader Agent (Rho) — the safety gate.
 *
 * The only agent that can produce a `curriculumRef`. Every downstream
 * generator refuses to run without a curriculumRef on the task, so this
 * runner is the single chokepoint for "no-guess" enforcement.
 *
 * Pure function — no LLM call. The resolver (curriculumResolver.js)
 * walks the curated CBC KB and the approvedSyllabi index. If nothing
 * matches with a sourceDocId, this runner refuses; the dispatcher then
 * fails the task and writes a blocked-level log.
 */

const admin = require("firebase-admin");
const {resolveStrictCurriculumRef} = require("../curriculumResolver");
const {writeAgentLog, updateLiveAgentState} = require("../logger");

const AGENT_ID = "curriculumReader";

async function runCurriculumReader({task}) {
  const startedAt = Date.now();
  const input = {
    grade: task.grade,
    subject: task.subject,
    topic: task.topic,
    subtopic: task.subtopic,
    term: task.term,
  };

  await updateLiveAgentState(AGENT_ID, {status: "running", currentTaskId: task.id});

  const result = await resolveStrictCurriculumRef(input);

  if (!result.ok) {
    await writeAgentLog({
      agentId: AGENT_ID,
      taskId: task.id,
      correlationId: task.correlationId || null,
      action: "resolve_curriculum_ref",
      inputSummary: input,
      outputSummary: {reason: result.reason, suggestions: result.suggestions},
      level: "blocked",
      curriculumGrounded: false,
      durationMs: Date.now() - startedAt,
    });
    await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});
    return {ok: false, reason: result.reason, suggestions: result.suggestions};
  }

  await writeAgentLog({
    agentId: AGENT_ID,
    taskId: task.id,
    correlationId: task.correlationId || null,
    action: "resolve_curriculum_ref",
    inputSummary: input,
    outputSummary: {
      sourceDocId: result.curriculumRef.sourceDocId,
      moduleId: result.curriculumRef.moduleId,
      excerptCount: result.curriculumRef.citedExcerpts.length,
    },
    level: "info",
    curriculumGrounded: true,
    curriculumRef: {
      sourceDocId: result.curriculumRef.sourceDocId,
      moduleId: result.curriculumRef.moduleId,
      kbVersion: result.curriculumRef.kbVersion,
    },
    durationMs: Date.now() - startedAt,
  });

  await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});

  // Persist the curriculumRef back onto the task so downstream runners
  // pick it up by re-reading the task doc.
  await admin.firestore()
      .collection("aiAgentTasks")
      .doc(task.id)
      .set({
        curriculumRef: result.curriculumRef,
        dataSources: admin.firestore.FieldValue.arrayUnion(
            `approvedSyllabi/${result.curriculumRef.sourceDocId}`,
            `cbcKnowledgeBase/${result.curriculumRef.kbVersion}` +
              `/topics/.../lessons/${result.curriculumRef.moduleId}`,
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

  return {ok: true, curriculumRef: result.curriculumRef};
}

module.exports = {runCurriculumReader, AGENT_ID};
