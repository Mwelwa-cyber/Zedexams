/**
 * studioGenerateLessonPlan — the Lesson Plan Studio's door into the ONE
 * lesson-plan operation.
 *
 * ## What this file used to be
 *
 * A second lesson-plan generator. It took `systemPrompt` and `userPrompt` as
 * strings from the browser, called the model itself, metered usage itself, and
 * wrote its own auto-ID `aiGenerations` record with `tool: "lesson_plan_studio"`.
 * Nothing about it was reserved, resumable or deduplicated, and it shared no
 * identity with `generateLessonPlan` — the same teacher asking for the same
 * lesson through the two surfaces produced two charges and two documents.
 *
 * ## What it is now
 *
 * An adapter, about thirty lines. It authenticates, resolves the API key, and
 * hands a TYPED request to `runLessonPlanOperation`. The prompts are chosen
 * server-side from `curriculumMode`; `systemPrompt` and `userPrompt` are no
 * longer accepted at all, so a browser payload can no longer replace the
 * curriculum instructions, the JSON contract or the writing standards.
 *
 * The response shape is unchanged (`{text, usage, kbWarning}` plus the new
 * `generationId`), so the studio's renderer did not have to move with it.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertCallableRateLimit} = require("../rateLimit");
const {assertVerifiedAuth} = require("../authGuard");
const {getAnthropicApiKey, getUserRole, isStaffRole} = require("../aiService");
const {ENTRY_POINTS, runLessonPlanOperation} = require("./lessonPlan/runLessonPlanOperation");

function createStudioGenerateLessonPlan(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertCallableRateLimit(request, {
          action: "studioGenerateLessonPlan", userPerMin: 8,
        });

        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }

        const data = request.data || {};
        return runLessonPlanOperation({
          uid,
          idempotencyKey: data.idempotencyKey,
          inputs: data,
          apiKey: getAnthropicApiKey(anthropicApiKeySecret),
          entryPoint: ENTRY_POINTS.studio,
        });
      },
  );
}

module.exports = {createStudioGenerateLessonPlan};
