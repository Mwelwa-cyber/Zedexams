"use strict";

/**
 * appCheckHealthCore — pure helpers for the sharded + sampled App Check
 * observability counters. No firebase-admin dependency, so it unit-tests
 * under plain `node` (the *Core.js split used elsewhere in this repo).
 *
 * WHY THIS EXISTS
 * ---------------
 * softVerifyAppCheckHttp / recordAppCheckCallable used to `await` an
 * increment on ONE shared document per day — appCheckHealth/{date} — on
 * essentially every request. At ~1k concurrent users that single doc blows
 * past Firestore's ~1 sustained write/sec/doc limit, so the awaited write
 * contends (ABORTED retries) and adds latency to the whole request path.
 *
 * Two mitigations, both here:
 *   1. SHARDING — writes fan out across N shard docs
 *      appCheckHealth/{date}/shards/{shardId}, spreading the load N-way.
 *   2. SAMPLING — only a configurable fraction of requests write at all.
 *      Each recorded write is WEIGHTED by 1/sampleRate so the dashboard
 *      can still estimate real totals from the sampled subset.
 *
 * The default sample rate is 1.0 (record everything) — sharding alone
 * removes the hotspot, and App-Check attestation telemetry is the signal
 * the admin uses to decide whether to hard-enforce, so we don't silently
 * throw most of it away. Operators dial APPCHECK_HEALTH_SAMPLE_RATE down
 * (e.g. 0.05) once traffic is high enough that the sampled subset is
 * statistically sufficient. Weighting keeps the dashboard numbers honest
 * at any rate.
 */

// Canonical per-label counters the dashboard sums. Exactly one of
// valid/missing/invalid is bumped per attempt (they are mutually
// exclusive), so attempts == valid + missing + invalid always holds.
const OUTCOMES = ["valid", "missing", "invalid"];

const DEFAULT_SHARD_COUNT = 32;
const MAX_SHARD_COUNT = 512;
const DEFAULT_SAMPLE_RATE = 1;

/**
 * Number of shard docs to spread writes across. Env-tunable so ops can
 * widen the fan-out on a redeploy with no code change. Clamped to a sane
 * band; junk / non-positive values fall back to the default.
 */
function resolveShardCount(env = process.env) {
  const raw = parseInt(env.APPCHECK_HEALTH_SHARDS, 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHARD_COUNT;
  return Math.min(raw, MAX_SHARD_COUNT);
}

/**
 * Fraction of requests that perform a Firestore write, in (0, 1].
 * Default 1 (all). Junk / non-positive → default; > 1 clamps to 1.
 */
function resolveSampleRate(env = process.env) {
  const raw = Number(env.APPCHECK_HEALTH_SAMPLE_RATE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SAMPLE_RATE;
  return Math.min(raw, 1);
}

/** Weight one sampled write stands for. rate 0.05 → each write counts 20. */
function weightForSampleRate(sampleRate) {
  const r = Number(sampleRate);
  return Number.isFinite(r) && r > 0 ? 1 / r : 1;
}

/** True when this request is selected to write. rng() ∈ [0,1). */
function shouldSample(sampleRate, rng = Math.random) {
  const r = resolveNum(sampleRate, DEFAULT_SAMPLE_RATE);
  if (r >= 1) return true;
  if (r <= 0) return false;
  return rng() < r;
}

/** Uniformly pick a shard id in [0, shardCount). */
function pickShardId(shardCount, rng = Math.random) {
  const n = Number.isFinite(shardCount) && shardCount > 0 ?
    Math.floor(shardCount) : DEFAULT_SHARD_COUNT;
  return Math.floor(rng() * n);
}

function resolveNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Classify one attempt into exactly one outcome bucket.
 *   verified            → the token verified OK.
 *   !tokenPresent       → no token at all ("missing").
 *   token but !verified → "invalid" IF the caller can tell the two apart
 *                         (HTTP path), else folded into "missing"
 *                         (callable path can't distinguish).
 */
function classifyOutcome({tokenPresent, verified, canDistinguishInvalid}) {
  if (verified) return "valid";
  if (!tokenPresent) return "missing";
  return canDistinguishInvalid ? "invalid" : "missing";
}

/**
 * Build the weighted increment payload for one shard write. `inc` is the
 * FieldValue.increment factory (injected so this stays firebase-free and
 * testable — tests pass a fake that records the numbers).
 *
 * Writes the weighted attempt + its outcome bucket, plus a RAW (weight-1)
 * `_sampled` counter so the dashboard can show the true sample size behind
 * an estimate. Unknown keys are ignored by the existing summariser, so
 * adding `_sampled` is backwards-compatible.
 */
function buildHealthShardUpdate({label, outcome, weight, inc}) {
  const safe = String(label || "unknown").slice(0, 64);
  const w = resolveNum(weight, 1);
  const out = OUTCOMES.includes(outcome) ? outcome : "missing";
  const u = {};
  u[`${safe}_attempts`] = inc(w);
  u[`${safe}_${out}`] = inc(w);
  u[`${safe}_sampled`] = inc(1);
  return u;
}

/**
 * Sum an array of raw counter objects (legacy day doc + shard docs) into
 * one flat day row, summing every numeric field and carrying `date`
 * through. Used on the read side so legacy single-doc days and new
 * sharded days aggregate identically — no double counting because a given
 * date's events live in exactly one shape (parent doc pre-migration,
 * shards after).
 */
function mergeCounterDocs(date, docs) {
  const merged = {date};
  for (const doc of docs) {
    if (!doc) continue;
    for (const [k, v] of Object.entries(doc)) {
      if (k === "date" || k === "updatedAt") continue;
      if (typeof v === "number" && Number.isFinite(v)) {
        merged[k] = (merged[k] || 0) + v;
      }
    }
  }
  return merged;
}

module.exports = {
  OUTCOMES,
  DEFAULT_SHARD_COUNT,
  DEFAULT_SAMPLE_RATE,
  resolveShardCount,
  resolveSampleRate,
  weightForSampleRate,
  shouldSample,
  pickShardId,
  classifyOutcome,
  buildHealthShardUpdate,
  mergeCounterDocs,
};
