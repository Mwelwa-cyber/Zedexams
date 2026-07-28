/**
 * generateLessonPlan — the LEGACY door into the one lesson-plan operation.
 *
 * ## What this file used to be
 *
 * The schema-based lesson-plan generator: its own sanitiser, its own prompt,
 * its own CBC lookup, its own auto-ID `aiGenerations` document, its own usage
 * charge taken BEFORE any reservation existed. It ran beside
 * `studioGenerateLessonPlan`, which did the same job differently, so the same
 * teacher asking for the same lesson through the two surfaces produced two
 * charges and two documents.
 *
 * ## What it is now
 *
 * An adapter. `runLessonPlan` translates the legacy field names and hands the
 * request to `runLessonPlanOperation`, which every lesson-plan entry point now
 * reaches. What this file contributed to that operation — server-owned
 * validation, CBC grounding, structured output, deterministic identity — went
 * with it. What did not go with it was the auto-ID document and the
 * charge-before-reserve ordering.
 *
 * ## It is deprecated, and that is recorded rather than assumed
 *
 * The Lesson Plan Studio calls `studioGenerateLessonPlan`; nothing in the app
 * calls this one. But "nothing I can find calls it" is not "nothing calls it",
 * and a cached bundle or an integration would fail silently if it were simply
 * deleted. So it keeps working, `runLessonPlanOperation` logs every use with
 * its entry point, and the decision to remove it can rest on traffic.
 *
 * `runLessonPlan` is still exported: `apiGenerateLessonPlan` (the SSE endpoint)
 * and `agents/runners/aria.js` both call it directly.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertGeneratorRateLimit} = require("./generatorRateLimit");
const {getAnthropicApiKey, getUserRole, isStaffRole} = require("../aiService");

const {ENTRY_POINTS, runLessonPlanOperation} = require("./lessonPlan/runLessonPlanOperation");
const {legacyToTypedLessonPlanRequest} = require("./lessonPlan/legacyRequestAdapter");

/**
 * The legacy runner, kept at its original name and signature.
 *
 * `entryPoint` defaults to the legacy callable and is overridden by the SSE
 * endpoint. It is telemetry only — it never reaches the fingerprint, so a
 * request arriving through a different door is still the SAME operation.
 */
async function runLessonPlan({
  uid, rawInputs, apiKey, onProgress, idempotencyKey,
  entryPoint = ENTRY_POINTS.legacyCallable,
}) {
  return runLessonPlanOperation({
    uid,
    idempotencyKey,
    inputs: legacyToTypedLessonPlanRequest(rawInputs),
    apiKey,
    onProgress,
    entryPoint,
  });
}

function createGenerateLessonPlan(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertGeneratorRateLimit(request, "lesson_plan");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const data = request.data || {};
        return runLessonPlan({
          uid,
          rawInputs: data,
          apiKey: getAnthropicApiKey(anthropicApiKeySecret),
          idempotencyKey: data.idempotencyKey,
          entryPoint: ENTRY_POINTS.legacyCallable,
        });
      },
  );
}

module.exports = {
  createGenerateLessonPlan,
  runLessonPlan,
};
