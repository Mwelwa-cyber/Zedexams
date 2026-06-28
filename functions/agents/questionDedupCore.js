/**
 * Pure duplicate-classification core for the Central Question Bank review
 * agent (Qix). No firebase-admin / firebase-functions deps so it runs under
 * plain `node` in tests (the *Core.js split, same as metaWhatsAppCore.js).
 *
 * Fingerprints (`fingerprint`) and token arrays (`simhashTokens`) are computed
 * client-side at capture by src/utils/questionBankCore.js. This module only
 * COMPARES them, so the two runtimes never need identical tokenizers — they
 * need identical *comparison* (Jaccard), which is duplicated here verbatim and
 * covered by tests.
 */

// Default thresholds. Exact fingerprint match is always a duplicate; above
// NEAR is a near-duplicate. Tuned conservatively so we err toward "not a
// duplicate" (a missed dupe is cheaper than a wrongly-merged distinct
// question, which loses content).
const NEAR_DUPLICATE_THRESHOLD = 0.82;

/** Jaccard similarity of two token arrays, in [0,1]. Mirrors questionBankCore.js. */
function jaccardSimilarity(aTokens, bTokens) {
  const a = new Set(aTokens || []);
  const b = new Set(bTokens || []);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Decide whether `candidate` duplicates any of `existing`.
 *
 * @param {{fingerprint?:string, simhashTokens?:string[]}} candidate  the new question
 * @param {Array<{id:string, fingerprint?:string, simhashTokens?:string[]}>} existing  sibling questions to compare against (already excludes the candidate itself)
 * @param {{nearThreshold?:number}} [opts]
 * @returns {{isDuplicate:boolean, duplicateOf:string|null, similarity:number, kind:('exact'|'near'|null)}}
 */
function classifyDuplicate(candidate, existing, opts = {}) {
  const nearThreshold = typeof opts.nearThreshold === "number"
    ? opts.nearThreshold
    : NEAR_DUPLICATE_THRESHOLD;
  const fp = candidate && candidate.fingerprint;
  const tokens = (candidate && candidate.simhashTokens) || [];

  let best = {isDuplicate: false, duplicateOf: null, similarity: 0, kind: null};

  for (const row of existing || []) {
    if (!row || !row.id) continue;
    // Exact fingerprint hit wins immediately.
    if (fp && row.fingerprint && fp === row.fingerprint) {
      return {isDuplicate: true, duplicateOf: row.id, similarity: 1, kind: "exact"};
    }
    const sim = jaccardSimilarity(tokens, row.simhashTokens);
    if (sim >= nearThreshold && sim > best.similarity) {
      best = {isDuplicate: true, duplicateOf: row.id, similarity: sim, kind: "near"};
    }
  }
  return best;
}

/**
 * Map the AI agent's recommendation to a reviewStatus. Centralised so the
 * trigger and its tests agree. Falls back to 'needs_admin' (fail-closed) for
 * anything unexpected — an unknown verdict must never auto-approve into the
 * Master Bank.
 *
 * @param {string} recommendation  'approve' | 'needs_admin' | 'reject'
 * @returns {{reviewStatus:string, masterEligible:boolean}}
 */
function recommendationToStatus(recommendation) {
  switch (recommendation) {
    case "approve":
      return {reviewStatus: "approved", masterEligible: true};
    case "reject":
      return {reviewStatus: "rejected", masterEligible: false};
    case "needs_admin":
    default:
      return {reviewStatus: "needs_admin", masterEligible: false};
  }
}

module.exports = {
  NEAR_DUPLICATE_THRESHOLD,
  jaccardSimilarity,
  classifyDuplicate,
  recommendationToStatus,
};
