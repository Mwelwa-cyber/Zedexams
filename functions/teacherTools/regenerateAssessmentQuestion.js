/**
 * regenerateAssessmentQuestion — HTTPS callable. Rewrite ONE question in place.
 *
 * §3.6: "Regenerating one question must never rebuild the paper. Locked
 * questions and teacher edits must survive any regeneration. Regeneration of a
 * single item must respect that item's blueprint slot, so the paper stays
 * balanced."
 *
 * Before this existed, "I don't like question 4" meant regenerating the whole
 * paper — throwing away the twelve questions the teacher was happy with, plus
 * every edit they had made to them, to fix one. So this returns exactly one
 * question, bound to the slot that question occupies in the paper's plan: same
 * marks, same topic, same outcome, same thinking level, same structure. The
 * client then splices it in without touching anything else
 * (src/utils/questionRegeneration.js holds that guarantee, and its tests assert
 * object identity for every other question on the paper).
 *
 * Cheap by design — Haiku, one item, a few hundred output tokens — and metered
 * on `revise_question` rather than `assessment`, because charging a whole paper's
 * allowance to fix one question would make the feature not worth using.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertCallableRateLimit} = require("../rateLimit");
const {assertVerifiedAuth} = require("../authGuard");

const {getAnthropicApiKey, getUserRole, isStaffRole} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {resolveCbcContext} = require("./cbcKnowledge");
const {validateAssessment} = require("./assessmentSchema");
const {SYSTEM_PROMPT} = require("./assessmentPromptV10");
const {bandForGrade, bandPermitsActivity} = require("./assessmentBands");
const {gradeLabelFor, subjectLabelFor} = require("./assessmentLabels");
const {buildMisconceptionContext} = require("./misconceptions");
const {
  sanitizeRegenerateInputs, validateRegenerateInputs, buildRegeneratePrompt,
  extractSingleQuestion, QUESTION_TOOL_SCHEMA,
} = require("./regenerateQuestionCore");

const REGENERATE_MODEL =
  process.env.REGENERATE_QUESTION_MODEL || "claude-haiku-4-5";

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Unlike the document-producing generators,
 * this one returns a question INLINE, so its result is persisted to
 * aiGenerations/{idempotencyKey} purely to make the resume possible.
 */
async function buildResumedQuestionResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const out = genSnap && genSnap.exists ? (genSnap.data().output || {}) : {};
  return {
    question: out.question || null,
    slot: out.slot || null,
    model: out.modelUsed || null,
    usage: null,
    resumed: true,
  };
}

