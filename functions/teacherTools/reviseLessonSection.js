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

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertCallableRateLimit} = require("../rateLimit");
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
  toolInputSchema,
  normalizeOutput,
  SYSTEM_PROMPT,
} = require("./reviseLessonSectionLogic");

const REVISE_MODEL = process.env.REVISE_SECTION_MODEL || "claude-haiku-4-5";

async function runReviseLessonSection({uid, inputs, apiKey}) {
  const {parsed, model} = await callClaude(apiKey, {
    track: {uid, tool: "reviseLessonSection"},
    model: REVISE_MODEL,
    mode: "tool",
    systemPrompt: SYSTEM_PROMPT,
    messages: [{role: "user", content: buildUserPrompt(inputs)}],
    maxTokens: 900,
    temperature: 0.3,
    toolName: "submit_revised_section",
    toolDescription:
      "Submit the rewritten lesson-plan section — just the revised content, " +
      "nothing else.",
    toolInputSchema: toolInputSchema(inputs.kind),
  });

  const out = normalizeOutput(parsed, inputs.kind);
  const empty = inputs.kind === "list" ?
    !Array.isArray(out.items) || out.items.length === 0 :
    !out.text;
  if (empty) {
    throw new HttpsError(
      "internal",
      "AI returned an empty revision. Please try again.",
    );
  }
  return {...out, model: model || REVISE_MODEL};
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

      // Validate BEFORE consuming quota (same ordering as reviseQuestion).
      const inputs = sanitizeInputs(request.data || {});
      const errs = validateInputs(inputs);
      if (errs.length > 0) {
        throw new HttpsError("invalid-argument", errs.join(" "));
      }

      await assertAndIncrement(uid, "revise_lesson_section");

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runReviseLessonSection({uid, inputs, apiKey});
    },
  );
}

module.exports = {createReviseLessonSection, runReviseLessonSection};
