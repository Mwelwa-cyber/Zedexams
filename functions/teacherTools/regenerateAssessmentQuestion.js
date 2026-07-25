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

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertCallableRateLimit} = require("../rateLimit");
const {assertVerifiedAuth} = require("../authGuard");

const {getAnthropicApiKey, getUserRole, isStaffRole} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {resolveCbcContext} = require("./cbcKnowledge");
const {validateAssessment} = require("./assessmentSchema");
const {SYSTEM_PROMPT} = require("./assessmentPromptV10");
const {bandForGrade, bandPermitsActivity} = require("./assessmentBands");
const {gradeLabelFor, subjectLabelFor} = require("./assessmentLabels");
const {
  sanitizeRegenerateInputs, validateRegenerateInputs, buildRegeneratePrompt,
  extractSingleQuestion, QUESTION_TOOL_SCHEMA,
} = require("./regenerateQuestionCore");

const REGENERATE_MODEL =
  process.env.REGENERATE_QUESTION_MODEL || "claude-haiku-4-5";

async function runRegenerateQuestion({uid, rawInputs, apiKey}) {
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

  const usage = await assertAndIncrement(uid, "revise_question");

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
        subjectLabel: subjectLabelFor(inputs.subject),
      })}],
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
    try {
      await refundGeneration(uid, usage, "revise_question");
    } catch (refundErr) {
      console.error("[regenerateAssessmentQuestion] refund failed",
          {uid, usage}, refundErr);
    }
    throw err;
  }

  const extracted = extractSingleQuestion(validateAssessment, parsed, slot);
  if (!extracted.ok) {
    // A failed rewrite leaves the paper exactly as it was — the client only
    // splices in a question it actually received. Refund, and say so plainly.
    try {
      await refundGeneration(uid, usage, "revise_question");
    } catch (refundErr) {
      console.error("[regenerateAssessmentQuestion] refund failed after invalid output",
          {uid, usage}, refundErr);
    }
    throw new HttpsError(
        "internal",
        "The rewrite came back unusable, so your question has been left as it " +
      "was. Please try again.",
        {errors: extracted.errors.slice(0, 3)},
    );
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
        return runRegenerateQuestion({uid, rawInputs: request.data, apiKey});
      },
  );
}

module.exports = {
  createRegenerateAssessmentQuestion,
  runRegenerateQuestion,
};
