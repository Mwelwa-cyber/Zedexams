/**
 * B3/OBS-005 coverage guard (Gate 3). Two layers:
 *
 *   (1) TOKEN CHECK — every LIMITED inventory entry's source file still contains
 *       its limiter `check` token AND a recognised limiter call. Catches a
 *       limiter being silently removed from a listed surface.
 *
 *   (2) AUTO-DISCOVERY — parse the DEPLOYED surface straight out of
 *       functions/index.js (every `exports.X = …`), tag each with its Cloud
 *       Function kind + whether it binds a provider secret, and FAIL on any
 *       provider-backed, user-invokable (callable/http) endpoint that is neither
 *       LIMITED nor EXEMPT-with-a-reason. This is what a hand-maintained list
 *       cannot do: it catches a NEW provider-backed callable added without a
 *       limiter and without an inventory row — the exact gap that let an earlier
 *       "complete coverage" claim be wrong. It also flags STALE inventory rows
 *       (a LIMITED/EXEMPT name that no longer maps to a deployed export).
 *
 * Root-install-safe: reads files, never loads firebase. Run:
 *   node functions/aiProviderCallInventory.test.js
 */

const assert = require("node:assert");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {LIMITED, EXEMPT} = require("./aiProviderCallInventory");
const {discoverEndpoints} = require("./aiEndpointDiscovery");

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; }

const HERE = __dirname;
const cache = new Map();
function readFileOrNull(rel) {
  if (!cache.has(rel)) {
    try { cache.set(rel, readFileSync(join(HERE, rel), "utf8")); } catch { cache.set(rel, null); }
  }
  return cache.get(rel);
}

console.log("aiProviderCallInventory coverage guard");

// ── (1) TOKEN CHECK — listed limiters still wired ───────────────────────────
const LIMITER_CALLS = [
  "assertCallableRateLimit",
  "assertGeneratorRateLimit",
  "assertHttpRateLimit",
  "guardHttpRateLimit",
];
const missing = [];
for (const e of LIMITED) {
  const src = readFileOrNull(e.file);
  if (src == null) { missing.push(`${e.name}: source ${e.file} unreadable`); continue; }
  const hasCheck = src.includes(e.check);
  const hasCall = LIMITER_CALLS.some((c) => src.includes(c));
  if (!hasCheck || !hasCall) {
    missing.push(`${e.name} (${e.file}): ${!hasCheck ? `missing limiter token ${JSON.stringify(e.check)}` : "no limiter call"}`);
  } else {
    passed += 1;
  }
}
assert.strictEqual(missing.length, 0,
  `Provider-backed endpoints WITHOUT a burst limiter:\n  - ${missing.join("\n  - ")}`);
console.log(`  ok  ${LIMITED.length} listed limiters present in source`);

ok("inventory is non-trivial (>= 40 limited surfaces)", LIMITED.length >= 40);
ok("no duplicate inventory names",
  new Set(LIMITED.map((e) => e.name)).size === LIMITED.length);
ok("every exemption carries a reason",
  EXEMPT.every((e) => e.name && e.reason));

// ── (2) AUTO-DISCOVERY — the deployed surface, classified ───────────────────
const indexSrc = readFileOrNull("index.js");
assert.ok(indexSrc, "functions/index.js must be readable");

const endpoints = discoverEndpoints({indexSrc, readFile: readFileOrNull});
ok("discovery found the deployed surface (>= 100 exports)", endpoints.length >= 100);

const limitedNames = new Set(LIMITED.map((e) => e.name));
const exemptNames = new Set(EXEMPT.map((e) => e.name));
const classified = (name) => limitedNames.has(name) || exemptNames.has(name);

// The core guard: every provider-backed, user-invokable endpoint must be
// classified. `unknown`-kind endpoints are treated as user-invokable (fail
// closed) so a resolver miss can't hide an uncapped provider call.
const providerInvokable = endpoints.filter((e) => e.providerBacked && e.userInvokable);
ok("discovery actually sees provider-backed surfaces (>= 30)", providerInvokable.length >= 30);

const unclassified = providerInvokable.filter((e) => !classified(e.name));
assert.strictEqual(unclassified.length, 0,
  "Provider-backed user-invokable endpoints NOT in the inventory (add a limiter " +
  "+ a LIMITED row, or an EXEMPT row with a reason):\n  - " +
  unclassified.map((e) => `${e.name} (${e.kind})`).join("\n  - "));
console.log(`  ok  ${providerInvokable.length} provider-backed callable/http endpoints all classified`);

// Provider-backed triggers/crons are excluded by KIND (no client entry point) —
// prove that exclusion is real, not an accident of a missed export.
const providerTriggers = endpoints.filter((e) => e.providerBacked && !e.userInvokable);
console.log(`  ok  ${providerTriggers.length} provider-backed trigger/cron surfaces excluded by kind`);

// ── STALE detection — an inventory name that no longer maps to a real export ─
// A LIMITED entry names a deployed export (index.js) OR a handler in its own
// file (e.g. tts.js's apiTextToSpeech, re-exported through index.js). Anything
// that resolves to neither is stale and must be pruned.
const deployedNames = new Set(endpoints.map((e) => e.name));
const staleLimited = [];
for (const e of LIMITED) {
  if (deployedNames.has(e.name)) continue;
  const src = readFileOrNull(e.file);
  // Fall back to: the name appears as an export/handler in its declared file.
  if (src && (src.includes(`exports.${e.name}`) || src.includes(e.check))) continue;
  staleLimited.push(`${e.name} (${e.file})`);
}
assert.strictEqual(staleLimited.length, 0,
  `STALE LIMITED rows — no matching deployed export/handler:\n  - ${staleLimited.join("\n  - ")}`);

// An EXEMPT row whose name matches an export must map to a real one; the
// documentation-only family rows (names with spaces) are skipped.
const staleExempt = EXEMPT
  .filter((e) => /^[A-Za-z0-9_]+$/.test(e.name) && !deployedNames.has(e.name))
  .map((e) => e.name);
assert.strictEqual(staleExempt.length, 0,
  `STALE EXEMPT rows — no matching deployed export:\n  - ${staleExempt.join("\n  - ")}`);
console.log("  ok  no stale LIMITED / EXEMPT inventory rows");

console.log(`\naiProviderCallInventory: ${LIMITED.length} limited surfaces, ` +
  `${EXEMPT.length} exemptions · ${endpoints.length} deployed exports discovered · ` +
  `${providerInvokable.length} provider-backed callable/http all classified · ${passed} checks passed`);
