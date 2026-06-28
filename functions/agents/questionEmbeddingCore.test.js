/**
 * Tests for the pure embedding-similarity core (no firebase deps).
 *
 * Run: node functions/agents/questionEmbeddingCore.test.js
 */

const {
  cosineSimilarity, classifyEmbeddingDuplicate, SEMANTIC_DUPLICATE_THRESHOLD,
} = require("./questionEmbeddingCore");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures += 1; console.error(`  ✗ ${msg}`); }
}

console.log("cosineSimilarity");
{
  assert(cosineSimilarity([1, 0, 0], [1, 0, 0]) === 1, "identical vectors → 1");
  assert(cosineSimilarity([1, 0, 0], [0, 1, 0]) === 0, "orthogonal vectors → 0");
  assert(cosineSimilarity([1, 0], [-1, 0]) === -1, "opposite vectors → -1");
  assert(Math.abs(cosineSimilarity([1, 1], [2, 2]) - 1) < 1e-9, "same direction, different magnitude → 1");
  assert(cosineSimilarity([1, 2, 3], [1, 2]) === 0, "length mismatch → 0");
  assert(cosineSimilarity([], []) === 0, "empty → 0");
  assert(cosineSimilarity([0, 0], [1, 1]) === 0, "zero vector → 0");
  assert(cosineSimilarity("x", [1]) === 0, "non-array → 0");
}

console.log("\nclassifyEmbeddingDuplicate");
{
  const embedding = [1, 0, 0];
  const candidates = [
    {id: "near", embedding: [0.97, 0.05, 0]},   // ~0.998 cosine
    {id: "far", embedding: [0, 1, 0]},           // 0 cosine
    {id: "mid", embedding: [0.8, 0.6, 0]},       // 0.8 cosine (< threshold)
  ];
  const r = classifyEmbeddingDuplicate(embedding, candidates);
  assert(r.isDuplicate && r.duplicateOf === "near" && r.kind === "semantic", "flags the high-cosine sibling");
  assert(r.similarity > SEMANTIC_DUPLICATE_THRESHOLD, "similarity exceeds the threshold");

  const noHit = classifyEmbeddingDuplicate(embedding, [{id: "far", embedding: [0, 1, 0]}, {id: "mid", embedding: [0.8, 0.6, 0]}]);
  assert(!noHit.isDuplicate && noHit.duplicateOf === null, "nothing above threshold → not a duplicate");

  const legacy = classifyEmbeddingDuplicate(embedding, [{id: "old"}, {id: "old2", embedding: null}]);
  assert(!legacy.isDuplicate, "candidates without an embedding are skipped");

  assert(!classifyEmbeddingDuplicate([], candidates).isDuplicate, "no query embedding → not a duplicate");
  assert(!classifyEmbeddingDuplicate(embedding, []).isDuplicate, "no candidates → not a duplicate");

  // Picks the single best when several clear the bar.
  const multi = classifyEmbeddingDuplicate(embedding, [
    {id: "good", embedding: [0.9, 0.4, 0]},   // ~0.914
    {id: "best", embedding: [0.99, 0.01, 0]}, // ~0.9999
  ], {threshold: 0.85});
  assert(multi.duplicateOf === "best", "returns the highest-similarity match");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll questionEmbeddingCore tests passed.");
