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
const {assertVerifiedAuth} = require("../authGuard");
const {assertGeneratorRateLimit} = require("./generatorRateLimit");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {validateRubric} = require("./rubricSchema");
const {PROMPT_VERSION, pickSystemPrompt, buildUserPrompt} =
  require("./rubricPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");

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
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
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
  // Senior/vocational subjects the syllabi expose (Forms 1-4) — accepted so the
  // standardized curriculum selector never dead-ends on a real syllabus subject.
  "fashion_fabrics", "food_nutrition", "hospitality_management",
  "travel_tourism", "literature_in_english",
  // The 2013 senior RE split: two separately examined ECZ syllabi.
  "religious_education_2044", "religious_education_2046",
  // 2013-framework subjects exposed by curriculum-data-2013.json
  // (Agricultural Science / Art & Design / Home Management, Grades 10-12).
  "agricultural_science", "art_and_design", "home_management",
  // CBC 2023 Forms 1-4 subjects the Syllabus Studio exposes as their own
  // canonical keys (Art & Design is shared with the 2013 line above).
  "commerce_and_principles_of_accounts", "design_and_technology_studies",
  "music_and_creative_arts",
  // ── The 2026-07 subject split ──────────────────────────────────────────
  // Canonical keys carved out of shared ones, each its own examinable subject
  // with its own numbering (see src/utils/subjectSplitClassifier.js). The
  // pre-split spellings above are kept so a saved pick still passes.
  "commerce", "principles_of_accounts",
  "food_and_nutrition", "fashion_and_fabrics", "mathematics_ii",
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
    // Explicit curriculum chosen by the teacher — drives CBC vs Previous
    // prompt/terminology + framework-aware KB grounding.
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    curriculum: String(raw.curriculum || "").toLowerCase() === "previous" ?
      "previous" : "cbc",
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

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Reads the persisted aiGenerations doc rather
 * than re-deriving anything. Mirrors generateHomework's resume path.
 */
async function buildResumedRubricResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    rubric: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    resumed: true,
  };
}

async function runRubric({uid, rawInputs, apiKey, idempotencyKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL. A request without a
  // valid key is refused here — before the usage meter, before the provider,
  // before any result document exists.
  //
  // This used to sit behind `isValidIdempotencyKey`, which made the protection
  // a client courtesy: a caller that omitted the key silently got the old
  // unprotected path with a random doc id, and nothing recorded that it had.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "generate_rubric",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedRubricResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }
  // "created" or "retrying" — exactly one provider call happens below.
  // "failed" and "cancelled" already threw inside the helper.

  // Rubrics don't need a curated-topic grounding (they're about assessment
  // not content), but we still provide grade+subject context for style.
  const {contextBlock, kbMatch, kbWarning, kbVersion} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: `${inputs.taskType} assessment`,
    subtopic: "",
    framework: inputs.framework,
  });

  const usage = await assertAndIncrement(uid, "rubric");

  // Deterministic doc id (= the idempotency key), always. The auto-id branch
  // that used to sit here is deleted rather than bypassed: a reservation that
  // settles onto an auto-id document cannot be resumed, because the retry
  // carries the key but has no way back to what the first attempt wrote.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
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
      track: {uid, tool: "rubric"},
      systemPrompt: pickSystemPrompt(inputs),
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
    // Hard throw from the AI call — no usable rubric was returned. Refund the
    // credit / roll back the counter so the teacher is not charged for a
    // transient failure (AI-006). Best-effort: must not mask the original error.
    try {
      await refundGeneration(uid, usage, "rubric");
    } catch (refundErr) {
      console.error("[generateRubric] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[generateRubric] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
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
    // A "flagged" rubric is still a real result the teacher already got and was
    // billed for — a completion for idempotency purposes, not a failure.
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateRubric] completeAiOperation failed (flagged)",
          {uid, generationId: genRef.id}, opErr);
    }
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
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[generateRubric] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

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
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertGeneratorRateLimit(request, "rubric");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runRubric({uid, rawInputs: request.data, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createGenerateRubric, runRubric};
