/**
 * functions/aiPromptPolicy.js
 *
 * Pure, dependency-free policy for who may override the AI chat system
 * prompt. Kept standalone (no firebase-admin / firebase-functions imports)
 * so it can be unit-tested by the repo-root `npm run test:all` without
 * installing functions/ dependencies — same rationale as
 * functions/grading/*.
 *
 * Why this exists: aiChat / apiAiChat used to pass the client-supplied
 * `systemPrompt` straight into the model, fully replacing the education
 * guardrail prompt AND stripping the page-context wrapper. Any signed-in
 * learner could therefore turn the paid Claude backend into a free
 * general-purpose LLM (cost abuse) and prompt-inject it. No first-party
 * caller sends a custom prompt — it is purely an abuse lever — so it is
 * ignored for everyone except staff (teacher/admin).
 */

// Mirrors aiService.js isStaffRole. Duplicated deliberately: this module
// must stay import-free so the test runner can load it. Keep the two in
// sync — both are the trivial { teacher | admin } predicate.
function isStaffRole(role) {
  return role === "teacher" || role === "admin";
}

/**
 * Returns the system prompt the model should actually use as an override,
 * or undefined to fall back to the server's education guardrail prompt.
 * Non-staff callers can never override, regardless of what they send.
 */
function resolveCustomSystemPrompt(role, customSystemPrompt) {
  return isStaffRole(role) ? customSystemPrompt : undefined;
}

module.exports = {isStaffRole, resolveCustomSystemPrompt};
