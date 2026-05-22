/**
 * Curriculum Reader Agent — v2.
 *
 * The safety gate. Resolves the strict curriculumReference from the
 * KB+approvedSyllabi pair, or refuses. Returns the resolved reference
 * in-memory to the dispatcher, which carries it forward in
 * `chainContext.curriculumReference` for the generator + Quality Check
 * to consume. Nothing is written onto aiAgentTasks (v2 schema doesn't
 * carry curriculum metadata).
 *
 * The resolved curriculumReference shape matches the Zod schema in
 * src/schemas/learnerAi.js → curriculumReferenceSchema:
 *
 *   { documentPath, competency, learningOutcome, sourceVersion }
 *
 * It is written into aiGeneratedContent.curriculumReference by the
 * generator runners (via _stubFactory.js).
 */

const {resolveStrictCurriculumRef} = require("../curriculumResolver");
const {writeAgentLog, updateLiveAgentState, writeTaskStep} = require("../logger");
const {TASK_STATUS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "Curriculum Reader Agent";

function asCurriculumReference(resolved) {
  // resolved.curriculumRef has the v1 shape; project it onto the v2
  // curriculumReferenceSchema shape ({ documentPath, competency,
  // learningOutcome, sourceVersion }) but ALSO keep the v1 cited
  // excerpts in-memory so the Quality Check substring-grounding pass
  // still works. We do NOT persist excerpts onto aiGeneratedContent
  // (the user's v2 schema doesn't include them in curriculumReference),
  // so they live only in the in-memory chain context.
  const v1 = resolved.curriculumRef;
  return {
    persist: {
      documentPath: v1.storagePath || "",
      competency: v1.competency || "",
      learningOutcome: v1.learningOutcome || null,
      sourceVersion: v1.kbVersion || null,
    },
    inMemory: {
      sourceDocId: v1.sourceDocId,
      moduleId: v1.moduleId,
      citedExcerpts: v1.citedExcerpts || [],
      sourceChecksums: v1.sourceChecksums || [],
      topicCode: v1.topicCode || "",
      subtopicCode: v1.subtopicCode || "",
      competenceCode: v1.competenceCode || "",
    },
  };
}

async function runCurriculumReader({task, stepNumber = 1}) {
  const input = {
    grade: task.grade,
    subject: task.subject,
    topic: task.topic,
    subtopic: task.subtopic,
    term: task.term,
  };

  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID,
    status: TASK_STATUS.CHECKING,
    currentTaskId: task.id,
    currentTask: `Resolve curriculum for ${input.topic || input.subject || ""}`,
    progress: 10,
    grade: input.grade, subject: input.subject, topic: input.topic,
    subtopic: input.subtopic, term: input.term,
    lastMessage: "Looking up approved syllabus reference",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Resolve curriculum reference",
    message: "Reading cbcKnowledgeBase + approvedSyllabi",
    status: TASK_STEP_STATUS.RUNNING, progress: 25,
  });

  const result = await resolveStrictCurriculumRef(input);

  if (!result.ok) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "resolve_curriculum",
      message: `Refused: ${result.reason}`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.WARNING,
    });
    await writeTaskStep({
      taskId: task.id, agentName: AGENT_ID, stepNumber,
      stepTitle: "Resolve curriculum reference",
      message: `Refused: ${result.reason}`,
      status: TASK_STEP_STATUS.FAILED, progress: 100,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "failed", currentTaskId: null, lastMessage: result.reason,
    });
    return {ok: false, reason: result.reason};
  }

  const projected = asCurriculumReference(result);

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "resolve_curriculum",
    message: `Grounded: ${projected.inMemory.sourceDocId} (${projected.inMemory.citedExcerpts.length} excerpts)`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Resolve curriculum reference",
    message: `Grounded in ${projected.persist.documentPath}`,
    status: TASK_STEP_STATUS.COMPLETED, progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: `Grounded in ${projected.persist.documentPath}`,
  });

  return {ok: true, curriculumReference: projected};
}

module.exports = {runCurriculumReader, AGENT_ID, asCurriculumReference};
