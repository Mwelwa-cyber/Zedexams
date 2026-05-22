/**
 * generateRubric — HTTPS callable Cloud Function.
 *
 *   const fn = httpsCallable(functions, 'generateRubric');
 *   const result = await fn({
 *     grade: 'G9', subject: 'english', taskType: 'essay',
 *     taskDescription: 'Argumentative essay on mobile phones in schools',
 *     totalMarks: 20, numberOfCriteria: 4,
 *     language: 'english', instructions: ''
 *   });
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
const {validateRubric} = require("./rubricSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./rubricPrompt");
const {assertAndIncrement} = require("./usageMeter");

const RUBRIC_MODEL = process.env.RUBRIC_MODEL || "claude-haiku-4-5";

// Permissive top-level shape — validateRubric() does the strict checking.
// Tool mode forces an object response and removes "AI returned non-JSON
// output" parse failures.
const RUBRIC_TOOL_SCHEMA = {
  type: "object",
  description: "An assessment rubric with weighted criteria and level descriptors.",
  additionalProperties: true,
};

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
const ALLOWED_TASK_TYPES = new Set([
  "essay", "project", "presentation", "practical", "oral", "performance",
]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const taskType = str(raw.taskType || "essay", 20).toLowerCase();

  return {
    grade,
    subject,
    taskType: ALLOWED_TASK_TYPES.has(taskType) ? taskType : "essay",
    taskDescription: str(raw.taskDescription, 500),
    totalMarks: Math.min(100, Math.max(5, Math.round(num(raw.totalMarks, 20)))),
    numberOfCriteria: Math.min(8, Math.max(3, Math.round(num(raw.numberOfCriteria, 4)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
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
  if (!inputs.taskDescription) {
    errs.push("Please describe the task being graded.");
  }
  return errs;
}

async function runRubric({uid, rawInputs, apiKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Rubrics don't need a curated-topic grounding (they're about assessment
  // not content), but we still provide grade+subject context for style.
  const {contextBlock, kbMatch, kbWarning, kbVersion} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: `${inputs.taskType} assessment`,
    subtopic: "",
  });

  const usage = await assertAndIncrement(uid, "rubric");

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "rubric",
    inputs,
    output: null,
    outputText: "",
    modelUsed: RUBRIC_MODEL,
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
  let modelUsed = RUBRIC_MODEL;
  try {
    const response = await callClaude(apiKey, {
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 4000,
      temperature: 0.3,
      model: RUBRIC_MODEL,
      mode: "tool",
      toolName: "emit_rubric",
      toolDescription:
        "Emit the complete assessment rubric as a single structured " +
        "object. Do not include any prose or commentary outside this tool call.",
      toolInputSchema: RUBRIC_TOOL_SCHEMA,
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

  const validation = validateRubric(parsed);
  const rubric = validation.value;
  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: rubric,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn: Number(usageInfo.inputTokens || 0),
      tokensOut: Number(usageInfo.outputTokens || 0),
      modelUsed,
    });
    return {
      generationId: genRef.id,
      rubric,
      usage,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Haiku pricing: ~$1/M input, $5/M output.
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 100) + ((tokensOut / 1e6) * 500),
  );
  await genRef.update({
    status: "complete",
    output: rubric,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    rubric,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateRubric(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 90, memory: "512MiB"},
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
      return runRubric({uid, rawInputs: request.data, apiKey});
    },
  );
}

module.exports = {createGenerateRubric, runRubric};
