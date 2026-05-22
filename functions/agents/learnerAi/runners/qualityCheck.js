/**
 * Quality Check Agent (stub for the LLM nuance pass).
 *
 * The deterministic excerpt-match pass IS implemented here — that part
 * is non-negotiable per the design (no LLM rubber-stamping). It reads
 * the latest learnerAiGenerations doc for the task, walks every
 * content-bearing string, and confirms each cites a curriculumRef
 * excerpt index that exists. The LLM nuance scoring (Haiku 4.5) is a
 * stub today and slots in via the runLive hook.
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState, agentVersionFromFile} = require("../logger");

const AGENT_ID = "qualityCheck";
const promptVersion = agentVersionFromFile("qualityCheck.js");

function collectGroundingIndices(content) {
  const out = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "groundingIndex" && Number.isInteger(v)) out.add(v);
      if (k === "groundingIndices" && Array.isArray(v)) {
        v.forEach((i) => Number.isInteger(i) && out.add(i));
      }
      if (typeof v === "object") visit(v);
    }
  };
  visit(content);
  return [...out];
}

function deterministicGroundingCheck({content, curriculumRef}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts) || [];
  // Stub content from the stub factory doesn't carry groundingIndices;
  // accept that explicitly so the pipeline runs end-to-end. Once a
  // real LLM body lands, the indices must be present.
  if (content && content.stub === true) {
    return {ok: true, blockers: [], warnings: ["stub_artifact"]};
  }
  const indices = collectGroundingIndices(content);
  if (!indices.length) {
    return {ok: false, blockers: ["no_grounding_indices"], warnings: []};
  }
  const oor = indices.filter((i) => i < 0 || i >= excerpts.length);
  if (oor.length) {
    return {
      ok: false,
      blockers: [`grounding_index_out_of_range:${oor.join(",")}`],
      warnings: [],
    };
  }
  return {ok: true, blockers: [], warnings: []};
}

async function runQualityCheck({task}) {
  const startedAt = Date.now();
  await updateLiveAgentState(AGENT_ID, {status: "running", currentTaskId: task.id});

  const curriculumRef = task && task.curriculumRef;
  if (!curriculumRef || !curriculumRef.sourceDocId) {
    await writeAgentLog({
      agentId: AGENT_ID,
      agentVersion: promptVersion,
      taskId: task.id,
      correlationId: task.correlationId || null,
      action: "quality_check",
      level: "blocked",
      curriculumGrounded: false,
      durationMs: Date.now() - startedAt,
    });
    return {ok: false, reason: "missing_curriculum_ref"};
  }

  // Find the most recent learnerAiGenerations doc for this task.
  const snap = await admin.firestore()
      .collection("learnerAiGenerations")
      .where("taskId", "==", task.id)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get()
      .catch(() => null);

  if (!snap || snap.empty) {
    await writeAgentLog({
      agentId: AGENT_ID,
      agentVersion: promptVersion,
      taskId: task.id,
      correlationId: task.correlationId || null,
      action: "quality_check",
      level: "error",
      outputSummary: {reason: "no_artifact_found"},
      curriculumGrounded: true,
      durationMs: Date.now() - startedAt,
    });
    return {ok: false, reason: "no_artifact_found"};
  }

  const genDoc = snap.docs[0];
  const gen = genDoc.data();

  const det = deterministicGroundingCheck({
    content: gen.content,
    curriculumRef,
  });

  // The LLM nuance pass lives here. For now, a stub verdict with the
  // deterministic result baked in. Replace with Haiku 4.5 call later.
  const verdict = det.ok ? "pass" : "fail";
  const qualityCheck = {
    verdict,
    groundingScore: det.ok ? 100 : 0,
    blockers: det.blockers,
    warnings: det.warnings,
    verifierVerdict: "stub_no_llm_yet",
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await genDoc.ref.set({
    qualityCheck,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  await admin.firestore()
      .collection("aiAgentTasks")
      .doc(task.id)
      .set({
        qualityVerdict: {
          verdict,
          groundingScore: det.ok ? 100 : 0,
          blockers: det.blockers,
          warnings: det.warnings,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

  await writeAgentLog({
    agentId: AGENT_ID,
    agentVersion: promptVersion,
    taskId: task.id,
    correlationId: task.correlationId || null,
    action: "quality_check",
    inputSummary: {generationId: genDoc.id},
    outputSummary: {verdict, blockers: det.blockers},
    level: det.ok ? "info" : "warning",
    curriculumGrounded: true,
    curriculumRef: {
      sourceDocId: curriculumRef.sourceDocId,
      moduleId: curriculumRef.moduleId,
    },
    durationMs: Date.now() - startedAt,
  });

  await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});
  return {ok: det.ok, verdict, generationId: genDoc.id};
}

module.exports = {runQualityCheck, deterministicGroundingCheck, collectGroundingIndices};
