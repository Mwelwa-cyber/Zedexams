/**
 * Node test for the pure generator rate-limit policy (B3 / OBS-005).
 * Run: node functions/teacherTools/generatorRateLimitCore.test.js
 * Root-install-safe (no firebase).
 */

const assert = require("node:assert");
const {
  DEFAULT_GENERATOR_PER_MIN,
  resolveGeneratorPerMin,
  generatorRateLimitBucket,
} = require("./generatorRateLimitCore");

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

console.log("generatorRateLimitCore");

// ── resolveGeneratorPerMin ─────────────────────────────────────────────────
ok("unset env → default cap", resolveGeneratorPerMin({}) === DEFAULT_GENERATOR_PER_MIN);
ok("valid env override wins", resolveGeneratorPerMin({RATE_LIMIT_GENERATOR_PER_MIN: "25"}) === 25);
ok("zero/negative override ignored → default",
  resolveGeneratorPerMin({RATE_LIMIT_GENERATOR_PER_MIN: "0"}) === DEFAULT_GENERATOR_PER_MIN &&
  resolveGeneratorPerMin({RATE_LIMIT_GENERATOR_PER_MIN: "-5"}) === DEFAULT_GENERATOR_PER_MIN);
ok("garbage override ignored → default",
  resolveGeneratorPerMin({RATE_LIMIT_GENERATOR_PER_MIN: "abc"}) === DEFAULT_GENERATOR_PER_MIN);

// ── generatorRateLimitBucket ───────────────────────────────────────────────
{
  const b = generatorRateLimitBucket("homework", 10);
  ok("bucket namespaces the action per tool", b.action === "gen:homework");
  ok("bucket carries the per-user cap", b.userPerMin === 10);

  // Each tool gets its own window (a burst on one doesn't block another).
  ok("distinct tools → distinct actions",
    generatorRateLimitBucket("worksheet").action !== generatorRateLimitBucket("quiz").action);

  // Defensive slug handling — never emits a malformed/oversized action key.
  ok("tool slug is sanitised + lowercased",
    generatorRateLimitBucket("Scheme Of Work!!").action === "gen:schemeofwork");
  ok("empty/nullish tool → gen:unknown",
    generatorRateLimitBucket("").action === "gen:unknown" &&
    generatorRateLimitBucket(null).action === "gen:unknown");
  ok("invalid perMin falls back to default",
    generatorRateLimitBucket("x", 0).userPerMin === DEFAULT_GENERATOR_PER_MIN &&
    generatorRateLimitBucket("x", -1).userPerMin === DEFAULT_GENERATOR_PER_MIN);
}

console.log(`generatorRateLimitCore: ${passed} checks passed`);
