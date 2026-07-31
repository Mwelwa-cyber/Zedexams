/**
 * reviseQuestion — HTTPS callable Cloud Function.
 *
 * Rewrites a single question's text for a different grade level and/or
 * with a tone modifier (easier / harder / simpler language). Returns the
 * revised text only — the studio's other fields (options, correctAnswer,
 * marks, etc.) are untouched. Teachers manually adjust those if needed.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'reviseQuestion');
 *   const result = await fn({
 *     text: 'Define the term photosynthesis.',
 *     fromGrade: 'G7',
 *     toGrade: 'G4',           // target grade level
 *     subject: 'integrated_science',
 *     language: 'english',
 *     modifier: 'easier',      // 'easier' | 'harder' | 'simpler' | null
 *   });
 *   // result.data -> { text, model }
 *
 * Cheap tool — Haiku at ~$1/M input, ~$5/M output, ~150 tokens out per
 * call. Generous monthly quota because teachers will revise the same
 * question several times to land on a final wording.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertCallableRateLimit} = require("../rateLimit");
const {assertVerifiedAuth} = require("../authGuard");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {checkSourceCurriculum, curriculumDirective} = require("./sourceCurriculum");
const {
  sanitizeInputs,
  validateInputs,
  buildUserPrompt,
  stripPreamble,
  SYSTEM_PROMPT,
} = require("./reviseQuestionLogic");

const REVISE_MODEL = process.env.REVISE_QUESTION_MODEL || "claude-haiku-4-5";

/**
 * Reconstruct the response for an idempotency key that already completed (§7).
 * This transformation returns its text INLINE, so the result is persisted to
 * aiGenerations/{idempotencyKey} purely so a duplicate resumes the same text.
 */
async function buildResumedReviseResponse(uid, operation) {
  const genId = operation.resultDocumentId;
  const snap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const out = snap && snap.exists ? (snap.data().output || {}) : {};
  return {uid, text: out.text || null, model: out.model || REVISE_MODEL, resumed: true};
}

async function runReviseQuestion({uid, inputs, apiKey, idempotencyKey}) {
  // Fail-closed source-curriculum gate, in the RUNNER as well as the callable,
  // so a direct invocation of the runner cannot bypass it. A transformation
  // that cannot name its own curriculum is refused rather than defaulted.
  const src = checkSourceCurriculum(inputs);
  if (!src.ok) {
    throw new HttpsError("invalid-argument", src.errors.join(" "));
  }

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL, before the usage meter
  // and the provider. The sanitized inputs (incl. the source curriculum) are the
  // fingerprint, so a double-click reuses the key while a different revision
  // (changed target grade / modifier / text) gets a fresh one.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "revise_question",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedReviseResponse(uid, reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }

  const usage = await assertAndIncrement(uid, "revise_question");

  // Keyed result + structured audit record (the source curriculum/subject are
  // stored so a preserved-curriculum revision is auditable after the fact).
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "revise_question",
    operationClass: "transformation",
    inputs,
    sourceCurriculum: src.curriculum,
    sourceSubject: src.subject,
    output: null,
    modelUsed: REVISE_MODEL,
    status: "generating",
    errorMessage: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    visibility: "private",
  }).catch((err) => console.warn("[reviseQuestion] reserve doc failed", err));

  async function settleFailure(err) {
    await genRef.set({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    }, {merge: true}).catch(() => {});
    try {
      await refundGeneration(uid, usage, "revise_question");
    } catch (refundErr) {
      console.error("[reviseQuestion] refund failed", {uid}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[reviseQuestion] failAiOperation failed", {uid}, opErr);
    }
  }

  let parsed;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "reviseQuestion"},
      model: REVISE_MODEL,
      mode: "tool",
      systemPrompt: SYSTEM_PROMPT,
      // The source-curriculum directive is prepended so the model is told, in
      // words, to keep the revision inside the question's own syllabus.
      messages: [{role: "user", content:
        `${curriculumDirective(src)}\n\n${buildUserPrompt(inputs)}`}],
      maxTokens: 300,
      temperature: 0.3,
      toolName: "submit_revised_question",
      toolDescription:
        "Submit ONE rewritten question — just the question text, nothing else.",
      toolInputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {type: "string", maxLength: 1200},
        },
        required: ["text"],
      },
    });
    parsed = response.parsed;
  } catch (err) {
    await settleFailure(err);
    throw err;
  }

  const revised = stripPreamble(parsed && parsed.text);
  if (!revised) {
    const emptyErr = new HttpsError(
      "internal",
      "AI returned an empty revision. Please try again.",
    );
    await settleFailure(emptyErr);
    throw emptyErr;
  }

  const text = revised.slice(0, 1200);
  await genRef.set({
    status: "complete",
    output: {text, model: REVISE_MODEL},
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true}).catch(() => {});
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[reviseQuestion] completeAiOperation failed", {uid}, opErr);
  }

  return {uid, text, model: REVISE_MODEL};
}

function createReviseQuestion(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 45, memory: "256MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertCallableRateLimit(request, {action: "reviseQuestion", userPerMin: 15});
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }

      // Fail-closed validation BEFORE the reservation / any spend: the shape,
      // then the source curriculum (a transformation that cannot name its own
      // curriculum is refused rather than defaulted to CBC).
      const inputs = sanitizeInputs(request.data || {});
      const errs = validateInputs(inputs);
      if (errs.length > 0) {
        throw new HttpsError("invalid-argument", errs.join(" "));
      }
      const src = checkSourceCurriculum(inputs);
      if (!src.ok) {
        throw new HttpsError("invalid-argument", src.errors.join(" "));
      }

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runReviseQuestion({uid, inputs, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createReviseQuestion, runReviseQuestion};
