/**
 * reviseLessonSection — HTTPS callable Cloud Function.
 *
 * AI-edits ONE part of an already-generated lesson plan for the Lesson Plan
 * Studio (a prose field like the Lesson Goal / Rationale, or a list field like
 * a stage's Teacher's Activities) without regenerating the whole plan. Returns
 * the revised content in the same shape it was given:
 *   { text }   for a prose section
 *   { items }  for a list section
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'reviseLessonSection');
 *   const result = await fn({
 *     sectionLabel: 'Rationale',
 *     kind: 'text',                 // 'text' | 'list'
 *     curriculumMode: 'cbc',        // 'cbc' | 'previous'
 *     current: 'This lesson...',    // string | string[]
 *     modifier: 'simpler',          // optional quick action
 *     instruction: 'mention local markets', // optional free text
 *     context: { grade, subject, topic, subtopic },
 *   });
 *   // result.data -> { text } | { items }, plus { model }
 *
 * Cheap micro-tool — Haiku, ~a few hundred output tokens per call. Generous
 * quota because a teacher polishing a plan will revise several sections.
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
  toolInputSchema,
  normalizeOutput,
  SYSTEM_PROMPT,
} = require("./reviseLessonSectionLogic");

const REVISE_MODEL = process.env.REVISE_SECTION_MODEL || "claude-haiku-4-5";

// A lesson-section edit's SUBJECT is contextual grounding (preserved-if-present),
// not core identity like a question's, so only the curriculum is strictly
// required. The curriculum still fails closed — it is the field that silently
// defaulted to CBC.
function sectionSource(inputs) {
  return checkSourceCurriculum(
    {curriculum: inputs.curriculumMode, subject: inputs.context && inputs.context.subject},
    {requireSubject: false},
  );
}

/**
 * Reconstruct the response for an idempotency key that already completed (§7).
 * The revised section ({text} | {items}) is returned INLINE, so it is persisted
 * to aiGenerations/{idempotencyKey} purely so a duplicate resumes it.
 */
async function buildResumedSectionResponse(operation) {
  const genId = operation.resultDocumentId;
  const snap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const out = snap && snap.exists ? (snap.data().output || {}) : {};
  return {...out, resumed: true};
}

async function runReviseLessonSection({uid, inputs, apiKey, idempotencyKey}) {
  // Fail-closed source-curriculum gate, in the RUNNER as well as the callable,
  // so a direct call cannot bypass it (a 2013 section is not edited as CBC).
  const src = sectionSource(inputs);
  if (!src.ok) {
    throw new HttpsError("invalid-argument", src.errors.join(" "));
  }

  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "revise_lesson_section",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedSectionResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }

  const usage = await assertAndIncrement(uid, "revise_lesson_section");

  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "revise_lesson_section",
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
  }).catch((err) => console.warn("[reviseLessonSection] reserve doc failed", err));

  async function settleFailure(err) {
    await genRef.set({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    }, {merge: true}).catch(() => {});
    try {
      await refundGeneration(uid, usage, "revise_lesson_section");
    } catch (refundErr) {
      console.error("[reviseLessonSection] refund failed", {uid}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[reviseLessonSection] failAiOperation failed", {uid}, opErr);
    }
  }

  let parsed;
  let model;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "reviseLessonSection"},
      model: REVISE_MODEL,
      mode: "tool",
      systemPrompt: SYSTEM_PROMPT,
      // The source-curriculum directive is prepended so the edit stays inside
      // the plan's own syllabus.
      messages: [{role: "user", content:
        `${curriculumDirective(src)}\n\n${buildUserPrompt(inputs)}`}],
      maxTokens: 900,
      temperature: 0.3,
      toolName: "submit_revised_section",
      toolDescription:
        "Submit the rewritten lesson-plan section — just the revised content, " +
        "nothing else.",
      toolInputSchema: toolInputSchema(inputs.kind),
    });
    parsed = response.parsed;
    model = response.model;
  } catch (err) {
    await settleFailure(err);
    throw err;
  }

  const out = normalizeOutput(parsed, inputs.kind);
  const empty = inputs.kind === "list" ?
    !Array.isArray(out.items) || out.items.length === 0 :
    !out.text;
  if (empty) {
    const emptyErr = new HttpsError(
      "internal",
      "AI returned an empty revision. Please try again.",
    );
    await settleFailure(emptyErr);
    throw emptyErr;
  }

  const output = {...out, model: model || REVISE_MODEL};
  await genRef.set({
    status: "complete",
    output,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true}).catch(() => {});
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[reviseLessonSection] completeAiOperation failed", {uid}, opErr);
  }

  return output;
}

function createReviseLessonSection(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 45, memory: "256MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertCallableRateLimit(request, {action: "reviseLessonSection", userPerMin: 15});
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }

      // Fail-closed validation BEFORE the reservation / any spend: shape, then
      // the source curriculum (refused rather than defaulted to CBC).
      const inputs = sanitizeInputs(request.data || {});
      const errs = validateInputs(inputs);
      if (errs.length > 0) {
        throw new HttpsError("invalid-argument", errs.join(" "));
      }
      const src = sectionSource(inputs);
      if (!src.ok) {
        throw new HttpsError("invalid-argument", src.errors.join(" "));
      }

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runReviseLessonSection({uid, inputs, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createReviseLessonSection, runReviseLessonSection};
