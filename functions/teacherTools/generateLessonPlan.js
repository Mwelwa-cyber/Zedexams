/**
 * generateLessonPlan — HTTPS callable Cloud Function.
 *
 * Usage from client (after import):
 *   const fn = httpsCallable(functions, 'generateLessonPlan');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', topic: 'Fractions',
 *     subtopic: 'Adding Fractions with Unlike Denominators',
 *     durationMinutes: 40, teacherName: 'Mr. Banda', school: 'Lusaka Primary',
 *     numberOfPupils: 42, instructions: ''
 *   });
 *   // result.data -> { generationId, lessonPlan, usage: {plan, used, limit} }
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext, KB_VERSION} = require("./cbcKnowledge");
const {validateLessonPlan} = require("./lessonPlanSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./lessonPlanPrompt");
const {assertAndIncrement} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

// Override at deploy-time without a code change. Set LESSON_PLAN_MODEL=claude-haiku-4-5
// to drop generation time roughly in half at the cost of some reasoning depth,
// or LESSON_PLAN_MODEL=claude-sonnet-4-5 to roll back this migration.
//
// Hard-coded default (rather than DEFAULT_MODEL fallthrough) keeps this
// migration scoped to the lesson plan tool — generateNotes still gets its
// own model decision via NOTES_MODEL.
const LESSON_PLAN_MODEL = process.env.LESSON_PLAN_MODEL || "claude-sonnet-4-6";

// Sonnet 4.6 defaults to `effort: "high"` if unset, which is materially slower
// and more expensive than 4.5's baseline. Pin to "low" + disabled thinking to
// preserve current latency — lesson plan generation is structured template-
// fill under tool_choice, not multi-step reasoning, so heavy thinking is
// overkill. Bump these later (effort:"medium" + thinking:"adaptive") if
// quality regresses.
const LESSON_PLAN_THINKING = {type: "disabled"};
const LESSON_PLAN_OUTPUT_CONFIG = {effort: "low"};

// Permissive top-level shape — the post-call validateLessonPlan() does the
// strict checking, so the schema's job here is just to anchor Claude to an
// object response and force tool use (which eliminates JSON-parse failures).
// `additionalProperties: true` keeps us forward-compatible with prompt tweaks
// that add new sections.
const LESSON_PLAN_TOOL_SCHEMA = {
  type: "object",
  description: "A complete Zambian CBC lesson plan in the v2 schema.",
  additionalProperties: true,
  properties: {
    schemaVersion: {type: "string"},
    header: {type: "object", additionalProperties: true},
    lessonGoal: {type: "string"},
    lessonProgression: {type: "object", additionalProperties: true},
    lessonDevelopment: {type: "object", additionalProperties: true},
    specificOutcomes: {type: "array", items: {type: "string"}},
    keyCompetencies: {type: "array", items: {type: "string"}},
    broadCompetences: {type: "array", items: {type: "string"}},
    expectedTargetCompetence: {type: "string"},
    values: {type: "array", items: {type: "string"}},
    prerequisiteKnowledge: {type: "array", items: {type: "string"}},
    teachingLearningMaterials: {type: "array", items: {type: "string"}},
    interdisciplinaryConnections: {type: "array", items: {type: "string"}},
    references: {type: "array", items: {type: "string"}},
    assessment: {type: "object", additionalProperties: true},
    homework: {type: "object", additionalProperties: true},
    differentiation: {type: "object", additionalProperties: true},
    teacherReflection: {type: "object", additionalProperties: true},
    methodology: {type: "string"},
    learningEnvironment: {type: "string"},
    competenceContinuity: {type: "object", additionalProperties: true},
  },
  required: ["header", "lessonGoal"],
};

// Output scales roughly with lesson length. A 20-min lesson rarely fills 4000
// tokens; a 90-min lesson sometimes truncates at 4000. Scaling cuts wall-clock
// for short lessons (generation time is ~linear in output tokens) while giving
// long ones room. Capped at 5000 to keep runaway lessons in check.
function lessonPlanMaxTokens(durationMinutes) {
  const scaled = 2200 + Math.round(Number(durationMinutes || 40) * 35);
  return Math.min(5000, Math.max(2500, scaled));
}

const ALLOWED_GRADES = new Set([
  "ECE", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);
// Mirrors the frontend TEACHER_SUBJECTS list in src/utils/teacherTools.js.
// Every subject the dropdown can select must be accepted here, otherwise the
// frontend silently fails with "Please select a supported subject."
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "numeracy", "english", "literacy",
  "cinyanja", "zambian_language",
  "integrated_science", "environmental_science",
  "biology", "chemistry", "physics",
  "social_studies", "history", "geography", "civic_education",
  "religious_education",
  "technology_studies", "creative_and_technology_studies",
  "home_economics", "expressive_arts", "physical_education",
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  // Optional curriculum-module selectors. Absent/0 → null so resolveCbcContext
  // and the prompt behave exactly as before this upgrade.
  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
    .toLowerCase().replace(/[^a-z_]/g, "_");

  return {
    grade,
    subject,
    topic: str(raw.topic, 120),
    subtopic: str(raw.subtopic, 160),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    durationMinutes: Math.min(120, Math.max(20, Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    teacherName: str(raw.teacherName, 80),
    school: str(raw.school, 120),
    numberOfPupils: Math.min(200, Math.max(1, Math.round(num(raw.numberOfPupils, 40)))),
    instructions: str(raw.instructions, 500),
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a grade from ECE–G12.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  if (!inputs.topic) {
    errs.push("Please enter a topic.");
  }
  return errs;
}

/**
 * Core lesson-plan generation. Used by both the httpsCallable wrapper
 * (`createGenerateLessonPlan`) and the SSE-streaming HTTP endpoint
 * (`apiGenerateLessonPlan` in index.js).
 *
 * Pass `onProgress({phase, ...})` to receive lifecycle events:
 *   - {phase: "queued"}              — context + quota resolved
 *   - {phase: "claude_started"}      — about to call Anthropic
 *   - {phase: "token", outputTokens} — every ~50 tokens during streaming
 *   - {phase: "claude_done"}         — Claude returned, validation pending
 *
 * When onProgress is provided, the generator uses streaming tool-use and
 * forwards progress events to the caller (so the SSE endpoint can push
 * heartbeats to the browser). When omitted, it uses non-streaming tool-use
 * — same end result, smaller code path.
 */
