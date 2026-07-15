"use strict";

/**
 * Node test for the sharded + sampled App Check health counters.
 * Run: node functions/appCheckHealthCore.test.js
 *
 * Covers: shard-count + sample-rate env parsing, shard selection spread,
 * the sampling decision, weighted-count building, outcome classification,
 * and the legacy+shard read-side merge (no double-count).
 */

const assert = require("node:assert");
const {
  resolveShardCount,
  resolveSampleRate,
  weightForSampleRate,
  shouldSample,
  pickShardId,
  classifyOutcome,
  buildHealthShardUpdate,
  mergeCounterDocs,
  DEFAULT_SHARD_COUNT,
} = require("./appCheckHealthCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("appCheckHealthCore");

// ── resolveShardCount env parsing ─────────────────────────────────────────
ok("shard count default when unset", resolveShardCount({}) === DEFAULT_SHARD_COUNT);
ok("shard count parses a valid int", resolveShardCount({APPCHECK_HEALTH_SHARDS: "64"}) === 64);
ok("shard count rejects 0", resolveShardCount({APPCHECK_HEALTH_SHARDS: "0"}) === DEFAULT_SHARD_COUNT);
ok("shard count rejects junk", resolveShardCount({APPCHECK_HEALTH_SHARDS: "nope"}) === DEFAULT_SHARD_COUNT);
ok("shard count clamps to max 512", resolveShardCount({APPCHECK_HEALTH_SHARDS: "99999"}) === 512);

// ── resolveSampleRate env parsing ─────────────────────────────────────────
ok("sample rate default 1 when unset", resolveSampleRate({}) === 1);
ok("sample rate parses 0.05", Math.abs(resolveSampleRate({APPCHECK_HEALTH_SAMPLE_RATE: "0.05"}) - 0.05) < 1e-9);
ok("sample rate rejects 0", resolveSampleRate({APPCHECK_HEALTH_SAMPLE_RATE: "0"}) === 1);
ok("sample rate rejects negative", resolveSampleRate({APPCHECK_HEALTH_SAMPLE_RATE: "-1"}) === 1);
ok("sample rate clamps >1 to 1", resolveSampleRate({APPCHECK_HEALTH_SAMPLE_RATE: "5"}) === 1);

// ── weightForSampleRate ───────────────────────────────────────────────────
ok("weight for 1.0 is 1", weightForSampleRate(1) === 1);
ok("weight for 0.05 is 20", weightForSampleRate(0.05) === 20);
ok("weight for 0.25 is 4", weightForSampleRate(0.25) === 4);
ok("weight for 0 falls back to 1", weightForSampleRate(0) === 1);

// ── shouldSample decision ─────────────────────────────────────────────────
ok("rate 1 always samples", shouldSample(1, () => 0.999) === true);
ok("rate 0.05 samples when rng below", shouldSample(0.05, () => 0.01) === true);
ok("rate 0.05 skips when rng above", shouldSample(0.05, () => 0.5) === false);
{
  // Empirical rate check over a deterministic sequence.
  let n = 0;
  const seq = [0.01, 0.02, 0.03, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
  let i = 0;
  for (let k = 0; k < seq.length; k += 1) if (shouldSample(0.25, () => seq[i++])) n += 1;
  ok("sampling roughly follows the rate", n === 3);
}

// ── pickShardId spread ────────────────────────────────────────────────────
{
  ok("shard id 0 at rng 0", pickShardId(32, () => 0) === 0);
  ok("shard id 31 near rng 1", pickShardId(32, () => 0.999) === 31);
  // Uniform-ish spread across many picks.
  const counts = new Array(32).fill(0);
  let seed = 1;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 3200; k += 1) counts[pickShardId(32, rng)] += 1;
  const usedShards = counts.filter((c) => c > 0).length;
  ok("writes distribute across all shards", usedShards === 32);
  const maxc = Math.max(...counts); const minc = Math.min(...counts);
  ok("no single shard dominates", maxc < minc * 3 + 20);
}

// ── classifyOutcome ───────────────────────────────────────────────────────
ok("verified → valid", classifyOutcome({verified: true, tokenPresent: true, canDistinguishInvalid: true}) === "valid");
ok("no token → missing", classifyOutcome({verified: false, tokenPresent: false, canDistinguishInvalid: true}) === "missing");
ok("bad token (HTTP) → invalid", classifyOutcome({verified: false, tokenPresent: true, canDistinguishInvalid: true}) === "invalid");
ok("bad token (callable) → missing", classifyOutcome({verified: false, tokenPresent: true, canDistinguishInvalid: false}) === "missing");

// ── buildHealthShardUpdate weighted counts ────────────────────────────────
{
  const inc = (n) => ({__inc: n});
  const u = buildHealthShardUpdate({label: "aiChat", outcome: "missing", weight: 20, inc});
  ok("attempts weighted", u.aiChat_attempts.__inc === 20);
  ok("missing bucket weighted", u.aiChat_missing.__inc === 20);
  ok("sampled counter is raw 1", u.aiChat_sampled.__inc === 1);
  ok("only the one outcome bucket is written", u.aiChat_valid === undefined && u.aiChat_invalid === undefined);

  const v = buildHealthShardUpdate({label: "aiChat", outcome: "valid", weight: 1, inc});
  ok("valid weighted at rate 1", v.aiChat_valid.__inc === 1 && v.aiChat_attempts.__inc === 1);

  // Label is length-capped + coerced.
  const long = "x".repeat(200);
  const w = buildHealthShardUpdate({label: long, outcome: "valid", weight: 1, inc});
  ok("label capped to 64 chars", Object.keys(w).some((k) => k.length <= 64 + "_attempts".length));
}

// ── mergeCounterDocs: legacy + shards, no double count ────────────────────
{
  // A pre-migration day: everything on the parent doc, no shards.
  const legacyOnly = mergeCounterDocs("2026-07-01", [
    {date: "2026-07-01", aiChat_attempts: 100, aiChat_valid: 90, aiChat_missing: 10, updatedAt: "ts"},
  ]);
  ok("legacy-only day sums off the parent doc", legacyOnly.aiChat_attempts === 100 && legacyOnly.aiChat_valid === 90);
  ok("non-numeric fields dropped", legacyOnly.updatedAt === undefined);

  // A post-migration day: only shard docs, summed across shards.
  const shardedOnly = mergeCounterDocs("2026-07-15", [
    {date: "2026-07-15", aiChat_attempts: 20, aiChat_valid: 20, aiChat_sampled: 1},
    {date: "2026-07-15", aiChat_attempts: 40, aiChat_valid: 20, aiChat_missing: 20, aiChat_sampled: 3},
    null, // a failed shard read must not blow up the merge
  ]);
  ok("shards sum across the subcollection", shardedOnly.aiChat_attempts === 60);
  ok("outcome buckets sum per shard", shardedOnly.aiChat_valid === 40 && shardedOnly.aiChat_missing === 20);
  ok("raw sampled count sums", shardedOnly.aiChat_sampled === 4);

  // Mixed (migration day): parent partial + shards — still additive, never doubled.
  const mixed = mergeCounterDocs("2026-07-10", [
    {date: "2026-07-10", aiChat_attempts: 5},
    {date: "2026-07-10", aiChat_attempts: 15},
  ]);
  ok("mixed day is additive (5+15=20)", mixed.aiChat_attempts === 20);
  ok("date carried through", mixed.date === "2026-07-10");
}

console.log(`\n─── ${passed} assertions · all passed ───`);
