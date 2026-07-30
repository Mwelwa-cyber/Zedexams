/**
 * generateHomework — HTTPS callable Cloud Function.
 *
 * Short take-home practice grounded on the verified curriculum module for
 * the selected grade + sub-topic + term. Persists to `aiGenerations` with
 * `tool: 'homework'`.
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
const {validateHomework} = require("./homeworkSchema");
const {PROMPT_VERSION, pickSystemPrompt, buildUserPrompt} =
  require("./homeworkPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

const HOMEWORK_MODEL = process.env.HOMEWORK_MODEL || "claude-sonnet-4-6";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

const HOMEWORK_TOOL_SCHEMA = {
  type: "object",
  description: "Short take-home homework for a Zambian CBC lesson.",
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
    count: Math.min(20, Math.max(2, Math.round(num(raw.count, 6)))),
    estimatedMinutes: Math.min(120, Math.max(5,
        Math.round(num(raw.estimatedMinutes, 20)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: str(raw.instructions, 500),
    // Optional link back to the lesson plan this homework was created from
    // (Lesson Plan → Homework inheritance). Persisted in `inputs` so the library
    // can detect an existing linked activity + show a back-reference — mirrors
    // the notes `inputs.lessonPlanId` convention. '' when standalone.
    sourceLessonPlanId: str(raw.sourceLessonPlanId, 60),
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

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Reads the persisted aiGenerations doc rather
 * than re-deriving anything. Mirrors generateAssessment's resume path.
 */
async function buildResumedHomeworkResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    homework: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    resumed: true,
  };
}

async function runHomework({uid, rawInputs, apiKey, idempotencyKey}) {
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
    operationType: "generate_homework",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedHomeworkResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }
  // "created" or "retrying" — exactly one provider call happens below.
  // "failed" and "cancelled" already threw inside the helper.

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
    assertAndIncrement(uid, "homework"),
  ]);

  // Deterministic doc id (= the idempotency key), always. The auto-id branch
  // that used to sit here is deleted rather than bypassed: a reservation that
  // settles onto an auto-id document cannot be resumed, because the retry
  // carries the key but has no way back to what the first attempt wrote.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "homework",
    inputs,
    output: null,
    outputText: "",
    modelUsed: HOMEWORK_MODEL,
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
  let modelUsed = HOMEWORK_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "homework"},
      systemPrompt: pickSystemPrompt(inputs),
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 4000,
      temperature: 0.4,
      model: HOMEWORK_MODEL,
      mode: "tool",
      toolName: "emit_homework",
      toolDescription:
        "Emit the complete homework as a single structured object. Do not " +
        "include any prose or commentary outside this tool call.",
      toolInputSchema: HOMEWORK_TOOL_SCHEMA,
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
    // Hard throw from the AI call — no usable homework was returned. Refund the
    // credit / roll back the counter so the teacher is not charged for a
    // transient failure (AI-006). Best-effort: must not mask the original error.
    try {
      await refundGeneration(uid, usage, "homework");
    } catch (refundErr) {
      console.error("[generateHomework] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[generateHomework] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
    throw err;
  }

  const validation = validateHomework(parsed);
  const homework = validation.value;
  // The notation ladder (Phase 5): repair computer-style maths into the
  // contract markup the homework renderers now draw as stacked fractions and
  // column sums (toolNotationRender), then floor anything still broken to
  // clean plain text. String work only — no model calls, no extra charge.
  try {
    const {enforceNotation, applyPlainTextFloor, HOMEWORK_FIELDS} =
      require("./notationEnforcement");
    const notationOpts = {subject: inputs.subject, fields: HOMEWORK_FIELDS};
    const notationReport = await enforceNotation(homework, notationOpts);
    if (notationReport.applied) {
      const {flattened} = await applyPlainTextFloor(homework, notationOpts);
      if (notationReport.repaired || flattened) {
        console.info("[generateHomework] notation:", {
          repaired: notationReport.repaired, flattened,
          violations: notationReport.violations.length,
        });
      }
    }
  } catch (err) {
    console.error("[generateHomework] notation enforcement failed", err);
  }

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: homework,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
    });
    // A "flagged" paper is still a real result the teacher already got and was
    // billed for — a completion for idempotency purposes, not a failure.
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateHomework] completeAiOperation failed (flagged)",
          {uid, generationId: genRef.id}, opErr);
    }
    return {
      generationId: genRef.id,
      homework,
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
    output: homework,
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
    console.error("[generateHomework] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

  return {
    generationId: genRef.id,
    homework,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateHomework(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 120,
        memory: "512MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertGeneratorRateLimit(request, "homework");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        const idempotencyKey = request.data && request.data.idempotencyKey;
        return runHomework({uid, rawInputs: request.data, apiKey, idempotencyKey});
      },
  );
}

module.exports = {createGenerateHomework, runHomework, sanitizeInputs};