async function runLessonPlan({uid, rawInputs, apiKey, onProgress}) {
  // 1. Sanitise + validate inputs.
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // 2. Resolve CBC context + enforce per-tool monthly quota in parallel.
  const [{contextBlock, kbMatch, kbWarning}, usage] = await Promise.all([
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
    assertAndIncrement(uid, "lesson_plan"),
  ]);

  if (onProgress) onProgress({phase: "queued"});

  // 3. Reserve a generation doc. Runs in parallel with Claude.
  const genRef = admin.firestore().collection("aiGenerations").doc();
  const reservePromise = genRef.set({
    ownerUid: uid,
    tool: "lesson_plan",
    inputs,
    output: null,
    outputText: "",
    modelUsed: LESSON_PLAN_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion: KB_VERSION,
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
  }).catch((err) => {
    console.warn("Failed to reserve generation doc", err);
  });

  // 4. Call Claude. Streaming-tool-use when onProgress is set, plain
  //    tool-use otherwise. Both modes return parsed JSON on success and
  //    eliminate "AI returned non-JSON output" failures.
  if (onProgress) onProgress({phase: "claude_started"});

  const userPrompt = buildUserPrompt(inputs);
  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = LESSON_PLAN_MODEL;

  try {
    const baseClaudeArgs = {
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: lessonPlanMaxTokens(inputs.durationMinutes),
      temperature: 0.3,
      model: LESSON_PLAN_MODEL,
      thinking: LESSON_PLAN_THINKING,
      outputConfig: LESSON_PLAN_OUTPUT_CONFIG,
      toolName: "emit_lesson_plan",
      toolDescription:
        "Emit the complete Zambian CBC lesson plan as a single " +
        "structured object. Do not include any prose or commentary " +
        "outside this tool call.",
      toolInputSchema: LESSON_PLAN_TOOL_SCHEMA,
    };

    const claudePromise = onProgress ?
      callClaude(apiKey, {
        ...baseClaudeArgs,
        mode: "stream",
        onToken: makeTokenCounter(onProgress),
      }) :
      callClaude(apiKey, {...baseClaudeArgs, mode: "tool"});

    const [response] = await Promise.all([claudePromise, reservePromise]);
    parsed = response.parsed;
    raw = response.text || "";
    usageInfo = response.usage || usageInfo;
    modelUsed = response.model || modelUsed;
  } catch (err) {
    await reservePromise;
    await genRef.set({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    }, {merge: true}).catch(() => {});
    throw err;
  }

  if (onProgress) onProgress({phase: "claude_done"});

  // 5. Validate + normalise against our schema.
  const validation = validateLessonPlan(parsed);
  const lessonPlan = validation.value;
  if (!validation.ok) {
    await genRef.set({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: lessonPlan,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn: Number(usageInfo.inputTokens || 0),
      tokensOut: Number(usageInfo.outputTokens || 0),
      modelUsed,
    }, {merge: true});
    return {
      generationId: genRef.id,
      lessonPlan,
      usage,
      warning: [
        "Some fields were incomplete — please review carefully.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  // 6. Happy path — finalise the generation doc.
  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Claude Sonnet 4.6 approx pricing: $3/M input, $15/M output (same as 4.5).
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );
  await genRef.set({
    status: "complete",
    output: lessonPlan,
    coveredContent: lessonPlan.coveredContent || [],
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    generationId: genRef.id,
    lessonPlan,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

// Coalesce per-token callbacks into one progress event per ~50 output tokens
// so the SSE stream isn't flooded with one event per byte.
function makeTokenCounter(onProgress) {
  let approxOutputTokens = 0;
  let lastReported = 0;
  return (chunk) => {
    // Anthropic doesn't give us the running output_tokens during streaming;
    // approximate as ~4 chars per token for progress display only. The final
    // usage figures come from message_delta, not this counter.
    approxOutputTokens += Math.max(1, Math.round((chunk || "").length / 4));
    if (approxOutputTokens - lastReported >= 50) {
      lastReported = approxOutputTokens;
      try {
        onProgress({phase: "token", approxOutputTokens});
      } catch (err) {
        console.warn("onProgress threw", err);
      }
    }
  };
}

/**
 * Factory so we can inject the secret parameter from index.js (following
 * the existing pattern in functions/index.js for MoMo + Anthropic).
 */
function createGenerateLessonPlan(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in.");
      }
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runLessonPlan({uid, rawInputs: request.data, apiKey});
    },
  );
}

module.exports = {
  createGenerateLessonPlan,
  runLessonPlan,
  sanitizeInputs,
  validateInputs,
};
