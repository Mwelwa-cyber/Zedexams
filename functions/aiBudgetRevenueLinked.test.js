/**
 * Node test for the revenue-linked budget governor (the self-funding
 * ceiling) wired into aiCostTracking.getBudgetStatus().
 * Run: node functions/aiBudgetRevenueLinked.test.js
 *
 * Covers:
 *   - static mode (default) is unchanged and never reads payments
 *   - revenue_linked derives budget = monthRevenueUsd × reinvestRatio
 *     (under / over the derived ceiling)
 *   - the FLOOR keeps a pre-revenue project from a $0 ceiling
 *   - fail-open: revenue read error degrades to the static ceiling
 *     (or "disabled = allow" when no static ceiling is set)
 *   - no-brick: revenue 0 + floor 0 + no static budget → allow
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

const {
  getBudgetStatus,
  getMonthToDateRevenueUsd,
  _resetBudgetCache,
} = require("./aiCostTracking");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Stub admin.firestore() so BOTH reads in the revenue_linked path work:
//   payments:        .collection('payments').where().where().get()
//   cost rollup:     .collection('aiUsageMonthly').doc().get()
// Also attaches a no-op Timestamp.fromDate the revenue reader needs.
function stubFirestore({revenueZmw = [], costUsd = 0, revenueThrows = false, costThrows = false} = {}) {
  const fsFn = () => ({
    collection: (name) => {
      if (name === "payments") {
        const get = async () => {
          if (revenueThrows) throw new Error("payments read failed");
          return {forEach: (cb) => revenueZmw.forEach((amt) => cb({data: () => ({amountZMW: amt})}))};
        };
        return {where: () => ({where: () => ({get})})};
      }
      return {doc: () => ({
        get: async () => {
          if (costThrows) throw new Error("cost read failed");
          return {exists: true, data: () => ({totalCostUsd: costUsd})};
        },
        // Sharded reader also sums the (here empty) shard subcollection.
        collection: () => ({get: async () => {
          if (costThrows) throw new Error("cost read failed");
          return {forEach: () => {}};
        }})})};
    },
  });
  fsFn.Timestamp = {fromDate: (d) => d};
  Object.defineProperty(admin, "firestore", {configurable: true, value: fsFn});
}

const SAVED = {
  mode: process.env.AI_BUDGET_MODE,
  ratio: process.env.AI_REVENUE_REINVEST_RATIO,
  fx: process.env.AI_TREASURY_ZMW_PER_USD,
  floor: process.env.AI_BUDGET_FLOOR_USD,
  staticBudget: process.env.AI_MONTHLY_BUDGET_USD,
};
function setEnv(env) {
  for (const k of ["AI_BUDGET_MODE", "AI_REVENUE_REINVEST_RATIO", "AI_TREASURY_ZMW_PER_USD", "AI_BUDGET_FLOOR_USD", "AI_MONTHLY_BUDGET_USD"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
}

console.log("aiBudgetRevenueLinked");

(async () => {
  // ── static mode is unchanged and must NOT read payments ──────────────────
  setEnv({AI_MONTHLY_BUDGET_USD: "100"}); // mode unset → static
  stubFirestore({costUsd: 40, revenueThrows: true});
  _resetBudgetCache();
  const stat = await getBudgetStatus();
  ok("static: 40/100 not over", stat.overBudget === false && stat.mode === "static");
  stubFirestore({costUsd: 120, revenueThrows: true});
  _resetBudgetCache();
  ok("static: 120/100 over (payments untouched)", (await getBudgetStatus()).overBudget === true);

  // ── revenue_linked: budget = revenueUsd × ratio ──────────────────────────
  // 18,400 ZMW @ 26 = 707.69 USD; × 0.30 = 212.31 ceiling.
  setEnv({AI_BUDGET_MODE: "revenue_linked"}); // ratio default .3, fx default 26
  stubFirestore({revenueZmw: [10000, 8400], costUsd: 100});
  _resetBudgetCache();
  const rl = await getBudgetStatus();
  ok("revenue_linked mode reported", rl.mode === "revenue_linked");
  ok("derived ceiling ≈ 212", Math.abs(rl.derivedBudgetUsd - 212.31) < 0.5);
  ok("100 < 212 → not over", rl.overBudget === false);

  stubFirestore({revenueZmw: [18400], costUsd: 250});
  _resetBudgetCache();
  ok("250 > 212 → over (governor pauses)", (await getBudgetStatus()).overBudget === true);

  // ── revenue reader direct check ──────────────────────────────────────────
  stubFirestore({revenueZmw: [2600]});
  _resetBudgetCache();
  ok("getMonthToDateRevenueUsd: 2600 ZMW @26 = 100 USD",
    Math.abs((await getMonthToDateRevenueUsd()) - 100) < 0.001);

  // ── FLOOR protects the pre-revenue bootstrap ─────────────────────────────
  setEnv({AI_BUDGET_MODE: "revenue_linked", AI_BUDGET_FLOOR_USD: "25"});
  stubFirestore({revenueZmw: [], costUsd: 30}); // no revenue → ceiling = floor 25
  _resetBudgetCache();
  const floored = await getBudgetStatus();
  ok("floor: cost 30 ≥ 25 → over", floored.overBudget === true && floored.derivedBudgetUsd === 25);
  stubFirestore({revenueZmw: [], costUsd: 10});
  _resetBudgetCache();
  ok("floor: cost 10 < 25 → not over", (await getBudgetStatus()).overBudget === false);

  // ── no-brick: revenue 0 + floor 0 + no static → allow ────────────────────
  setEnv({AI_BUDGET_MODE: "revenue_linked"});
  stubFirestore({revenueZmw: [], costUsd: 999});
  _resetBudgetCache();
  const noBrick = await getBudgetStatus();
  ok("no revenue, no floor, no static → not over (no brick)", noBrick.overBudget === false);

  // ── fail-open: revenue read error degrades to static ceiling ─────────────
  setEnv({AI_BUDGET_MODE: "revenue_linked", AI_MONTHLY_BUDGET_USD: "100"});
  stubFirestore({revenueThrows: true, costUsd: 40});
  _resetBudgetCache();
  const degraded = await getBudgetStatus();
  ok("revenue error + static 100, cost 40 → not over (degraded)",
    degraded.overBudget === false && degraded.degraded === true);
  stubFirestore({revenueThrows: true, costUsd: 150});
  _resetBudgetCache();
  ok("revenue error + static 100, cost 150 → over", (await getBudgetStatus()).overBudget === true);

  // ── fail-open: revenue read error + no static → allow ────────────────────
  setEnv({AI_BUDGET_MODE: "revenue_linked"});
  stubFirestore({revenueThrows: true, costUsd: 999});
  _resetBudgetCache();
  ok("revenue error + no static → not over (fail open)", (await getBudgetStatus()).overBudget === false);

  setEnv(SAVED);
  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
