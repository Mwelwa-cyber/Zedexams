/**
 * Node test for the AI Company Treasury economic model (treasury.js).
 * Run: node functions/treasury.test.js
 *
 * Covers:
 *   - deriveBudgetFromRevenueUsd (floor, ratio, negative guards)
 *   - computeTreasury against a fixed canonical fixture (the SAME fixture
 *     the client mirror's vitest spec asserts, so the two can't drift)
 *   - status transitions (idle / bootstrapping / healthy / tight / over)
 *   - self-funding ratio + sustainability edge cases (zero spend, zero rev)
 *   - env readers (mode / ratio / fx / floor parsing)
 */

const assert = require("node:assert");

const {
  deriveBudgetFromRevenueUsd,
  computeTreasury,
  getBudgetMode,
  getReinvestRatio,
  getZmwPerUsd,
  getBudgetFloorUsd,
  DEFAULT_REINVEST_RATIO,
  DEFAULT_ZMW_PER_USD,
} = require("./treasury");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
function near(name, actual, expected, eps = 0.01) {
  ok(`${name} (${actual} ≈ ${expected})`, Math.abs(actual - expected) <= eps);
}

console.log("treasury");

// ── deriveBudgetFromRevenueUsd ────────────────────────────────────────────
near("budget = revenue × ratio",
  deriveBudgetFromRevenueUsd({ revenueUsd: 1000, reinvestRatio: 0.3 }), 300);
ok("floor wins when revenue is tiny",
  deriveBudgetFromRevenueUsd({ revenueUsd: 10, reinvestRatio: 0.3, floorUsd: 50 }) === 50);
ok("negative revenue → 0 (no floor)",
  deriveBudgetFromRevenueUsd({ revenueUsd: -100, reinvestRatio: 0.3 }) === 0);
near("defaults to 30% ratio",
  deriveBudgetFromRevenueUsd({ revenueUsd: 1000 }), 1000 * DEFAULT_REINVEST_RATIO);

// ── Canonical fixture (mirrored in src/utils/treasury.spec.js) ────────────
// revenueZmw 20000 @ 26 ZMW/USD = 769.23 USD; cost 180 USD; 10/30 days.
const T = computeTreasury({
  revenueZmw: 20000,
  apiCostUsd: 180,
  zmwPerUsd: 26,
  reinvestRatio: 0.3,
  daysElapsed: 10,
  daysInMonth: 30,
});
near("revenueUsd", T.revenueUsd, 769.23, 0.01);
near("grossProfitUsd", T.grossProfitUsd, 589.23, 0.01);
near("grossMarginPct", T.grossMarginPct, 0.766, 0.001);
near("selfFundingRatio", T.selfFundingRatio, 4.273, 0.01);
near("derivedBudgetUsd", T.derivedBudgetUsd, 230.77, 0.01);
near("budgetHeadroomUsd", T.budgetHeadroomUsd, 50.77, 0.01);
near("budgetUsedPct", T.budgetUsedPct, 0.78, 0.01);
near("dailyBurnUsd", T.dailyBurnUsd, 18, 0.001);
near("projectedMonthCostUsd", T.projectedMonthCostUsd, 540, 0.001);
near("projectedMonthRevenueUsd", T.projectedMonthRevenueUsd, 2307.69, 0.5);
near("runwayDays", T.runwayDays, 2.82, 0.05);
ok("fixture status = healthy (78% of ceiling)", T.status === "healthy");
ok("fixture is sustainable (ratio ≥ 1)", T.sustainable === true);
ok("fixture not over budget", T.overBudget === false);

// ── status transitions ────────────────────────────────────────────────────
ok("no revenue, no cost → idle",
  computeTreasury({ revenueZmw: 0, apiCostUsd: 0 }).status === "idle");
