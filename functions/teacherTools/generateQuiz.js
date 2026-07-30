/**
 * generateQuiz — HTTPS callable Cloud Function.
 *
 * A short, mostly auto-checkable formative quiz grounded on the verified
 * curriculum module for the selected grade + sub-topic + term. Persists to
 * `aiGenerations` with `tool: 'quiz'`. (Distinct from `generateQuizQuestions`
 * / the quiz-editor + Vex subsystem — this produces a saved, exportable
 * quiz document like the other curriculum studios.)
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertGeneratorRateLimit} = require("./generatorRateLimit");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {validateQuiz} = require("./quizSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./quizPrompt");
const {assertAndIncrement} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");
const {sourceQuizFromBank} = require("./masterBankSourcing");
const {buildAvoidNote} = require("./masterBankSourcingCore");

const QUIZ_MODEL = process.env.QUIZ_MODEL || "claude-sonnet-4-6";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

const QUIZ_TOOL_SCHEMA = {
  type: "object",
  description: "A short formative Zambian CBC quiz.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
  },
};

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
]);
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "english", "integrated_science", "social_studies",
  "literacy", "numeracy", "cinyanja", "zambian_language",
  "creative_and_technology_studies",
  "physical_education", "religious_education", "civic_education",
  "biology", "chemistry", "physics", "geography", "history",
  "environmental_science", "technology_studies", "home_economics",
  "expressive_arts",
  // CBC 2023 Forms 1-4 subjects the Syllabus Studio exposes as their own
  // canonical keys (Agricultural Science and Art & Design are shared with
  // the 2013 syllabus).
  "agricultural_science", "art_and_design",
  "commerce_and_principles_of_accounts",
  "design_and_technology_studies", "music_and_creative_arts",
  // ── The 2026-07 subject split ──────────────────────────────────────────
  // Canonical keys carved out of shared ones, each its own examinable subject
  // with its own numbering (see src/utils/subjectSplitClassifier.js). The
  // pre-split spellings above are kept so a saved pick still passes.
  "commerce", "principles_of_accounts",
  "food_and_nutrition", "fashion_and_fabrics", "mathematics_ii",
  "literature_in_english",
  // The 2013 senior RE split: two separately examined ECZ syllabi.
  "religious_education_2044", "religious_education_2046",
  // Not previously listed here, so this generator rejected the pick outright.
  "hospitality_management",
]);
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

  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
      .toLowerCase().replace(/[^a-z_]/g, "_");

  // Curriculum era. Accept the explicit `framework` flag the standardized
  // studio selector sends, and fall back to the `curriculum`/`curriculumMode`
  // ("previous") shape older callers use. Default to 2023 when unspecified.
  const framework =
    String(raw.framework) === "2013" ||
    raw.curriculum === "previous" ||
    raw.curriculumMode === "previous" ? "2013" : "2023";

  return {
    grade,
    subject,
    framework,
    topic: str(raw.topic, 160),
    subtopic: str(raw.subtopic, 200),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    count: Math.min(25, Math.max(3, Math.round(num(raw.count, 10)))),
    durationMinutes: Math.min(120, Math.max(5,
        Math.round(num(raw.durationMinutes, 15)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: str(raw.instructions, 500),
    // Smart sourcing is on by default; a client can opt out (e.g. "fresh
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

async function runQuiz({uid, rawInputs, apiKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  const [{contextBlock, kbMatch, kbWarning, kbVersion}, usage] = await Promise.all([
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
    assertAndIncrement(uid, "quiz"),
  ]);

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "quiz",
    inputs,
    output: null,
    outputText: "",
    modelUsed: QUIZ_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion,
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

  // Smart Paper Generation — pull approved questions from the Master Bank
  // first, then ask the model for only the remainder. Best-effort: on an empty
  // or unmatched bank this returns nothing and the flow is identical to before.
  let sourced = {questions: [], fromBank: 0, scanned: 0};
  if (inputs.useQuestionBank) {
    sourced = await sourceQuizFromBank({
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      count: inputs.count,
    });
  }
  const gap = Math.max(0, inputs.count - sourced.questions.length);

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = QUIZ_MODEL;
  let aiCalled = false;

  // Only call the model when the bank didn't fully cover the quiz. When it
  // did (gap === 0) we skip Anthropic entirely — zero tokens, zero cost.
  if (gap > 0) {
    aiCalled = true;
    const genInputs = {...inputs, count: gap};
    const userPrompt = buildUserPrompt(genInputs) + buildAvoidNote(sourced.questions);
    try {
      const response = await callClaude(apiKey, {
        track: {uid, tool: "quiz"},
        systemPrompt: SYSTEM_PROMPT,
        cbcContextBlock: contextBlock,
        messages: [{role: "user", content: userPrompt}],
        maxTokens: 4500,
        temperature: 0.4,
        model: QUIZ_MODEL,
        mode: "tool",
        toolName: "emit_quiz",
        toolDescription:
          "Emit the complete quiz as a single structured object. Do not " +
          "include any prose or commentary outside this tool call.",
        toolInputSchema: QUIZ_TOOL_SCHEMA,
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
      throw err;
    }
  } else {
    modelUsed = "master_bank";
  }

  // Merge: Master Bank questions first, then any AI-generated ones. Validate
  // the combined paper through the same schema the model output goes through.
  const generatedQuestions = parsed && Array.isArray(parsed.questions) ?
    parsed.questions : [];
  const parsedHeader = (parsed && parsed.header) || {};
  const mergedInput = {
    header: {
      title: parsedHeader.title || `${inputs.topic} quiz`,
      grade: parsedHeader.grade || inputs.grade,
      subject: parsedHeader.subject || inputs.subject,
      topic: parsedHeader.topic || inputs.topic,
      subtopic: parsedHeader.subtopic || inputs.subtopic,
      term: parsedHeader.term != null ? parsedHeader.term : inputs.term,
      durationMinutes: parsedHeader.durationMinutes || inputs.durationMinutes,
      instructions: parsedHeader.instructions,
    },
    questions: [...sourced.questions, ...generatedQuestions],
    answerKey: (parsed && parsed.answerKey) || {},
  };

  const validation = validateQuiz(mergedInput);
  const quiz = validation.value;
  // Notation handling (Phase 5). For THIS tool the floor is the whole
  // ladder, by design and not as a fallback: the quiz document renders as
  // plain strings in the library, a destination that cannot draw markup. So
  // the valid markup the shared prompt block asks the model for ($x^2$,
  // \frac{3}{5}, [[vmath]]) is deliberately converted to clean readable
  // plain text on arrival, and plain maths is left alone. Running the repair
  // stage here would turn "3/5" INTO markup a plain-string view prints
  // verbatim — the exact page-level defect the ladder exists to prevent.
  // String work only, no model calls.
  try {
    const {flattenMarkupToPlainText, QUIZ_DOC_FIELDS} =
      require("./notationEnforcement");
    const {flattened} = await flattenMarkupToPlainText(quiz, {
      subject: inputs.subject, fields: QUIZ_DOC_FIELDS,
    });
    if (flattened) console.info("[generateQuiz] notation floor:", {flattened});
  } catch (err) {
    console.error("[generateQuiz] notation floor failed", err);
  }
  const sourcing = {
    fromBank: sourced.fromBank,
    generated: quiz.questions.length - sourced.fromBank,
    scanned: sourced.scanned,
    aiCalled,
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
      output: quiz,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
      sourcing,
    });
    return {
      generationId: genRef.id,
      quiz,
      usage,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
      sourcing,
    };
  }

  await genRef.update({
    status: "complete",
    output: quiz,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    sourcing,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    quiz,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
    sourcing,
  };
}

function createGenerateQuiz(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 120,
        memory: "512MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertGeneratorRateLimit(request, "quiz");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        return runQuiz({uid, rawInputs: request.data, apiKey});
      },
  );
}

module.exports = {createGenerateQuiz, runQuiz, sanitizeInputs};
