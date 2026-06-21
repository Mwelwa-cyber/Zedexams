/**
 * Node test for the daily FX auto-refresh.
 * Run: node functions/fxRate.test.js
 *
 * Covers the pure helpers (isSaneFxRate / parseFxApiResponse / resolveZmwPerUsd
 * from treasury.js) and refreshFxRate's write behaviour against a stubbed fetch
 * + db — including the critical safety rule: a bad fetch must NOT overwrite the
 * last good rate.
 */

const assert = require("node:assert");
const {
  isSaneFxRate,
  parseFxApiResponse,
  resolveZmwPerUsd,
  DEFAULT_ZMW_PER_USD,
  FX_MAX_AGE_MS,
} = require("./treasury");
const {refreshFxRate} = require("./fxRate");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("fxRate");

// ── isSaneFxRate (band 5–100) ─────────────────────────────────────────────
ok("26 sane", isSaneFxRate(26));
ok("5 sane (lower bound)", isSaneFxRate(5));
ok("100 sane (upper bound)", isSaneFxRate(100));
ok("4.9 rejected", !isSaneFxRate(4.9));
ok("101 rejected", !isSaneFxRate(101));
ok("0 rejected", !isSaneFxRate(0));
ok("NaN rejected", !isSaneFxRate(NaN));
ok("junk rejected", !isSaneFxRate("abc"));

// ── parseFxApiResponse (open.er-api.com shape) ────────────────────────────
ok("valid response → ZMW rate", parseFxApiResponse({result: "success", rates: {ZMW: 27.3}}) === 27.3);
ok("result!=success → null", parseFxApiResponse({result: "error", rates: {ZMW: 27}}) === null);
ok("no rates → null", parseFxApiResponse({result: "success"}) === null);
ok("ZMW missing → null", parseFxApiResponse({result: "success", rates: {USD: 1}}) === null);
ok("ZMW out of band → null", parseFxApiResponse({result: "success", rates: {ZMW: 9999}}) === null);
ok("null input → null", parseFxApiResponse(null) === null);

// ── resolveZmwPerUsd (live vs fallback) ───────────────────────────────────
const NOW = 1_700_000_000_000;
ok("sane + fresh live → live",
  resolveZmwPerUsd({liveRate: 27.4, liveFetchedAtMs: NOW - 1000, now: NOW, envFallback: 26}) === 27.4);
ok("insane live → fallback",
  resolveZmwPerUsd({liveRate: 999, liveFetchedAtMs: NOW, now: NOW, envFallback: 26}) === 26);
ok("stale live → fallback",
  resolveZmwPerUsd({liveRate: 27.4, liveFetchedAtMs: NOW - (FX_MAX_AGE_MS + 1), now: NOW, envFallback: 26}) === 26);
ok("no timestamp + sane live → live (usable)",
  resolveZmwPerUsd({liveRate: 27.4, liveFetchedAtMs: NaN, now: NOW, envFallback: 26}) === 27.4);
ok("insane envFallback → DEFAULT",
  resolveZmwPerUsd({liveRate: 999, liveFetchedAtMs: NOW, now: NOW, envFallback: 0}) === DEFAULT_ZMW_PER_USD);
ok("missing live → fallback",
  resolveZmwPerUsd({envFallback: 30}) === 30);

// ── refreshFxRate write behaviour ─────────────────────────────────────────
function makeDb() {
  const sets = [];
  return {
    sets,
    collection: () => ({doc: () => ({set: async (data) => {
      sets.push(data);
    }})}),
  };
}

(async () => {
  // success → writes the rate
  {
    const db = makeDb();
    const fetchImpl = async () => ({ok: true, status: 200, json: async () => ({result: "success", rates: {ZMW: 27.3}})});
    const r = await refreshFxRate({db, fetchImpl, now: NOW});
    ok("success → ok + rate", r.ok === true && r.zmwPerUsd === 27.3);
    ok("success → wrote zmwPerUsd", db.sets.length === 1 && db.sets[0].zmwPerUsd === 27.3);
    ok("success → recorded fetchedAtMs", db.sets[0].fetchedAtMs === NOW);
  }

  // HTTP failure → does NOT overwrite the rate (only records lastError)
  {
    const db = makeDb();
    const fetchImpl = async () => ({ok: false, status: 503});
    const r = await refreshFxRate({db, fetchImpl, now: NOW});
    ok("HTTP fail → not ok", r.ok === false);
    ok("HTTP fail → did NOT write zmwPerUsd", db.sets.length === 1 && db.sets[0].zmwPerUsd === undefined);
    ok("HTTP fail → recorded lastError", typeof db.sets[0].lastError === "string");
  }

  // bad JSON (no sane ZMW) → does NOT overwrite the rate
  {
    const db = makeDb();
    const fetchImpl = async () => ({ok: true, status: 200, json: async () => ({result: "success", rates: {ZMW: -1}})});
    const r = await refreshFxRate({db, fetchImpl, now: NOW});
    ok("bad rate → not ok, no overwrite", r.ok === false && db.sets[0].zmwPerUsd === undefined);
  }

  // fetch throws → handled, not ok, no overwrite
  {
    const db = makeDb();
    const fetchImpl = async () => { throw new Error("network down"); };
    const r = await refreshFxRate({db, fetchImpl, now: NOW});
    ok("fetch throw → not ok", r.ok === false);
    ok("fetch throw → no zmwPerUsd written", db.sets[0].zmwPerUsd === undefined);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
