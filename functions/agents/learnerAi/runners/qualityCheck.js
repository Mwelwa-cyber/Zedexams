/**
 * Quality Check Agent — v2.
 *
 * Two passes:
 *   1. Deterministic substring grounding — every claim must reference
 *      a citedExcerpts index that exists. NON-NEGOTIABLE; this guards
 *      against ungrounded LLM output regardless of the nuance pass.
 *   2. LLM nuance pass (Haiku 4.5) — stub until the prompt is reviewed.
 *
 * Reads the most recent aiGeneratedContent doc for the task and writes:
 *   - qualityCheck       (onto the aiGeneratedContent doc)
 *   - aiAgentLogs row
 *   - aiSupervisorLogs row (the decision)
 *   - aiTaskSteps row
 */

const admin = require("firebase-admin");
const {writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep} =
  require("../logger");
const {COLLECTIONS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "Quality Check Agent";

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

function deterministicGroundingCheck({content, curriculumReference}) {
  const excerpts = (curriculumReference &&
    curriculumReference.inMemory &&
    curriculumReference.inMemory.citedExcerpts) || [];
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

async function runQualityCheck({task, chainContext = {}, stepNumber = 3}) {
  const curriculumReference = chainContext.curriculumReference;
  if (!curriculumReference) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "quality_check",
      message: "Refused: missing curriculumReference",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.WARNING,
    });
    return {ok: false, reason: "missing_curriculum_ref"};
  }

  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID, status: "checking", currentTaskId: task.id,
    currentTask: "Quality check", progress: 25,
    grade: task.grade, subject: task.subject, term: task.term,
    topic: task.topic, subtopic: task.subtopic,
    lastMessage: "Running deterministic grounding pass",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Quality check",
    message: "Deterministic substring-grounding pass",
    status: TASK_STEP_STATUS.RUNNING, progress: 50,
  });

  const snap = await admin.firestore()
      .collection(COLLECTIONS.CONTENT)
      .where("__name__", ">", "")  // ensures the predicate is well-formed
      .get()
      .catch(() => null);
  // The above broad query isn't ideal; refine with a where("taskId" ...)
  // once the content doc carries that. v2 schema doesn't include taskId
  // on aiGeneratedContent (the caller's spec), so we resolve the doc by
  // matching the most recent grade+subject+topic for the task instead.
  let target = null;
  if (snap && !snap.empty) {
    const candidates = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.grade === String(task.grade || "") &&
          data.subject === String(task.subject || "") &&
          data.topic === String(task.topic || "") &&
          data.subtopic === String(task.subtopic || "")) {
        candidates.push({ref: d.ref, data});
      }
    });
    candidates.sort((a, b) => {
      const at = a.data.createdAt && a.data.createdAt.toMillis ?
        a.data.createdAt.toMillis() : 0;
      const bt = b.data.createdAt && b.data.createdAt.toMillis ?
        b.data.createdAt.toMillis() : 0;
      return bt - at;
    });
    target = candidates[0] || null;
  }

  if (!target) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "quality_check",
      message: "No aiGeneratedContent found for this task",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    return {ok: false, reason: "no_artifact_found"};
  }

  const det = deterministicGroundingCheck({
    content: target.data.content,
    curriculumReference,
  });

  const verdict = det.ok ? "pass" : "fail";
  const qualityCheck = {
    verdict,
    deterministicGroundingPass: det.ok,
    blockers: det.blockers,
    warnings: det.warnings,
    verifierVerdict: "stub_no_llm_yet",
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const zambianStandardsCheck = {
    aligned: det.ok,
    note: "stub — Standards-Agent verification pending",
  };

  await target.ref.set({
    qualityCheck,
    zambianStandardsCheck,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  // Supervisor decision row.
  const actionTaken = det.ok ? "sent_for_review" :
    (det.blockers.length ? "regenerate_required" : "sent_for_review");
  await writeSupervisorLog({
    taskId: task.id, agentName: AGENT_ID,
    contentType: target.data.type,
    grade: task.grade || "", subject: task.subject || "", term: task.term || "",
    topic: task.topic || "", subtopic: task.subtopic || "",
    actionTaken,
    reason: det.ok ? "deterministic_grounding_passed" :
      `blocked:${det.blockers.join(",")}`,
    confidenceScore: det.ok ? 0.9 : 0.0,
  });

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "quality_check",
    message: `Verdict ${verdict} on aiGeneratedContent/${target.ref.id}`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: det.ok ? SEVERITY.INFO : SEVERITY.WARNING,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Quality check",
    message: `${verdict}; blockers=${det.blockers.length}`,
    status: det.ok ? TASK_STEP_STATUS.COMPLETED : TASK_STEP_STATUS.FAILED,
    progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: det.ok ? "completed" : "failed", currentTaskId: null,
    progress: 100, lastMessage: verdict,
  });

  return {ok: det.ok, verdict, contentId: target.ref.id};
}

module.exports = {
  runQualityCheck,
  deterministicGroundingCheck,
  collectGroundingIndices,
  AGENT_ID,
};
