/**
 * B3/OBS-005 coverage guard: every provider-backed, user-invokable endpoint in
 * the inventory must have its burst limiter wired in source. Run:
 *   node functions/aiProviderCallInventory.test.js
 * Root-install-safe (reads files, never loads firebase).
 *
 * This is the check that replaces the unsupported "complete coverage" claim
 * with verifiable evidence: if a listed surface loses its limiter (or a new
 * provider-backed endpoint is added to the inventory without one), CI fails.
 */

const assert = require("node:assert");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {LIMITED, EXEMPT} = require("./aiProviderCallInventory");

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; }

const HERE = __dirname;
const cache = new Map();
function readFile(rel) {
  if (!cache.has(rel)) cache.set(rel, readFileSync(join(HERE, rel), "utf8"));
  return cache.get(rel);
}

console.log("aiProviderCallInventory coverage guard");

// Each LIMITED entry's source file must contain its limiter `check` token AND
// at least one of the recognised limiter calls.
const LIMITER_CALLS = [
  "assertCallableRateLimit",
  "assertGeneratorRateLimit",
  "assertHttpRateLimit",
  "guardHttpRateLimit",
];
let missing = [];
for (const e of LIMITED) {
  let src;
  try { src = readFile(e.file); } catch (err) {
    missing.push(`${e.name}: source ${e.file} unreadable (${err.message})`);
    continue;
  }
  const hasCheck = src.includes(e.check);
  const hasCall = LIMITER_CALLS.some((c) => src.includes(c));
  if (!hasCheck || !hasCall) {
    missing.push(`${e.name} (${e.file}): ${!hasCheck ? `missing limiter token ${JSON.stringify(e.check)}` : "no limiter call"}`);
  } else {
    passed += 1;
    console.log(`  ok  ${e.name} → limiter present`);
  }
}

assert.strictEqual(missing.length, 0,
  `Provider-backed endpoints WITHOUT a burst limiter:\n  - ${missing.join("\n  - ")}`);

ok("inventory is non-trivial (>= 40 limited surfaces)", LIMITED.length >= 40);
ok("no duplicate inventory names",
  new Set(LIMITED.map((e) => e.name)).size === LIMITED.length);
ok("exemptions are documented with a reason",
  EXEMPT.every((e) => e.name && e.reason));

console.log(`\naiProviderCallInventory: ${LIMITED.length} limited surfaces verified, ` +
  `${EXEMPT.length} documented exemptions · ${passed} checks passed`);
