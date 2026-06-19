/**
 * Pure builder for the quiz-library mirror payload. Kept dependency-free (no
 * firebase-admin / firebase-functions) so it runs under a bare `node` test
 * without the functions package installed — same split as storageCleanup's
 * helpers.js vs its trigger wiring.
 */

// Fields dropped from the mirror: the large arrays/strings the quiz library
// never renders (the runner still reads the full quizzes/{id} doc for them).
// Keep in sync with scripts/backfill-quiz-summaries.mjs.
const HEAVY_FIELDS = ["passages", "parts", "description"];

/**
 * Build the mirror payload from a full quiz doc: every field except the heavy
 * ones. Does not mutate the input.
 */
function buildQuizSummary(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (HEAVY_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

module.exports = {buildQuizSummary, HEAVY_FIELDS};
