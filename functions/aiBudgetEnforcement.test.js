"use strict";

/**
 * Node test for the admin budget-enforcement read model
 * (functions/aiBudgetEnforcement.js — the /admin/ai-costs panel's callable).
 *
 * Pins:
 *   - the admin gate (non-admin callers get permission-denied)
 *   - the disabled-ceiling shape (enabled:false, zero provider rows, the
 *     unattributed row hidden when empty)
 *   - per-provider aggregation: settled spend + open holds land on the right
 *     rows, month-wide released/expired counts, bucket total, provider list
 *   - fail-soft aggregates: a throwing aggregate degrades to zeros with
 *     partial:true instead of failing the panel
 *
 * Plain `node` script (repo convention). firebase-admin, HttpsError/onCall,
 * and AggregateField are stubbed via Module._load before the module under
 * test loads, so the test runs with root deps only.
 *
 * Run: node functions/aiBudgetEnforcement.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── In-memory Firestore stub with aggregate support ────────────────────────
// where()/limit() chain IMMUTABLY (the module reuses one collection ref for
// many queries — shared mutable filters would leak between them).
function makeDb() {
  const store = new Map(); // "a/b/c" -> data object
  const pathOf = (segs) => segs.join("/");

  function docRef(segs) {
    return {
      collection(name) { return colRef([...segs, name]); },
      async get() {
        const d = store.get(pathOf(segs));
        return {exists: d !== undefined, id: segs[segs.length - 1], data: () => (d ? {...d} : undefined)};
      },
      async set(data, opts) {
        const p = pathOf(segs);
        const cur = store.get(p) || {};
        store.set(p, opts && opts.merge ? {...cur, ...data} : {...data});
      },
    };
  }

  function matchingDocs(segs, filters, lim) {
    const prefix = pathOf(segs) + "/";
    const docs = [];
    for (const [p, d] of store.entries()) {
      if (!p.startsWith(prefix)) continue;
      if (p.slice(prefix.length).includes("/")) continue; // direct children only
      if (!filters.every((f) => applyOp(d[f.field], f.op, f.val))) continue;
      docs.push({id: p.slice(prefix.length), data: () => ({...d})});
    }
    return docs.slice(0, lim);
  }

  function colRef(segs, filters = [], lim = Infinity) {
    return {
      doc(id) { return docRef([...segs, id]); },
      where(field, op, val) { return colRef(segs, [...filters, {field, op, val}], lim); },
      limit(n) { return colRef(segs, filters, n); },
      async get() {
        const docs = matchingDocs(segs, filters, lim);
        return {docs, size: docs.length, forEach: (cb) => docs.forEach(cb)};
      },
      aggregate(spec) {
        return {
          get: async () => {
            if (db._aggregateThrows) throw new Error("aggregate unavailable");
            const docs = matchingDocs(segs, filters, lim);
            const out = {};
            for (const [key, agg] of Object.entries(spec)) {
              if (agg.__agg === "count") out[key] = docs.length;
              else if (agg.__agg === "sum") {
                out[key] = docs.reduce((s, d) => s + (Number(d.data()[agg.field]) || 0), 0);
              }
            }
            return {data: () => out};
          },
        };
      },
    };
  }

  function applyOp(a, op, b) {
    if (op === "==") return a === b;
    if (op === "<=") return a <= b;
    if (op === ">=") return a >= b;
    return false;
  }

  const db = {
    _store: store,
    _aggregateThrows: false,
    collection(name) { return colRef([name]); },
    doc(path) { return docRef(String(path).split("/")); },
  };
  return db;
}

// ── Module stubs (before the module under test loads) ──────────────────────
let currentDb = makeDb();
const firestoreFn = () => currentDb;
firestoreFn.FieldValue = {
  increment: (n) => ({__inc: n}),
  serverTimestamp: () => ({__ts: true}),
};
const adminStub = {firestore: firestoreFn};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "firebase-admin/firestore") {
    return {
      AggregateField: {
        count: () => ({__agg: "count"}),
        sum: (field) => ({__agg: "sum", field}),
      },
    };
  }
  if (request === "firebase-functions/v2/https") {
    // onCall unwraps to the raw handler so the test can invoke it directly.
    return {HttpsError, onCall: (opts, handler) => handler};
  }
  return origLoad.call(this, request, ...rest);
};

const tracking = require("./aiCostTracking");
const {
  getAiBudgetEnforcement,
  readEnforcementSummary,
  ENFORCED_PROVIDERS,
} = require("./aiBudgetEnforcement");

const ORIG_ENV = {
  budget: process.env.AI_MONTHLY_BUDGET_USD,
  mode: process.env.AI_BUDGET_MODE,
};

function installDb() {
  currentDb = makeDb();
  return currentDb;
}
function seedUser(db, uid, role) {
  db._store.set(`users/${uid}`, {role, email: `${uid}@test`});
}
function seedReservation(db, month, id, data) {
  db._store.set(`aiBudgetBuckets/${month}/reservations/${id}`, data);
}
// Admin callables now require an MFA-verified session (requireAdminMfa), so the
// token carries the second-factor claim Firebase stamps after a TOTP challenge.
const authed = (uid) => ({
  auth: {
    uid,
    token: {
      email: `${uid}@test`,
      email_verified: true,
      firebase: {sign_in_second_factor: "totp"},
    },
  },
});

console.log("aiBudgetEnforcement");

(async () => {
  delete process.env.AI_BUDGET_MODE;
  const month = tracking.monthKeyUtc();

  // ── Admin gate ────────────────────────────────────────────────────────────
  {
    const db = installDb();
    seedUser(db, "t1", "teacher");
    let code = null;
    try {
      await getAiBudgetEnforcement(authed("t1"));
    } catch (err) {
      code = err.code;
    }
    ok("non-admin caller is rejected with permission-denied", code === "permission-denied");

    let unauthCode = null;
    try {
      await getAiBudgetEnforcement({auth: null});
    } catch (err) {
      unauthCode = err.code;
    }
    ok("unauthenticated caller is rejected", unauthCode === "unauthenticated");
  }

  // ── Disabled ceiling → informative empty shape ────────────────────────────
  {
    delete process.env.AI_MONTHLY_BUDGET_USD;
    tracking._resetBudgetCache();
    const db = installDb();
    seedUser(db, "a1", "admin");
    const res = await getAiBudgetEnforcement(authed("a1"));
    ok("disabled ceiling reports budget.enabled false", res.budget && res.budget.enabled === false);
    ok("month key is the current UTC month", res.month === month);
    ok("all enforced providers render zero rows",
      res.providers.length === ENFORCED_PROVIDERS.length &&
      res.providers.every((p) => p.settledUsd === 0 && p.openCount === 0));
    ok("unattributed row is hidden when empty",
      !res.providers.some((p) => p.provider === "unattributed"));
    ok("enforcedProviders lists every migrated client",
      ["anthropic", "openai", "gemini", "embeddings"].every(
          (p) => res.enforcedProviders.includes(p)));
  }

  // ── Armed ceiling + seeded reservations → per-provider breakdown ─────────
  {
    process.env.AI_MONTHLY_BUDGET_USD = "10";
    tracking._resetBudgetCache();
    const db = installDb();
    seedUser(db, "a1", "superAdmin");
    seedReservation(db, month, "r1", {provider: "openai", status: "settled", reservedUsd: 0.006, actualUsd: 0.5});
    seedReservation(db, month, "r2", {provider: "openai", status: "settled", reservedUsd: 0.006, actualUsd: 0.25});
    seedReservation(db, month, "r3", {provider: "anthropic", status: "settled", reservedUsd: 0.18, actualUsd: 1.0});
    seedReservation(db, month, "r4", {provider: "gemini", status: "open", reservedUsd: 0.1, actualUsd: null});
    seedReservation(db, month, "r5", {provider: "gemini", status: "open", reservedUsd: 0.1, actualUsd: null});
    seedReservation(db, month, "r6", {provider: "openai", status: "released", reservedUsd: 0.006, actualUsd: null});
    seedReservation(db, month, "r7", {provider: "embeddings", status: "expired", reservedUsd: 0.0001, actualUsd: null});
    seedReservation(db, month, "r8", {provider: null, status: "settled", reservedUsd: 0.01, actualUsd: 0.05});
    db._store.set(`aiBudgetBuckets/${month}/buckets/0`, {reservedUsd: 1.95});

    const res = await getAiBudgetEnforcement(authed("a1"));
    const row = (p) => res.providers.find((r) => r.provider === p);
    ok("openai row sums settled actuals",
      approx(row("openai").settledUsd, 0.75) && row("openai").settledCount === 2);
    ok("released/expired reservations stay off the settled rows",
      approx(row("embeddings").settledUsd, 0) && row("embeddings").openCount === 0);
    ok("gemini row carries the open holds",
      approx(row("gemini").openUsd, 0.2) && row("gemini").openCount === 2);
    ok("anthropic row settles independently", approx(row("anthropic").settledUsd, 1.0));
    ok("unattributed row appears when a call skipped the provider tag",
      approx(row("unattributed").settledUsd, 0.05));
    ok("month-wide released/expired counts", res.releasedCount === 1 && res.expiredCount === 1);
    ok("bucket total is reported for the enforcement view",
      approx(res.reservedNowUsd, 1.95));
    ok("armed ceiling reports enabled with the configured budget",
      res.budget.enabled === true && res.budget.budgetUsd === 10);
    ok("clean aggregates are not flagged partial", res.partial === false);
  }

  // ── Fail-soft aggregates ──────────────────────────────────────────────────
  {
    const db = installDb();
    db._aggregateThrows = true;
    const summary = await readEnforcementSummary(db, {month});
    ok("aggregate failure degrades to zero rows instead of throwing",
      summary.providers.every((p) => p.settledUsd === 0 && p.openUsd === 0));
    ok("aggregate failure is flagged partial", summary.partial === true);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  if (ORIG_ENV.budget === undefined) delete process.env.AI_MONTHLY_BUDGET_USD;
  else process.env.AI_MONTHLY_BUDGET_USD = ORIG_ENV.budget;
  if (ORIG_ENV.mode !== undefined) process.env.AI_BUDGET_MODE = ORIG_ENV.mode;
});