async function runRegenerateQuestion({uid, rawInputs, apiKey, idempotencyKey}) {
  const inputs = sanitizeRegenerateInputs(rawInputs || {});
  const errs = validateRegenerateInputs(inputs);
  if (errs.length > 0) {
    throw new HttpsError("invalid-argument", errs.join(" "));
  }
  const {slot} = inputs;

  // The band still governs a single question. A paper saved before a band was
  // tightened could carry a slot the level no longer permits, and regenerating it
  // must not quietly re-author that activity — the same ceiling the full
  // generator enforces applies to one question.
  const band = await bandForGrade(inputs.grade);
  if (band && !bandPermitsActivity(band, slot.activityType || slot.renderType)) {
    throw new HttpsError(
        "failed-precondition",
        `This kind of question is not used at ${gradeLabelFor(inputs.grade)} ` +
      "any more, so it cannot be rewritten on its own. Replace it with a " +
      "different kind of question, or regenerate the paper.",
    );
  }

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL. A request without a
  // valid key is refused here — before the usage meter, before the provider.
  // `inputs` (slot + current text + avoid list) is the fingerprint, so a genuine
  // "rewrite this again for something different" reaches here with different
  // input (the current text changed once the last rewrite was spliced in) and
  // is NOT answered with the first result, while a double-click reuses the key.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "regenerate_assessment_question",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedQuestionResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }
  // "created" or "retrying" — exactly one provider call happens below.

  // Ground the replacement on the verified curriculum for its own topic, exactly
  // as the full generator does — a question rewritten from the model's general
  // knowledge would not be the Zambian curriculum even if the paper around it is.
  const {contextBlock} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: slot.topic,
    subtopic: slot.subtopic,
    framework: inputs.framework,
    ownerUid: uid,
  });

  // What learners actually get wrong on this topic (§3.3), so a rewritten
  // multiple-choice question's wrong options are real mistakes rather than filler.
  // Best-effort — nothing known means nothing said.
  const misconceptionDirective = slot.topic ? await buildMisconceptionContext({
    framework: inputs.framework,
    grade: inputs.grade,
    subject: inputs.subject,
    topics: [slot.topic],
  }) : "";

  const usage = await assertAndIncrement(uid, "revise_question");

  // Deterministic result store (= the idempotency key). This generator returns
  // its question inline rather than saving a library document, but the result is
  // still persisted here so a duplicate/retried request resumes the exact same
  // question instead of paying for a second rewrite. Private, never attached to
  // a library — purely the idempotency result of record.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "regenerate_question",
    inputs,
    output: null,
    modelUsed: REGENERATE_MODEL,
    status: "generating",
    errorMessage: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    visibility: "private",
  }).catch((err) => {
    console.warn("[regenerateAssessmentQuestion] reserve doc failed", err);
  });

  let parsed = null;
  let modelUsed = REGENERATE_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "regenerateQuestion"},
      model: REGENERATE_MODEL,
      mode: "tool",
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: buildRegeneratePrompt(inputs, {
        gradeLabel: gradeLabelFor(inputs.grade),
        subjectLabel: subjectLabelFor(inputs.subject, inputs.grade),
      }) + (misconceptionDirective ? `\n\n${misconceptionDirective}` : "")}],
      // One question with options, answer and marking guide: ~120 tokens per
      // mark plus a floor for the wording, capped well below a paper's budget.
      maxTokens: Math.min(2000, 600 + slot.marks * 120),
      temperature: 0.6,
      toolName: "emit_question",
      toolDescription:
        "Emit the ONE replacement question as a structured object. No prose " +
        "outside this tool call.",
      toolInputSchema: QUESTION_TOOL_SCHEMA,
    });
    parsed = response.parsed;
    modelUsed = response.model || modelUsed;
  } catch (err) {
    // Nothing was produced, so the teacher must not be charged. Best-effort, and
    // logged when it fails so a silently decremented quota is traceable.
    await genRef.set({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    }, {merge: true}).catch(() => {});
    try {
      await refundGeneration(uid, usage, "revise_question");
    } catch (refundErr) {
      console.error("[regenerateAssessmentQuestion] refund failed",
          {uid, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[regenerateAssessmentQuestion] failAiOperation failed",
          {uid}, opErr);
    }
    throw err;
  }

  const extracted = extractSingleQuestion(validateAssessment, parsed, slot);
  if (!extracted.ok) {
    // A failed rewrite leaves the paper exactly as it was — the client only
    // splices in a question it actually received. Refund, and say so plainly.
    const invalidErr = new HttpsError(
        "internal",
        "The rewrite came back unusable, so your question has been left as it " +
      "was. Please try again.",
        {errors: extracted.errors.slice(0, 3)},
    );
    await genRef.set({
      status: "failed",
      errorMessage: `Schema errors: ${extracted.errors.slice(0, 3).join("; ")}`,
    }, {merge: true}).catch(() => {});
    try {
      await refundGeneration(uid, usage, "revise_question");
    } catch (refundErr) {
      console.error("[regenerateAssessmentQuestion] refund failed after invalid output",
          {uid, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err: invalidErr, usageCharged: 0});
    } catch (opErr) {
      console.error("[regenerateAssessmentQuestion] failAiOperation failed after invalid output",
          {uid}, opErr);
    }
    throw invalidErr;
  }

  await genRef.set({
    status: "complete",
    output: {question: extracted.question, slot, modelUsed},
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true}).catch(() => {});
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[regenerateAssessmentQuestion] completeAiOperation failed", {uid}, opErr);
  }

  return {
    question: extracted.question,
    // Echoed so the client can prove the replacement matches the slot it asked
    // about before it splices anything in.
    slot,
    model: modelUsed,
    usage,
  };
}

function createRegenerateAssessmentQuestion(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 60, memory: "256MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertCallableRateLimit(request, {
          action: "regenerateAssessmentQuestion", userPerMin: 15,
        });
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        const idempotencyKey = request.data && request.data.idempotencyKey;
        return runRegenerateQuestion({uid, rawInputs: request.data, apiKey, idempotencyKey});
      },
  );
}

module.exports = {
  createRegenerateAssessmentQuestion,
  runRegenerateQuestion,
};
