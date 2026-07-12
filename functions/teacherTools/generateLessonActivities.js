/**
 * generateLessonActivities — HTTPS callable Cloud Function.
 *
 * Powers the Lesson Plan Studio's "Assessment Activities" section: from a
 * lesson's grade + subject + topic + sub-topic it generates a Class Exercise
 * and/or a Homework, grounded on the same verified curriculum module the
 * lesson plan used. Persists to `aiGenerations` with `tool: 'lesson_activities'`.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {
  validateLessonActivities,
  normalizeType,
  normalizeDifficulty,
} = require("./lessonActivitiesSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./lessonActivitiesPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

const ACTIVITIES_MODEL =
  process.env.LESSON_ACTIVITIES_MODEL || "claude-sonnet-4-6";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

const ACTIVITIES_TOOL_SCHEMA = {
  type: "object",
  description:
    "Class exercise and/or homework for a Zambian CBC lesson, each with a " +
    "numbered question list and a complete answer key.",
  additionalProperties: true,
  properties: {
    exercise: {type: "object", additionalProperties: true},
    homework: {type: "object", additionalProperties: true},
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
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function sanitizeTypes(raw, fallback) {
  const arr = Array.isArray(raw) ? raw : [];
  // "mixed" (or an empty selection) means "let the model choose a blend" —
  // signalled to the prompt as an empty list.
  if (arr.length === 0) return fallback;
  if (arr.some((t) => String(t).trim().toLowerCase() === "mixed")) return [];
  const out = [];
  for (const t of arr) {
    const canon = normalizeType(t);
    if (!out.includes(canon)) out.push(canon);
  }
  return out.length ? out : fallback;
}

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
      .toLowerCase().replace(/[^a-z_]/g, "_");

  // `activities` selects what to produce. The studio only calls this when at
  // least one activity is wanted (lesson-plan-only never hits the function).
  const activities = str(raw.activities, 20).toLowerCase();
  const wantExercise = activities === "exercise" || activities === "both";
  const wantHomework = activities === "homework" || activities === "both";

  const ex = raw.exercise || {};
  const hw = raw.homework || {};

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
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    lessonObjectives: str(raw.lessonObjectives, 2000),
    instructions: str(raw.instructions, 500),
    wantExercise,
    wantHomework,
    exercise: {
      count: Math.min(20, Math.max(2, Math.round(num(ex.count, 5)))),
      difficulty: normalizeDifficulty(ex.difficulty),
      questionTypes: sanitizeTypes(ex.questionTypes,
          ["multiple_choice", "short_answer"]),
    },
    homework: {
      count: Math.min(20, Math.max(2, Math.round(num(hw.count, 6)))),
      difficulty: normalizeDifficulty(hw.difficulty),
      estimatedMinutes: Math.min(120, Math.max(5,
          Math.round(num(hw.estimatedMinutes, 20)))),
      questionTypes: sanitizeTypes(hw.questionTypes,
          ["short_answer", "fill_in_blank"]),
    },
    includeMarkingGuide: raw.includeMarkingGuide !== false,
    includeModelAnswers: raw.includeModelAnswers !== false,
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
  if (!inputs.wantExercise && !inputs.wantHomework) {
    errs.push("Choose at least one activity to generate.");
  }
  return errs;
}

async function runLessonActivities({uid, rawInputs, apiKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  const [{contextBlock, kbMatch, kbWarning, kbVersion}, usage] =
    await Promise.all([
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
      assertAndIncrement(uid, "lesson_activities"),
    ]);

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "lesson_activities",
    inputs,
    output: null,
    outputText: "",
    modelUsed: ACTIVITIES_MODEL,
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
  let modelUsed = ACTIVITIES_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "lessonActivities"},
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      // Both activities can run long when several structured questions are
      // requested; budget enough headroom for the combined object.
      maxTokens: inputs.wantExercise && inputs.wantHomework ? 8000 : 5000,
      temperature: 0.4,
      model: ACTIVITIES_MODEL,
      mode: "tool",
      toolName: "emit_lesson_activities",
      toolDescription:
        "Emit the requested class exercise and/or homework as a single " +
        "structured object. Do not include any prose outside this tool call.",
      toolInputSchema: ACTIVITIES_TOOL_SCHEMA,
    });
    parsed = response.parsed;
    raw = response.text || "";
    usageInfo = response.usage || usageInfo;
    modelUsed = response.model || modelUsed;
  } catch (err) {
    // Hard failure → no usable output, so roll the quota back before surfacing.
    await genRef.update({
      status: "failed",
      errorMessage: String((err && err.message) || err).slice(0, 500),
    }).catch(() => {});
    // Best-effort: a refund failure must not mask the original error, but it
    // leaves the teacher's quota silently decremented, so log it.
    try {
      await refundGeneration(uid, usage, "lesson_activities");
    } catch (refundErr) {
      console.error("[generateLessonActivities] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    throw err;
  }

  const validation = validateLessonActivities(parsed, {
    exercise: inputs.wantExercise,
    homework: inputs.wantHomework,
  });
  const activities = validation.value;

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: activities,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
    });
    return {
      generationId: genRef.id,
      activities,
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
    output: activities,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    activities,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateLessonActivities(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 180,
        memory: "512MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        return runLessonActivities({uid, rawInputs: request.data, apiKey});
      },
  );
}

module.exports = {
  createGenerateLessonActivities,
  runLessonActivities,
  sanitizeInputs,
  validateInputs,
};
