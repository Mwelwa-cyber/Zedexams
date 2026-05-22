/**
 * Stub-runner factory.
 *
 * Each generator runner (practiceQuiz / examQuiz / notes / studyTips /
 * weakness / feedback / standards / qualityCheck / curriculumWatcher)
 * will eventually call Anthropic with its prompt + schema. Until then,
 * this factory produces a real `learnerAiGenerations` doc with
 * `content:{stub:true}` and the verified curriculumRef attached, so the
 * pipeline is observable end-to-end today.
 *
 * The LLM body slots in here: replace `runStubBody` with the real
 * aiService.callAnthropic call when the corresponding prompt+schema
 * pair is ready for production.
 */

const admin = require("firebase-admin");
const {writeAgentLog, updateLiveAgentState, agentVersionFromFile} = require("../logger");

function buildStubContent({agentId, curriculumRef}) {
  return {
    stub: true,
    note: `Stub output from ${agentId}. Replace with LLM-backed body once ` +
      `${agentId} prompt + schema are reviewed.`,
    citedExcerptCount: (curriculumRef && curriculumRef.citedExcerpts || []).length,
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.agentId         e.g. "practiceQuiz"
 * @param {string} cfg.artifactType    e.g. "practice_quiz"
 * @param {string} cfg.promptFile      filename in prompts/  (for agentVersion)
 * @param {(args) => Promise<object>} [cfg.runLive]
 *        Optional live runner. If omitted, the factory writes a stub
 *        learnerAiGenerations doc. Once a generator's LLM body is
 *        ready, swap in a real runLive here.
 */
function makeRunner(cfg) {
  const AGENT_ID = cfg.agentId;
  const promptVersion = agentVersionFromFile(cfg.promptFile);

  return async function run({task}) {
    const startedAt = Date.now();
    const curriculumRef = task && task.curriculumRef;

    if (!curriculumRef || !curriculumRef.sourceDocId) {
      await writeAgentLog({
        agentId: AGENT_ID,
        agentVersion: promptVersion,
        taskId: task.id,
        correlationId: task.correlationId || null,
        action: "generate",
        inputSummary: {missing: "curriculumRef"},
        level: "blocked",
        curriculumGrounded: false,
        durationMs: Date.now() - startedAt,
      });
      return {ok: false, reason: "missing_curriculum_ref"};
    }

    await updateLiveAgentState(AGENT_ID, {status: "running", currentTaskId: task.id});

    let content;
    let modelUsed = null;
    let tokensIn = 0;
    let tokensOut = 0;
    if (typeof cfg.runLive === "function") {
      try {
        const live = await cfg.runLive({task, curriculumRef, promptVersion});
        content = live.content;
        modelUsed = live.modelUsed || null;
        tokensIn = live.tokensIn || 0;
        tokensOut = live.tokensOut || 0;
      } catch (err) {
        await writeAgentLog({
          agentId: AGENT_ID,
          agentVersion: promptVersion,
          taskId: task.id,
          correlationId: task.correlationId || null,
          action: "generate",
          level: "error",
          inputSummary: {topic: curriculumRef.topic},
          outputSummary: {error: String(err && err.message || err).slice(0, 400)},
          curriculumGrounded: true,
          curriculumRef: {
            sourceDocId: curriculumRef.sourceDocId,
            moduleId: curriculumRef.moduleId,
          },
          durationMs: Date.now() - startedAt,
        });
        await updateLiveAgentState(AGENT_ID, {
          status: "error",
          currentTaskId: null,
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          lastErrorMessage: String(err && err.message || err).slice(0, 400),
        });
        return {ok: false, reason: "runner_error"};
      }
    } else {
      content = buildStubContent({agentId: AGENT_ID, curriculumRef});
    }

    // Write the learnerAiGenerations artifact. Visibility starts at
    // pending_review — only admin approval (via dispatcher onApproved)
    // flips it to published.
    const genRef = await admin.firestore()
        .collection("learnerAiGenerations")
        .add({
          schemaVersion: 1,
          taskId: task.id,
          agentId: AGENT_ID,
          agentVersion: promptVersion,
          artifactType: cfg.artifactType,
          learnerUid: task.learnerUid || null,
          grade: curriculumRef.grade || task.grade || null,
          subject: curriculumRef.subject || task.subject || null,
          term: curriculumRef.term ?? task.term ?? null,
          topic: curriculumRef.topic || task.topic || null,
          subtopic: curriculumRef.subtopic || task.subtopic || null,
          competency: curriculumRef.competency || null,
          learningOutcome: curriculumRef.learningOutcome || null,
          curriculumRef,
          kbVersion: curriculumRef.kbVersion || null,
          content,
          qualityCheck: null,
          visibility: "pending_review",
          piiScrubbed: !task.learnerUid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

    await writeAgentLog({
      agentId: AGENT_ID,
      agentVersion: promptVersion,
      taskId: task.id,
      correlationId: task.correlationId || null,
      action: "generate",
      inputSummary: {topic: curriculumRef.topic, subtopic: curriculumRef.subtopic},
      outputSummary: {
        generationId: genRef.id,
        stub: content && content.stub === true,
      },
      level: "info",
      curriculumGrounded: true,
      curriculumRef: {
        sourceDocId: curriculumRef.sourceDocId,
        moduleId: curriculumRef.moduleId,
      },
      model: modelUsed,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - startedAt,
    });

    await updateLiveAgentState(AGENT_ID, {status: "idle", currentTaskId: null});
    return {ok: true, generationId: genRef.id};
  };
}

module.exports = {makeRunner};
