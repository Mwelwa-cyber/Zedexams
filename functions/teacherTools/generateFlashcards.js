/**
 * generateFlashcards — HTTPS callable Cloud Function.
 *
 * Usage:
 *   const fn = httpsCallable(functions, 'generateFlashcards');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', topic: 'Fractions',
 *     count: 15, difficulty: 'mixed', language: 'english', instructions: ''
 *   });
 *   // result.data -> { generationId, flashcards, usage, warning?, kbGrounded }
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
const {validateFlashcards} = require("./flashcardSchema");
const {PROMPT_VERSION, pickSystemPrompt, buildUserPrompt} =
  require("./flashcardPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {reserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {isValidIdempotencyKey} = require("../aiOperationsCore");

const FLASHCARDS_MODEL = process.env.FLASHCARDS_MODEL || "claude-haiku-4-5";

// Permissive top-level shape — validateFlashcards() does the strict checking.
// Tool mode forces an object response and removes "AI returned non-JSON
// output" parse failures.
const FLASHCARDS_TOOL_SCHEMA = {
  type: "object",
  description: "A deck of CBC-aligned flashcards for the requested topic.",
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
const ALLOWED_DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const difficulty = str(raw.difficulty || "mixed", 10).toLowerCase();

  return {
    grade,
    subject,
    topic: str(raw.topic, 120),
    subtopic: str(raw.subtopic, 160),
    count: Math.min(40, Math.max(5, Math.round(num(raw.count, 15)))),
    difficulty: ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "mixed",
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
  if (!inputs.topic) {
    errs.push("Please enter a topic.");
  }
  return errs;
}

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Reads the persisted aiGenerations doc rather
 * than re-deriving anything. Mirrors generateHomework's resume path.
 */
async function buildResumedFlashcardsResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    flashcards: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some cards were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    resumed: true,
  };
}

async function runFlashcards({uid, rawInputs, apiKey, idempotencyKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Idempotency reservation (§6/§7/§8). Only engaged when the client sends a
  // valid key — the studio frontend does so via useAiOperationLock. Without a
  // key the flow is byte-for-byte the old behaviour (random doc id, no
  // reservation), so this is a safe, no-frontend-breakage rollout: a
  // double-click / rapid tap / retried timeout from a key-sending client can
  // never reach the provider or the usage meter twice; a legacy caller is
  // unaffected. `inputs` is the canonical fingerprint (every teacher-changeable
  // field is already in there).
  const idemActive = isValidIdempotencyKey(idempotencyKey);
  if (idemActive) {
    const reservation = await reserveAiOperation({
      uid,
      idempotencyKey,
      operationType: "generate_flashcards",
      fingerprintInput: inputs,
    });
    if (reservation.status === "completed") {
      return buildResumedFlashcardsResponse(reservation.operation);
    }
    if (reservation.status === "processing") {
      return {status: "processing", operationId: idempotencyKey};
    }
    if (reservation.status === "failed") {
      throw new HttpsError(
          "failed-precondition",
          reservation.operation.errorMessage ||
            "This request already failed and cannot be retried automatically.",
          {code: reservation.operation.errorCode, retryable: false, operationId: idempotencyKey},
      );
    }
    if (reservation.status === "cancelled") {
      throw new HttpsError("cancelled", "This request was cancelled.");
    }
    // "created" or "retrying" — exactly one provider call happens below.
  }

  const {contextBlock, kbMatch, kbWarning, kbVersion} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: inputs.topic,
    subtopic: inputs.subtopic,
    framework: inputs.framework,
  });

  const usage = await assertAndIncrement(uid, "flashcards");

  // Deterministic doc id (= the idempotency key) when idempotency is active, so
  // a retry of the SAME logical request re-set()s this exact doc instead of
  // creating a sibling, and the resumed-completed path reads it straight back
  // by id. Random id otherwise (legacy behaviour).
  const genRef = idemActive ?
    admin.firestore().collection("aiGenerations").doc(idempotencyKey) :
    admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "flashcards",
    inputs,
    output: null,
    outputText: "",
    modelUsed: FLASHCARDS_MODEL,
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
  let modelUsed = FLASHCARDS_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "flashcards"},
      systemPrompt: pickSystemPrompt(inputs),
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 3000,
      temperature: 0.4,
      model: FLASHCARDS_MODEL,
      mode: "tool",
      toolName: "emit_flashcards",
      toolDescription:
        "Emit the complete flashcard deck as a single structured object. " +
        "Do not include any prose or commentary outside this tool call.",
      toolInputSchema: FLASHCARDS_TOOL_SCHEMA,
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
    // Hard throw from the AI call — no usable deck was returned. Refund the
    // credit / roll back the counter so the teacher is not charged for a
    // transient failure (AI-006). Best-effort: must not mask the original error.
    try {
      await refundGeneration(uid, usage, "flashcards");
    } catch (refundErr) {
      console.error("[generateFlashcards] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    if (idemActive) {
      try {
        await failAiOperation({idempotencyKey, err, usageCharged: 0});
      } catch (opErr) {
        console.error("[generateFlashcards] failAiOperation failed after generation error",
            {uid, generationId: genRef.id}, opErr);
      }
    }
    throw err;
  }

  const validation = validateFlashcards(parsed);
  const flashcards = validation.value;
  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: flashcards,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn: Number(usageInfo.inputTokens || 0),
      tokensOut: Number(usageInfo.outputTokens || 0),
      modelUsed,
    });
    // A "flagged" deck is still a real result the teacher already got and was
    // billed for — a completion for idempotency purposes, not a failure.
    if (idemActive) {
      try {
        await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
      } catch (opErr) {
        console.error("[generateFlashcards] completeAiOperation failed (flagged)",
            {uid, generationId: genRef.id}, opErr);
      }
    }
    return {
      generationId: genRef.id,
      flashcards,
      usage,
      warning: [
        "Some cards were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Haiku 4.5 pricing: $1/M input, $5/M output.
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 100) + ((tokensOut / 1e6) * 500),
  );
  await genRef.update({
    status: "complete",
    output: flashcards,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (idemActive) {
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateFlashcards] completeAiOperation failed",
          {uid, generationId: genRef.id}, opErr);
    }
  }

  return {
    generationId: genRef.id,
    flashcards,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateFlashcards(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 90, memory: "512MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertGeneratorRateLimit(request, "flashcards");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runFlashcards({uid, rawInputs: request.data, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createGenerateFlashcards, runFlashcards};
