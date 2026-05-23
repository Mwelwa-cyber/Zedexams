/**
 * Stub-runner factory — v2.
 *
 * Each generator runner (practiceQuiz / examQuiz / notes / studyTips /
 * weakness / feedback / standards) writes an aiGeneratedContent doc
 * end-to-end. Until the LLM body lands, the factory writes a stub
 * artifact so the pipeline is observable today.
 *
 * Schema fields (mirrors src/schemas/learnerAi.js → aiGeneratedContentWriteSchema):
 *   type, source:'ai', status, grade, subject, term, topic, subtopic,
 *   lessonNumber, curriculumReference, content, qualityCheck,
 *   zambianStandardsCheck, supervisorDecision, version, createdBy:'ai',
 *   reviewedBy, createdAt, updatedAt
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState, writeTaskStep} = require("../logger");
const {
  recordGenerationUsage, countQuestionsInContent,
} = require("../automationGate");
const {recordContentVersion, CHANGE_TYPES: VERSION_CHANGE_TYPES} =
  require("../versionRecorder");
const {COLLECTIONS, CONTENT_STATUS, TASK_STATUS, TASK_STEP_STATUS, SEVERITY} =
  require("../v2Collections");

function buildStubContent({agentId, curriculumReference, curriculumReader}) {
  const inMem = curriculumReference && curriculumReference.inMemory;
  return {
    stub: true,
    note: `Stub output from ${agentId}. Replace with LLM-backed body once ` +
      `${agentId} prompt + schema are reviewed.`,
    citedExcerptCount: inMem && Array.isArray(inMem.citedExcerpts) ?
      inMem.citedExcerpts.length : 0,
    // Curriculum Reader v2 surface — surfaces structured context the
    // real LLM body will eventually condition on. Admin can sanity-
    // check the pipeline by glancing at these.
    curriculumReaderConfidence: curriculumReader && typeof curriculumReader.confidenceScore === "number" ?
      curriculumReader.confidenceScore : null,
    curriculumReaderStatus: curriculumReader ? curriculumReader.status : null,
    curriculumReaderMatchKind: curriculumReader ? curriculumReader.matchKind : null,
    keyConceptCount: curriculumReader && Array.isArray(curriculumReader.keyConcepts) ?
      curriculumReader.keyConcepts.length : 0,
    suggestedContentCount: curriculumReader && Array.isArray(curriculumReader.suggestedContent) ?
      curriculumReader.suggestedContent.length : 0,
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.agentId       e.g. "practiceQuiz"
 * @param {("practice_quiz"|"exam_quiz"|"notes"|"study_tips"|"learner_feedback")} cfg.artifactType
 * @param {(args:{task,curriculumReference,curriculumReader,standards}) => Promise<{content:object, modelUsed?:string}>} [cfg.runLive]
 *        Optional live runner. When omitted, the factory writes a stub
 *        aiGeneratedContent doc with content:{stub:true}. Receives the
 *        full chainContext.curriculumReader (v2 agent contract), the
 *        slim chainContext.curriculumReference audit slice, and the
 *        chainContext.standards object (set for exam_quiz tasks, null
 *        for everything else).
 */
