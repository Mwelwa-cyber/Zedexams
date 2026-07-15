"use strict";

/**
 * Node test for the SHARDED AI usage counters (aiCostTracking.writeUsageRollups
 * + the shard-summing readers). Run: node functions/aiUsageShards.test.js
 *
 * Drives recordAiUsage against an increment-aware in-memory Firestore stub
 * and asserts:
 *   - hundreds of concurrent accounting writes distribute across shards
 *     (no single hot doc) and sum back to the exact totals
 *   - one tool dominating traffic spreads across its tool-shards
 *   - per-user docs are still written per uid (unchanged)
 *   - month-to-date read sums the monthly shards AND stays isolated per month
 *     (boundary rollover) AND folds in a legacy pre-migration parent doc
 *   - shard-read aggregation via shardedCounter helpers
 */

const assert = require("node:assert");
const admin = require("firebase-admin");
const {sumShardDocs, groupToolShards} = require("./shardedCounter");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── Increment-aware Firestore stub ────────────────────────────────────────
function makeDb() {
  const store = new Map();
  const pathOf = (segs) => segs.join("/");
  function applySet(path, data, merge) {
    const next = {...(merge ? store.get(path) || {} : {})};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "__inc" in v) next[k] = (Number(next[k]) || 0) + v.__inc;
      else if (v && typeof v === "object" && v.__ts) next[k] = "TS";
      else next[k] = v;
    }
    store.set(path, next);
  }
  function docRef(segs) {
    return {
      collection(name) { return colRef([...segs, name]); },
      async get() {
        const d = store.get(pathOf(segs));
        return {exists: d !== undefined, id: segs[segs.length - 1], data: () => (d ? {...d} : undefined)};
      },
      async set(data, opts) { applySet(pathOf(segs), data, !!(opts && opts.merge)); },
    };
  }
  function colRef(segs) {
    return {
      doc(id) { return docRef([...segs, id]); },
      async get() {
        const prefix = pathOf(segs) + "/";
        const docs = [];
        for (const [p, d] of store.entries()) {
          if (!p.startsWith(prefix)) continue;
          if (p.slice(prefix.length).includes("/")) continue;
          docs.push({id: p.slice(prefix.length), data: () => ({...d})});
        }
        return {docs, size: docs.length, forEach: (cb) => docs.forEach(cb)};
      },
    };
  }
  return {_store: store, collection(name) { return colRef([name]); }};
}

function installStub(db) {
  Object.defineProperty(admin, "firestore", {configurable: true, value: () => db});
  admin.firestore.FieldValue = {
    increment: (n) => ({__inc: n}),
    serverTimestamp: () => ({__ts: true}),
  };
}

function childDocs(db, prefix) {
  const out = [];
  for (const [p, d] of db._store.entries()) {
    if (!p.startsWith(prefix + "/")) continue;
    if (p.slice(prefix.length + 1).includes("/")) continue;
    out.push(d);
  }
  return out;
}

// Load AFTER admin exists; the module caches nothing at import that we stub.
const tracking = require("./aiCostTracking");
const {recordAiUsage, monthKeyUtc, getMonthToDateCostUsd, _resetBudgetCache} = tracking;

const DATE = new Date().toISOString().slice(0, 10);
const MONTH = monthKeyUtc();

// A Sonnet call: 1000 in, 500 out → cost = (1000*3 + 500*15)/1e6 = 0.0105 USD.
function sonnetUsage() {
  return {input_tokens: 1000, output_tokens: 500};
}
const ONE_CALL_COST = (1000 * 3 + 500 * 15) / 1_000_000;

console.log("aiUsageShards");

