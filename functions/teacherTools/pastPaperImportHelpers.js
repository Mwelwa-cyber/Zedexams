"use strict";

/**
 * Pure, dependency-free helpers for the past-paper AI import. Kept separate
 * from pastPaperImport.js (which pulls firebase-admin, mammoth, and
 * firebase-functions at require time) so the logic can be unit-tested with a
 * plain `node` run — the CI "Tests" job installs root deps only, not the
 * functions/ package.
 */

/**
 * Drop questions the model returned twice. LLM extraction occasionally emits
 * the same MCQ more than once (especially on long papers), which lands as a
 * duplicate card in the editor. Two questions are the same when their stem and
 * option set are identical after normalisation — order/position is ignored.
 * Survivors are re-sequenced so `order` stays 0..N.
 */
function dedupeExtractedQuestions(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions) {
    const key = [
      String(q.prompt || "").toLowerCase().replace(/\s+/g, " ").trim(),
      (q.options || [])
        .map((o) => String(o || "").toLowerCase().replace(/\s+/g, " ").trim())
        .join("␟"),
    ].join("␟");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(out.length === q.order ? q : {...q, order: out.length});
  }
  return out;
}

module.exports = {dedupeExtractedQuestions};