function makeRunner(cfg) {
  const AGENT_ID = cfg.agentId;

  return async function run({task, chainContext = {}, stepNumber = 2}) {
    const curriculumReference = chainContext.curriculumReference;
    if (!curriculumReference || !curriculumReference.persist) {
      await writeAgentLog({
        taskId: task.id, agentName: AGENT_ID, action: "generate",
        message: "Refused: missing curriculumReference",
        taskType: task.taskType,
        grade: task.grade, subject: task.subject, topic: task.topic,
        severity: SEVERITY.WARNING,
      });
      await writeTaskStep({
        taskId: task.id, agentName: AGENT_ID, stepNumber,
        stepTitle: `Generate ${cfg.artifactType}`,
        message: "Missing curriculumReference",
        status: TASK_STEP_STATUS.FAILED, progress: 100,
      });
      return {ok: false, reason: "missing_curriculum_ref"};
    }

    await updateLiveAgentState(AGENT_ID, {
      agentName: AGENT_ID,
      status: TASK_STATUS.GENERATING,
      currentTaskId: task.id,
      currentTask: `Generate ${cfg.artifactType}`,
      progress: 25,
      grade: task.grade, subject: task.subject, term: task.term,
      topic: task.topic, subtopic: task.subtopic,
      lastMessage: `Generating ${cfg.artifactType}`,
    });
    await writeTaskStep({
      taskId: task.id, agentName: AGENT_ID, stepNumber,
      stepTitle: `Generate ${cfg.artifactType}`,
      message: "Calling generator",
      status: TASK_STEP_STATUS.RUNNING, progress: 50,
    });

    let content;
    if (typeof cfg.runLive === "function") {
      try {
        const live = await cfg.runLive({
          task, curriculumReference,
          curriculumReader: chainContext.curriculumReader,
          standards: chainContext.standards || null,
        });
        content = live.content;
      } catch (err) {
        await writeAgentLog({
          taskId: task.id, agentName: AGENT_ID, action: "generate",
          message: `Threw: ${String(err && err.message || err).slice(0, 400)}`,
          taskType: task.taskType,
          grade: task.grade, subject: task.subject, topic: task.topic,
          severity: SEVERITY.ERROR,
        });
        await writeTaskStep({
          taskId: task.id, agentName: AGENT_ID, stepNumber,
          stepTitle: `Generate ${cfg.artifactType}`,
          message: String(err && err.message || err).slice(0, 200),
          status: TASK_STEP_STATUS.FAILED, progress: 100,
        });
        await updateLiveAgentState(AGENT_ID, {
          status: "failed", currentTaskId: null,
          lastMessage: "runner_error",
        });
        return {ok: false, reason: "runner_error"};
      }
    } else {
      content = buildStubContent({
        agentId: AGENT_ID,
        curriculumReference,
        curriculumReader: chainContext.curriculumReader,
      });
    }

    // Build the v2 aiGeneratedContent doc.
    const docPayload = {
      type: cfg.artifactType,
      source: "ai",
      status: CONTENT_STATUS.NEEDS_REVIEW,
      grade: String(task.grade || ""),
      subject: String(task.subject || ""),
      term: String(task.term || ""),
      topic: String(task.topic || ""),
      subtopic: String(task.subtopic || ""),
      lessonNumber: task.lessonNumber ?? null,
      curriculumReference: curriculumReference.persist,
      content,
      qualityCheck: {},
      zambianStandardsCheck: {},
      supervisorDecision: {},
      version: 1,
      createdBy: "ai",
      reviewedBy: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await admin.firestore()
        .collection(COLLECTIONS.CONTENT)
        .add(docPayload);

    // Fire-and-forget usage metering. Never blocks or fails the
    // chain — `recordGenerationUsage` swallows its own errors.
    recordGenerationUsage({
      contentType: cfg.artifactType,
      questionCount: countQuestionsInContent(cfg.artifactType, content),
    }).catch(() => { /* swallow — metering is best-effort */ });

    // Append the initial version snapshot (v1) to the audit trail.
    // The parent's `version: 1` field was just stamped above — we
    // mirror that into aiGeneratedContentVersions/{} so future
    // transitions (approved / published / rejected) bump from a
    // known starting point. Fire-and-forget — `recordContentVersion`
    // swallows its own errors.
    recordContentVersion({
      contentId: ref.id,
      content,
      changedBy: `agent:${AGENT_ID}`,
      changeType: VERSION_CHANGE_TYPES.AI_GENERATED,
      changeReason: null,
      isInitial: true,
    }).catch(() => { /* swallow — versioning is best-effort */ });

    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "generate",
      message: `Wrote aiGeneratedContent/${ref.id} (${content && content.stub ? "stub" : "live"})`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.INFO,
    });
    await writeTaskStep({
      taskId: task.id, agentName: AGENT_ID, stepNumber,
      stepTitle: `Generate ${cfg.artifactType}`,
      message: `Wrote aiGeneratedContent/${ref.id}`,
      status: TASK_STEP_STATUS.COMPLETED, progress: 100,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "completed", currentTaskId: null, progress: 100,
      lastMessage: `Wrote ${ref.id}`,
    });

    return {ok: true, contentId: ref.id, content};
  };
}

module.exports = {makeRunner};
