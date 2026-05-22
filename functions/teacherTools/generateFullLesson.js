/**
 * generateFullLesson — HTTPS callable Cloud Function.
 *
 * Produces a single, ready-to-deliver Zambian CBC lesson grounded on the
 * verified curriculum module for the selected grade + sub-topic + term
 * (resolveCbcContext injects the <curriculum_module> block). Persists to
 * `aiGenerations` with `tool: 'full_lesson'`.
 *
 *   await fn({ grade, subject, topic, subtopic, term, lessonNumber,
 *              totalLessons, learningEnvironment, durationMinutes,
 *              language, instructions });
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
const {validateFullLesson} = require("./fullLessonSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./fullLessonPrompt");
const {assertAndIncrement} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

const FULL_LESSON_MODEL =
  process.env.FULL_LESSON_MODEL || "claude-sonnet-4-5";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

// Permissive top-level shape — validateFullLesson() does strict checking.
// Anchors Claude to an object response + forces tool use.
const FULL_LESSON_TOOL_SCHEMA = {
  type: "object",
  description: "A complete, ready-to-deliver Zambian CBC lesson.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
  },
};

const ALLOWED_GRADES = new Set([
  "ECE", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
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

  return {
    grade,
    subject,
    topic: str(raw.topic, 160),
    subtopic: str(raw.subtopic, 200),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    durationMinutes: Math.min(240, Math.max(5,
        Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: str(raw.instructions, 500),
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

async function runFullLesson({uid, rawInputs, apiKey}) {
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
      ownerUid: uid,
    }),
    assertAndIncrement(uid, "full_lesson"),
  ]);

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "full_lesson",
    inputs,
    output: null,
    outputText: "",
    modelUsed: FULL_LESSON_MODEL,
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

  const userPrompt = buildUserPrompt(inputs);

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = FULL_LESSON_MODEL;
  try {
    const response = await callClaude(apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 7000,
      temperature: 0.4,
      model: FULL_LESSON_MODEL,
      mode: "tool",
      toolName: "emit_full_lesson",
      toolDescription:
        "Emit the complete lesson as a single structured object. Do not " +
        "include any prose or commentary outside this tool call.",
      toolInputSchema: FULL_LESSON_TOOL_SCHEMA,
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

  const validation = validateFullLesson(parsed);
  const fullLesson = validation.value;

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: fullLesson,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
    });
    return {
      generationId: genRef.id,
      fullLesson,
      usage,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  await genRef.update({
    status: "complete",
    output: fullLesson,
    coveredContent: fullLesson.coveredContent || [],
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    fullLesson,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateFullLesson(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 120,
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
        return runFullLesson({uid, rawInputs: request.data, apiKey});
      },
  );
}

module.exports = {createGenerateFullLesson, runFullLesson, sanitizeInputs};
