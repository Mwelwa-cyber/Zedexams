/**
 * generateWorksheet — HTTPS callable Cloud Function.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateWorksheet');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', topic: 'Fractions',
 *     count: 10, difficulty: 'mixed', durationMinutes: 30,
 *     language: 'english', includeAnswerKey: true, instructions: ''
 *   });
 *   // result.data -> { generationId, worksheet, usage, warning?, kbGrounded }
 *
 * Architectural mirror of generateLessonPlan — same flow, different
 * prompt/schema. Routes to Haiku by default since worksheets are smaller
 * than lesson plans and don't benefit from Sonnet's deeper reasoning.
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
const {validateWorksheet} = require("./worksheetSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./worksheetPrompt");
const {assertAndIncrement} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

// Worksheet-specific model. Haiku is ~5× cheaper and plenty capable for
// structured Q&A generation. Teacher can override via an admin toggle later.
const WORKSHEET_MODEL = process.env.WORKSHEET_MODEL || "claude-haiku-4-5";

// Permissive top-level shape — validateWorksheet() does strict checking
// post-call, so the schema's job is just to anchor Claude to a structured
// tool response (no markdown fences, no prose wrapping).
const WORKSHEET_TOOL_SCHEMA = {
  type: "object",
  description: "A complete CBC worksheet matching the v1 schema.",
  additionalProperties: true,
  properties: {
    schemaVersion: {type: "string"},
    header: {
      type: "object",
      additionalProperties: true,
      properties: {
        title: {type: "string"},
        grade: {type: "string"},
        subject: {type: "string"},
        topic: {type: "string"},
        subtopic: {type: "string"},
        duration: {type: "string"},
        instructions: {type: "string"},
        totalMarks: {type: "number"},
      },
      required: ["title", "grade", "subject", "topic"],
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          title: {type: "string"},
          questions: {
            type: "array",
            items: {type: "object", additionalProperties: true},
          },
        },
      },
    },
    answerKey: {type: "array", items: {type: "object", additionalProperties: true}},
  },
  required: ["header", "sections"],
};

// Output scales with question count. 4000 was massive overkill for a 5-question
// worksheet (most fit in ~1500 tokens) and generation time scales with output,
// so a tighter ceiling drops wall-clock for short worksheets without truncating
// long ones. Tunable formula: ~220 tokens per question with answer keys, ~140
// without, plus a fixed header. Capped at 5000 for the 25-question + answer
// key case.
function worksheetMaxTokens({count, includeAnswerKey}) {
  const perQuestion = includeAnswerKey ? 220 : 140;
  const scaled = 500 + Math.round(Number(count || 10) * perQuestion);
  return Math.min(5000, Math.max(1200, scaled));
}

const ALLOWED_GRADES = new Set([
  "ECE", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);
// Mirrors the frontend TEACHER_SUBJECTS list in src/utils/teacherTools.js.
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
const ALLOWED_DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const difficulty = str(raw.difficulty || "mixed", 10).toLowerCase();

  // Optional curriculum-module selectors. Absent/0 → null so behaviour is
  // unchanged from before this upgrade when they aren't supplied.
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
    count: Math.min(25, Math.max(3, Math.round(num(raw.count, 10)))),
    difficulty: ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "mixed",
    durationMinutes: Math.min(120, Math.max(10, Math.round(num(raw.durationMinutes, 30)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    includeAnswerKey: raw.includeAnswerKey !== false,
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
 * Core worksheet generation. Used by both `createGenerateWorksheet` and
 * the SSE-streaming HTTP endpoint. See generateLessonPlan.js for the
 * onProgress contract.
 */
async function runWorksheet({uid, rawInputs, apiKey, onProgress}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

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
    assertAndIncrement(uid, "worksheet"),
  ]);

  if (onProgress) onProgress({phase: "queued"});

  const genRef = admin.firestore().collection("aiGenerations").doc();
  const reservePromise = genRef.set({
    ownerUid: uid,
    tool: "worksheet",
    inputs,
    output: null,
    outputText: "",
    modelUsed: WORKSHEET_MODEL,
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

  if (onProgress) onProgress({phase: "claude_started"});

  const userPrompt = buildUserPrompt(inputs);
  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = WORKSHEET_MODEL;

  try {
    const baseClaudeArgs = {
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: worksheetMaxTokens({
        count: inputs.count,
        includeAnswerKey: inputs.includeAnswerKey,
      }),
      temperature: 0.4,
      model: WORKSHEET_MODEL,
      toolName: "emit_worksheet",
      toolDescription:
        "Emit the complete worksheet as a single structured object. " +
        "Do not include any prose or commentary outside this tool call.",
      toolInputSchema: WORKSHEET_TOOL_SCHEMA,
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

  const validation = validateWorksheet(parsed);
  const worksheet = validation.value;
  if (!validation.ok) {
    await genRef.set({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: worksheet,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn: Number(usageInfo.inputTokens || 0),
      tokensOut: Number(usageInfo.outputTokens || 0),
      modelUsed,
    }, {merge: true});
    return {
      generationId: genRef.id,
      worksheet,
      usage,
      warning: [
        "Some fields were incomplete — please review carefully.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Haiku 4.5 approx pricing: $1/M input, $5/M output (~5× cheaper than Sonnet).
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 100) + ((tokensOut / 1e6) * 500),
  );
  await genRef.set({
    status: "complete",
    output: worksheet,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    generationId: genRef.id,
    worksheet,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function makeTokenCounter(onProgress) {
  let approxOutputTokens = 0;
  let lastReported = 0;
  return (chunk) => {
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

function createGenerateWorksheet(anthropicApiKeySecret) {
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
      return runWorksheet({uid, rawInputs: request.data, apiKey});
    },
  );
}

module.exports = {createGenerateWorksheet, runWorksheet};
