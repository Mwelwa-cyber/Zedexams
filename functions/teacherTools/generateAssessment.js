/**
 * generateAssessment — HTTPS callable Cloud Function.
 *
 * A formal graded test grounded on the verified curriculum module for the
 * selected grade + sub-topic + term. Persists to `aiGenerations` with
 * `tool: 'assessment'`. (Distinct from the quiz editor / Assessment Studio,
 * which manage the quizzes collection — this produces a saved, exportable
 * assessment document like worksheet/full-lesson.)
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {
  ASSESSMENT_TYPES,
  resolveAssessmentFormatContext,
  normalizeQuestionTypes,
} = require("./assessmentFormats");
const {validateAssessment} = require("./assessmentSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV9");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");
const {sourceAssessmentFromBank} = require("./masterBankSourcing");
const {buildAvoidNote, mergeSourcedIntoSections} = require("./masterBankSourcingCore");
const {checkAssessmentQuality, interleaveSections} =
  require("./assessmentQualityCheck");

// The assessment types the Master Bank can supply (the rest — structured,
// calculation, essay, matching — stay AI-only).
const BANK_ASSESSMENT_TYPES = ["multiple_choice", "true_false", "short_answer"];
// Cap on how much of a paper (by marks) may be filled from the bank; the AI
// always authors the rest.
const BANK_MARKS_SHARE = 0.5;

const ASSESSMENT_MODEL =
  process.env.ASSESSMENT_MODEL || "claude-sonnet-4-6";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

const ASSESSMENT_TOOL_SCHEMA = {
  type: "object",
  description: "A formal graded Zambian CBC assessment.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
  },
};

const {ALLOWED_GRADES, ALLOWED_SUBJECTS} =
  require("./assessmentAllowlists");
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const assessmentType = str(raw.assessmentType, 30).toLowerCase();

  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
      .toLowerCase().replace(/[^a-z_]/g, "_");

  return {
    grade,
    subject,
    topic: str(raw.topic, 240),
    subtopic: str(raw.subtopic, 300),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    totalMarks: Math.min(100, Math.max(5,
        Math.round(num(raw.totalMarks, 20)))),
    durationMinutes: Math.min(180, Math.max(10,
        Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    questionTypes: normalizeQuestionTypes(raw.questionTypes),
    instructions: str(raw.instructions, 500),
    assessmentType: ASSESSMENT_TYPES.includes(assessmentType) ?
      assessmentType : "topic_test",
    // Curriculum framework the teacher chose: new CBC (default) or the
    // old 2013 syllabus. resolveCbcContext grounds on the matching
    // syllabi data file.
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    // Smart sourcing is on by default; a client can opt out ("fresh
    // questions only") by sending useQuestionBank: false.
    useQuestionBank: raw.useQuestionBank !== false,
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a valid grade.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  if (!inputs.topic) {
    errs.push("Please provide a topic.");
  }
  return errs;
}

async function runAssessment({uid, rawInputs, apiKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  const [
    {contextBlock, kbMatch, kbWarning, kbVersion},
    {formatBlock, formatProfileId, formatSource},
    usage,
  ] = await Promise.all([
    resolveCbcContext({
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      subtopic: inputs.subtopic,
      term: inputs.term,
      lessonNumber: inputs.lessonNumber,
      totalLessons: inputs.totalLessons,
      learningEnvironment: inputs.learningEnvironment,
      framework: inputs.framework,
      ownerUid: uid,
    }),
    resolveAssessmentFormatContext({
      grade: inputs.grade,
      subject: inputs.subject,
      assessmentType: inputs.assessmentType,
      allowedTypes: inputs.questionTypes,
    }),
    assertAndIncrement(uid, "assessment"),
  ]);

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "assessment",
    inputs,
    output: null,
    outputText: "",
    modelUsed: ASSESSMENT_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion,
    formatProfileId,
    formatSource,
    tokensIn: 0,
    tokensOut: 0,
    costUsdCents: 0,
    status: "generating",
    errorMessage: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    teacherEdited: false,
    exportedFormats: [],
    visibility: "private",
  });

  // Smart Paper Generation — fill up to ~half the marks from the Master Bank,
  // then ask the AI to author only the remainder. Best-effort: an empty/
  // unmatched bank sources nothing and the flow is identical to before.
  let sourced = {questions: [], fromBank: 0, marks: 0, scanned: 0};
  if (inputs.useQuestionBank) {
    const allowedTypes = inputs.questionTypes && inputs.questionTypes.length ?
      inputs.questionTypes : BANK_ASSESSMENT_TYPES;
    sourced = await sourceAssessmentFromBank({
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      marksBudget: Math.round(inputs.totalMarks * BANK_MARKS_SHARE),
      allowedTypes,
    });
  }
  // Marks the AI still needs to author. >= ~half by construction, so the model
  // is always called and always produces a coherent paper.
  const gapMarks = Math.max(1, inputs.totalMarks - sourced.marks);

  const userPrompt = buildUserPrompt({...inputs, totalMarks: gapMarks}) +
    buildAvoidNote(sourced.questions);

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = ASSESSMENT_MODEL;
  try {
    const response = await callClaude(apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      formatContextBlock: formatBlock,
      messages: [{role: "user", content: userPrompt}],
      // Output budget scales with the marks the AI actually authors (the gap
      // after sourcing); ~130 tokens covers a question with options, answer and
      // marking guide; capped at 16k. Output tokens are billed as used.
      maxTokens: Math.min(16000, 3000 + gapMarks * 130),
      temperature: 0.4,
      model: ASSESSMENT_MODEL,
      // Streamed internally (tool deltas accumulate to the same parsed
      // object as mode:"tool"). Anthropic drops idle non-streaming
      // connections on long generations — large max_tokens without
      // streaming is exactly the case their docs warn about, and big
      // papers were dying with "AI is temporarily unavailable".
      mode: "stream",
      onToken: () => {},
      toolName: "emit_assessment",
      toolDescription:
        "Emit the complete assessment as a single structured object. Do " +
        "not include any prose or commentary outside this tool call.",
      toolInputSchema: ASSESSMENT_TOOL_SCHEMA,
    });
    parsed = response.parsed;
    raw = response.text || "";
    usageInfo = response.usage || usageInfo;
    modelUsed = response.model || modelUsed;
  } catch (err) {
    await genRef.update({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    });
    // The AI call failed with a hard throw — no usable assessment was returned.
    // Refund the credit or roll back the counter so the teacher is not charged
    // for a transient failure. Best-effort: must not mask the original error,
    // but a failed refund leaves the teacher's quota silently decremented, so
    // it must at least be traceable in the logs.
    try {
      await refundGeneration(uid, usage, "assessment");
    } catch (refundErr) {
      console.error("[generateAssessment] refund failed after generation error",
          {uid, generationId: genRef.id}, refundErr);
    }
    throw err;
  }

  // Merge the Master Bank questions into the model's sections (by type), then
  // validate the combined paper — validateAssessment renumbers globally and
  // recomputes the marks totals, so the merged paper stays consistent.
  const mergedParsed = (parsed && typeof parsed === "object") ? {...parsed} : {};
  mergedParsed.sections = mergeSourcedIntoSections(mergedParsed.sections, sourced.questions);

  // Assessment Quality Checker (deterministic, no LLM). If the model grouped a
  // topic into a worksheet-style block AND the questions carry topic tags,
  // re-order them so topics rotate through the paper — BEFORE validation, so
  // validateAssessment renumbers the mixed sequence cleanly. Advisory only:
  // the remaining findings surface as non-blocking warnings, never a block.
  const requestedTopics = String(inputs.topic || "")
      .split(/[;\n]+/).map((t) => t.trim()).filter(Boolean);
  const preCheck = checkAssessmentQuality(mergedParsed,
      {grade: inputs.grade, topics: requestedTopics});
  let didReorder = false;
  if (preCheck.clustered && preCheck.topicsTagged) {
    mergedParsed.sections = interleaveSections(mergedParsed.sections);
    didReorder = true;
  }

  const validation = validateAssessment(mergedParsed);
  const assessment = validation.value;
  // Final report on the validated paper (post-reorder), persisted + returned so
  // the studio can surface the quality summary to the teacher.
  const quality = checkAssessmentQuality(assessment,
      {grade: inputs.grade, topics: requestedTopics});
  quality.reordered = didReorder;
  const totalQuestions = assessment.sections
      .reduce((sum, s) => sum + (s.questions ? s.questions.length : 0), 0);
  const sourcing = {
    fromBank: sourced.fromBank,
    generated: Math.max(0, totalQuestions - sourced.fromBank),
    marks: sourced.marks,
    scanned: sourced.scanned,
    aiCalled: true,
  };

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: assessment,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
      sourcing,
      quality,
    });
    return {
      generationId: genRef.id,
      assessment,
      usage,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
      sourcing,
      quality,
    };
  }

  await genRef.update({
    status: "complete",
    output: assessment,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    sourcing,
    quality,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    assessment,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
    sourcing,
    quality,
  };
}

function createGenerateAssessment(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 240,
        memory: "512MiB"},
      async (request) => {
        const uid = request.auth && request.auth.uid;
        if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        return runAssessment({uid, rawInputs: request.data, apiKey});
      },
  );
}

module.exports = {
  createGenerateAssessment, runAssessment, sanitizeInputs,
  normalizeQuestionTypes,
  ALLOWED_SUBJECTS, ALLOWED_GRADES,
};
