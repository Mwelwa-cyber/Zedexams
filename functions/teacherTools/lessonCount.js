/**
 * aiLessonCount — HTTPS callable Cloud Function.
 *
 * Given a CBC topic/sub-topic (plus the syllabus row's learning activities
 * and expected standard), asks Claude Haiku how many lessons the sub-topic
 * should be taught over and returns a per-lesson breakdown (title + focus)
 * the Lesson Plan Studio seeds its Lesson Series builder with.
 *
 * This is the backend the Lesson Progression panel always assumed existed —
 * the client hook used to fall back to a deterministic "one lesson per
 * activity" heuristic, which made "Get New Suggestion" feel canned. The
 * `avoidCounts` input carries the counts the teacher has already been shown,
 * so each press genuinely re-plans the pacing rather than re-rolling the
 * same number.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'aiLessonCount');
 *   const result = await fn({
 *     grade: 'G5',
 *     subject: 'mathematics',
 *     topic: 'WHOLE NUMBERS',
 *     subtopic: 'Addition of whole numbers',
 *     learningActivities: ['Group work', 'Drill'],   // optional
 *     expectedStandard: 'Adds numbers up to 1000',   // optional
 *     avoidCounts: [3],                              // optional — prior suggestions
 *   });
 *   // result.data -> { count, reason, breakdown: [{lessonNumber, title, focus, status}] }
 *
 * Cheap micro tool — Haiku with ~500 tokens out per call. Gated by the
 * shared per-user daily AI cap (aiService.assertDailyLimit), not the
 * monthly plan meter: the suggestion is advisory and shouldn't consume a
 * teacher's generation quota.
 *
 * The pure helpers (sanitize / prompt / coerce) live in lessonCountCore.js
 * so the repo-root node test runs without functions/node_modules.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
  assertDailyLimit,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {
  sanitizeLessonCountInputs,
  validateLessonCountInputs,
  buildLessonCountPrompt,
  coerceLessonCountResult,
  SYSTEM_PROMPT,
  LESSON_COUNT_TOOL_SCHEMA,
} = require("./lessonCountCore");

const LESSON_COUNT_MODEL =
  process.env.AI_LESSON_COUNT_MODEL || "claude-haiku-4-5";

async function runAiLessonCount({inputs, apiKey}) {
  const claudeResult = await callClaude(apiKey, {
    model: LESSON_COUNT_MODEL,
    mode: "tool",
    systemPrompt: SYSTEM_PROMPT,
    messages: [{role: "user", content: buildLessonCountPrompt(inputs)}],
    maxTokens: 900,
    // Non-zero so "Get New Suggestion" re-plans rather than re-rolling the
    // identical output; avoidCounts does the heavy lifting on divergence.
    temperature: 0.5,
    toolName: "submit_lesson_plan_pacing",
    toolDescription:
      "Submit the recommended lesson count, a short reason, and the " +
      "per-lesson breakdown for the sub-topic.",
    toolInputSchema: LESSON_COUNT_TOOL_SCHEMA,
  });

  const result = coerceLessonCountResult(claudeResult.parsed, inputs);
  return {...result, model: LESSON_COUNT_MODEL};
}

function createAiLessonCount(anthropicApiKeySecret) {
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

      // Validate BEFORE consuming the daily allowance.
      const inputs = sanitizeLessonCountInputs(request.data || {});
      const errs = validateLessonCountInputs(inputs);
      if (errs.length > 0) {
        throw new HttpsError("invalid-argument", errs.join(" "));
      }

      await assertDailyLimit(uid, role, "aiLessonCount");

      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runAiLessonCount({inputs, apiKey});
    },
  );
}

module.exports = {createAiLessonCount, runAiLessonCount};
