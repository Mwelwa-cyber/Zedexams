/**
 * Pure embedding-similarity core for the Qix review agent's semantic
 * duplicate detection. No firebase deps so it runs under plain `node` in
 * tests (the *Core.js split, like questionDedupCore.js).
 *
 * Vectors come from OpenAI text-embedding-3-small (1536-dim), computed in
 * functions/openaiEmbeddings.js. This module only COMPARES them.
 */

// Cosine ≥ this is treated as the "same concept, different wording" signal.
// Conservative: a missed semantic dup is cheaper than a wrongly-merged
// distinct question (which loses content).
const SEMANTIC_DUPLICATE_THRESHOLD = 0.85;

/**
 * Cosine similarity of two equal-length numeric vectors, in [-1, 1].
 * Returns 0 for any malformed / mismatched / empty input.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find the best semantic-duplicate candidate for `embedding`.
 *
 * @param {number[]} embedding  the new question's vector
 * @param {Array<{id:string, embedding?:number[]}>} candidates  siblings (already excludes self)
 * @param {{threshold?:number}} [opts]
 * @returns {{isDuplicate:boolean, duplicateOf:string|null, similarity:number, kind:('semantic'|null)}}
 */
function classifyEmbeddingDuplicate(embedding, candidates, opts = {}) {
  const threshold = typeof opts.threshold === "number" ?
    opts.threshold : SEMANTIC_DUPLICATE_THRESHOLD;
  let best = {isDuplicate: false, duplicateOf: null, similarity: 0, kind: null};
  if (!Array.isArray(embedding) || !embedding.length) return best;

  for (const cand of candidates || []) {
    if (!cand || !cand.id || !Array.isArray(cand.embedding) || !cand.embedding.length) continue;
    const sim = cosineSimilarity(embedding, cand.embedding);
    if (sim >= threshold && sim > best.similarity) {
      best = {isDuplicate: true, duplicateOf: cand.id, similarity: sim, kind: "semantic"};
    }
  }
  return best;
}

module.exports = {
  SEMANTIC_DUPLICATE_THRESHOLD,
  cosineSimilarity,
  classifyEmbeddingDuplicate,
};