(async () => {
  // Force a small, deterministic shard count so "spread across shards" is
  // testable without a huge write count.
  const ORIG_SHARDS = process.env.AI_USAGE_SHARDS;
  process.env.AI_USAGE_SHARDS = "4";

  // ── Concurrent accounting writes distribute + sum correctly ───────────
  {
    const db = makeDb();
    installStub(db);
    const N = 200;
    await Promise.all(Array.from({length: N}, (_, i) =>
      recordAiUsage({uid: `u${i % 5}`, model: "claude-sonnet-4-5", usage: sonnetUsage(), tool: "generateQuiz"})));

    const dayShards = childDocs(db, `aiUsage/${DATE}/shards`);
    ok("day writes spread across multiple shards (no hot doc)", dayShards.length >= 2);
    const dayTotals = sumShardDocs(dayShards, {carry: ["date"]});
    ok("day callCount sums across shards", dayTotals.callCount === N);
    ok("day cost sums across shards", approx(dayTotals.totalCostUsd, N * ONE_CALL_COST));
    ok("day input tokens sum", dayTotals.totalInputTokens === N * 1000);

    // Per-user docs unchanged (one doc per uid, callCount split evenly).
    const userDocs = childDocs(db, `aiUsage/${DATE}/users`);
    ok("per-user docs written one-per-uid (unchanged)", userDocs.length === 5);
    ok("each user recorded N/5 calls", userDocs.every((u) => u.callCount === N / 5));
  }

  // ── One tool dominating traffic spreads across its tool-shards ────────
  {
    const db = makeDb();
    installStub(db);
    // 120 calls to the dominant tool, 12 to another.
    await Promise.all([
      ...Array.from({length: 120}, () => recordAiUsage({uid: "u1", model: "claude-sonnet-4-5", usage: sonnetUsage(), tool: "zedChat"})),
      ...Array.from({length: 12}, () => recordAiUsage({uid: "u2", model: "claude-sonnet-4-5", usage: sonnetUsage(), tool: "generateNotes"})),
    ]);
    const toolShardDocs = childDocs(db, `aiUsage/${DATE}/toolShards`);
    const dominantShards = toolShardDocs.filter((d) => d.tool === "zedChat");
    ok("dominant tool spread across >1 shard (no per-tool hot doc)", dominantShards.length >= 2);
    const grouped = groupToolShards(toolShardDocs);
    const zed = grouped.find((t) => t.tool === "zedChat");
    const notes = grouped.find((t) => t.tool === "generateNotes");
    ok("grouped dominant tool callCount correct", zed.callCount === 120);
    ok("grouped secondary tool callCount correct", notes.callCount === 12);
    ok("tools sorted by cost desc", grouped[0].tool === "zedChat");
  }

  // ── Monthly read: shard sum, month isolation, legacy fold-in ─────────
  {
    const db = makeDb();
    installStub(db);
    _resetBudgetCache();

    // 50 calls this month.
    await Promise.all(Array.from({length: 50}, () =>
      recordAiUsage({uid: "u1", model: "claude-sonnet-4-5", usage: sonnetUsage(), tool: "generateQuiz"})));

    // Seed a DIFFERENT month's shards — must NOT leak into this month's read.
    await db.collection("aiUsageMonthly").doc("2000-01")
        .collection("shards").doc("0")
        .set({month: "2000-01", totalCostUsd: {__inc: 999}, callCount: {__inc: 10}}, {merge: true});

    // Seed a LEGACY pre-migration parent doc for THIS month — must be folded in.
    await db.collection("aiUsageMonthly").doc(MONTH)
        .set({month: MONTH, totalCostUsd: {__inc: 1.5}, callCount: {__inc: 3}}, {merge: true});

    _resetBudgetCache();
    const monthCost = await getMonthToDateCostUsd();
    const expected = 50 * ONE_CALL_COST + 1.5; // shards + legacy parent, other month excluded
    ok("month-to-date sums shards + legacy parent", approx(monthCost, expected));
    ok("other months are excluded (boundary isolation)", monthCost < 999);
  }

  // ── Legacy-only day compatibility (no shards yet) ─────────────────────
  {
    const db = makeDb();
    installStub(db);
    // A pre-migration day: totals only on the parent doc, no shard subcollection.
    await db.collection("aiUsage").doc("2026-01-01")
        .set({date: "2026-01-01", totalCostUsd: {__inc: 4.25}, callCount: {__inc: 7}}, {merge: true});
    const legacyParent = db._store.get("aiUsage/2026-01-01");
    const shards = childDocs(db, "aiUsage/2026-01-01/shards");
    const merged = sumShardDocs([legacyParent, ...shards], {carry: ["date"]});
    ok("legacy-only day reads off the parent doc", merged.callCount === 7 && approx(merged.totalCostUsd, 4.25));
  }

  if (ORIG_SHARDS === undefined) delete process.env.AI_USAGE_SHARDS;
  else process.env.AI_USAGE_SHARDS = ORIG_SHARDS;

  console.log(`\n─── ${passed} assertions · all passed ───`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
