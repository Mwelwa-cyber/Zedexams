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

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {assertAndIncrement} = require("./usageMeter");
const {
  sanitizeInputs,
  validateInputs,
  buildUserPrompt,
  stripPreamble,
  SYSTEM_PROMPT,
} = require("./reviseQuestionLogic");

const REVISE_MODEL = process.env.REVISE_QUESTION_MODEL || "claude-haiku-4-5";

async function runReviseQuestion({uid, inputs, apiKey}) {
  const {parsed} = await callClaude(apiKey, {
    model: REVISE_MODEL,
    mode: "tool",
    systemPrompt: SYSTEM_PROMPT,
    messages: [{role: "user", content: buildUserPrompt(inputs)}],
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

  const revised = stripPreamble(parsed && parsed.text);
  if (!revised) {
    throw new HttpsError(
      "internal",
      "AI returned an empty revision. Please try again.",
    );
  }
  return {
    uid,
    text: revised.slice(0, 1200),
    model: REVISE_MODEL,
  };
}

function createReviseQuestion(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 45, memory: "256MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }

      // Validate BEFORE consuming quota — same ordering pattern as
      // suggestAnswer (Codex P2 fix from PR #424).
      const inputs = sanitizeInputs(request.data || {});
      const errs = validateInputs(inputs);
      if (errs.length > 0) {
        throw new HttpsError("invalid-argument", errs.join(" "));
      }

      await assertAndIncrement(uid, "revise_question");

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runReviseQuestion({uid, inputs, apiKey});
    },
  );
}

module.exports = {createReviseQuestion, runReviseQuestion};