ok("spend before any revenue → bootstrapping",
  computeTreasury({ revenueZmw: 0, apiCostUsd: 5 }).status === "bootstrapping");
{
  // Push cost above 80% but below 100% of the ceiling → tight.
  // revenue 1000 USD → ceiling 300; cost 260 → 86.7% → tight.
  const tight = computeTreasury({ revenueZmw: 26000, apiCostUsd: 260, zmwPerUsd: 26, reinvestRatio: 0.3 });
  ok("86.7% of ceiling → tight", tight.status === "tight");
  // cost 320 > ceiling 300 → over, governor would pause.
  const over = computeTreasury({ revenueZmw: 26000, apiCostUsd: 320, zmwPerUsd: 26, reinvestRatio: 0.3 });
  ok("over ceiling → over", over.status === "over" && over.overBudget === true);
}

// ── self-funding ratio + sustainability edges ─────────────────────────────
{
  const noSpend = computeTreasury({ revenueZmw: 26000, apiCostUsd: 0, zmwPerUsd: 26 });
  ok("zero spend → selfFundingRatio null", noSpend.selfFundingRatio === null);
  ok("zero spend with revenue → sustainable", noSpend.sustainable === true);
  ok("zero spend → runway Infinity", noSpend.runwayDays === Infinity);

  const underwater = computeTreasury({ revenueZmw: 2600, apiCostUsd: 500, zmwPerUsd: 26, reinvestRatio: 0.3 });
  // revenue 100 USD, cost 500 → ratio 0.2 → not sustainable, over budget.
  near("underwater ratio", underwater.selfFundingRatio, 0.2, 0.001);
  ok("underwater → not sustainable", underwater.sustainable === false);
  ok("underwater → over budget", underwater.overBudget === true);
}

// ── env readers ────────────────────────────────────────────────────────────
const SAVED = {
  mode: process.env.AI_BUDGET_MODE,
  ratio: process.env.AI_REVENUE_REINVEST_RATIO,
  fx: process.env.AI_TREASURY_ZMW_PER_USD,
  floor: process.env.AI_BUDGET_FLOOR_USD,
};

delete process.env.AI_BUDGET_MODE;
ok("unset mode → static", getBudgetMode() === "static");
process.env.AI_BUDGET_MODE = "revenue_linked";
ok("'revenue_linked' → revenue_linked", getBudgetMode() === "revenue_linked");
process.env.AI_BUDGET_MODE = "REVENUE_LINKED";
ok("case-insensitive mode", getBudgetMode() === "revenue_linked");

delete process.env.AI_REVENUE_REINVEST_RATIO;
ok("unset ratio → default", getReinvestRatio() === DEFAULT_REINVEST_RATIO);
process.env.AI_REVENUE_REINVEST_RATIO = "0.5";
ok("'0.5' → 0.5", getReinvestRatio() === 0.5);
process.env.AI_REVENUE_REINVEST_RATIO = "2";
ok("ratio clamps to 1", getReinvestRatio() === 1);
process.env.AI_REVENUE_REINVEST_RATIO = "-1";
ok("negative ratio → default", getReinvestRatio() === DEFAULT_REINVEST_RATIO);

delete process.env.AI_TREASURY_ZMW_PER_USD;
ok("unset fx → default", getZmwPerUsd() === DEFAULT_ZMW_PER_USD);
process.env.AI_TREASURY_ZMW_PER_USD = "27.5";
ok("'27.5' → 27.5", getZmwPerUsd() === 27.5);
process.env.AI_TREASURY_ZMW_PER_USD = "junk";
ok("junk fx → default", getZmwPerUsd() === DEFAULT_ZMW_PER_USD);

delete process.env.AI_BUDGET_FLOOR_USD;
ok("unset floor → 0", getBudgetFloorUsd() === 0);
process.env.AI_BUDGET_FLOOR_USD = "25";
ok("'25' → 25", getBudgetFloorUsd() === 25);

// restore env
for (const [k, v] of Object.entries({
  AI_BUDGET_MODE: SAVED.mode,
  AI_REVENUE_REINVEST_RATIO: SAVED.ratio,
  AI_TREASURY_ZMW_PER_USD: SAVED.fx,
  AI_BUDGET_FLOOR_USD: SAVED.floor,
})) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

console.log(`\n─── ${passed} assertions · all passed ───`);
