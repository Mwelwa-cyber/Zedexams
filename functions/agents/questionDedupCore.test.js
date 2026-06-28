/**
 * Tests for the Qix duplicate-classification core (pure, no firebase deps).
 *
 * Run: node functions/agents/questionDedupCore.test.js
 */

const {
  jaccardSimilarity, classifyDuplicate, recommendationToStatus,
} = require("./questionDedupCore");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures += 1; console.error(`  ✗ ${msg}`); }
}

console.log("jaccardSimilarity");
{
  assert(jaccardSimilarity(["a", "b"], ["a", "b"]) === 1, "identical sets → 1");
  assert(jaccardSimilarity([], ["a"]) === 0, "empty set → 0");
  assert(jaccardSimilarity(["a", "b", "c", "d"], ["a", "b"]) === 0.5, "half overlap → 0.5");
}

console.log("\nclassifyDuplicate — exact fingerprint wins");
{
  const cand = {fingerprint: "abc123", simhashTokens: ["x", "y", "z"]};
  const existing = [
    {id: "old1", fingerprint: "abc123", simhashTokens: ["x"]},
    {id: "old2", fingerprint: "zzz999", simhashTokens: ["x", "y", "z"]},
  ];
  const r = classifyDuplicate(cand, existing);
  assert(r.isDuplicate && r.kind === "exact" && r.duplicateOf === "old1", "exact fingerprint match is flagged first");
  assert(r.similarity === 1, "exact match similarity is 1");
}

console.log("\nclassifyDuplicate — near-duplicate over threshold");
{
  const cand = {fingerprint: "new", simhashTokens: ["photosynthesis", "glucose", "plants", "green", "produces"]};
  const existing = [
    {id: "near", fingerprint: "x", simhashTokens: ["photosynthesis", "glucose", "plants", "green", "makes"]},
    {id: "far", fingerprint: "y", simhashTokens: ["water", "cycle", "evaporation"]},
  ];
  const r = classifyDuplicate(cand, existing, {nearThreshold: 0.6});
  assert(r.isDuplicate && r.kind === "near" && r.duplicateOf === "near", "high-overlap sibling flagged as near-duplicate");
  assert(r.similarity > 0.6, "near similarity exceeds threshold");
}

console.log("\nclassifyDuplicate — no match");
{
  const cand = {fingerprint: "new", simhashTokens: ["alpha", "beta"]};
  const existing = [{id: "x", fingerprint: "z", simhashTokens: ["gamma", "delta"]}];
  const r = classifyDuplicate(cand, existing);
  assert(!r.isDuplicate && r.duplicateOf === null, "distinct question is not a duplicate");
}

console.log("\nclassifyDuplicate — legacy rows without tokens are skipped");
{
  const cand = {fingerprint: "new", simhashTokens: ["alpha", "beta"]};
  const existing = [{id: "legacy"}];
  const r = classifyDuplicate(cand, existing);
  assert(!r.isDuplicate, "rows missing fingerprint/tokens never spuriously match");
}

console.log("\nrecommendationToStatus — fail-closed mapping");
{
  assert(recommendationToStatus("approve").reviewStatus === "approved" && recommendationToStatus("approve").masterEligible === true, "approve → approved + master eligible");
  assert(recommendationToStatus("reject").reviewStatus === "rejected" && recommendationToStatus("reject").masterEligible === false, "reject → rejected, not eligible");
  assert(recommendationToStatus("needs_admin").reviewStatus === "needs_admin", "needs_admin → needs_admin");
  assert(recommendationToStatus("garbage").reviewStatus === "needs_admin" && recommendationToStatus("garbage").masterEligible === false, "unknown verdict fails closed to needs_admin");
}

console.log("\nrecommendationToStatus — auto-approve mode");
{
  // needs_admin is promoted to approved when the admin opted in...
  const na = recommendationToStatus("needs_admin", true);
  assert(na.reviewStatus === "approved" && na.masterEligible === true, "autoApprove: needs_admin → approved + master eligible");
  // ...but reject and unknown still fail closed — broken questions never slip through.
  assert(recommendationToStatus("reject", true).reviewStatus === "rejected", "autoApprove: reject still rejected");
  assert(recommendationToStatus("garbage", true).reviewStatus === "needs_admin", "autoApprove: unknown verdict still fails closed");
  assert(recommendationToStatus("approve", true).reviewStatus === "approved", "autoApprove: approve stays approved");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll questionDedupCore tests passed.");
