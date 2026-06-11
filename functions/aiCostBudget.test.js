/**
 * Node test for the monthly AI spend ceiling (the "auto-pause" guardrail
 * in aiCostTracking.js). Run: node functions/aiCostBudget.test.js
 *
 * Covers:
 *   - evaluateBudget pure logic (disabled / under / warn / over / boundary)
 *   - getMonthlyBudgetUsd env parsing (unset, valid, zero, negative, junk)
 *   - monthKeyUtc shape
 *   - getBudgetStatus + getMonthToDateCostUsd against a stubbed Firestore,
 *     including the fail-OPEN behaviour on a read error (a budget glitch
 *     must never block a legitimate AI call).
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

const {
  evaluateBudget,
  getMonthlyBudgetUsd,
  getMonthToDateCostUsd,
  getBudgetStatus,
  monthKeyUtc,
  BUDGET_WARN_RATIO,
  _resetBudgetCache,
} = require("./aiCostTracking");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Stub admin.firestore() so getMonthToDateCostUsd can be driven without
// a real Firestore. firebase-admin exposes `firestore` as a non-writable
// namespace getter, so a plain assignment is ignored — defineProperty
// is required to override it. `behaviour` is the async get() impl.
function stubFirestore(behaviour) {
  Object.defineProperty(admin, "firestore", {
    configurable: true,
    value: () => ({collection: () => ({doc: () => ({get: behaviour})})}),
  });
}

function docGet(totalCostUsd) {
  return async () => ({exists: true, data: () => ({totalCostUsd})});
}

console.log("aiCostBudget");

// ── evaluateBudget: disabled when no ceiling ──────────────────────────────
{
  const s = evaluateBudget({monthCostUsd: 999, budgetUsd: 0});
  ok("budget 0 → disabled", s.enabled === false);
  ok("disabled → never overBudget", s.overBudget === false);
  ok("disabled → never warning", s.warning === false);
}
ok("negative budget → disabled",
  evaluateBudget({monthCostUsd: 10, budgetUsd: -5}).enabled === false);

// ── evaluateBudget: under / warn / over ───────────────────────────────────
{
  const under = evaluateBudget({monthCostUsd: 10, budgetUsd: 100});
  ok("well under → enabled, not over, not warning",
    under.enabled && !under.overBudget && !under.warning);

  const warn = evaluateBudget({monthCostUsd: 85, budgetUsd: 100});
  ok("85% → warning, not over", warn.warning === true && warn.overBudget === false);

  const justUnderWarn = evaluateBudget({monthCostUsd: 79, budgetUsd: 100});
  ok("79% (below warn ratio) → not warning",
    justUnderWarn.warning === false && BUDGET_WARN_RATIO === 0.8);

  const over = evaluateBudget({monthCostUsd: 140, budgetUsd: 100});
  ok("over ceiling → overBudget true", over.overBudget === true);
  ok("over ceiling → warning false (it's past warning)", over.warning === false);
}

// ── boundary: cost exactly equal to ceiling counts as over (>=) ───────────
{
  const exact = evaluateBudget({monthCostUsd: 100, budgetUsd: 100});
  ok("cost == ceiling → overBudget (>=)", exact.overBudget === true);
}

// ── getMonthlyBudgetUsd env parsing ───────────────────────────────────────
const ORIG = process.env.AI_MONTHLY_BUDGET_USD;
delete process.env.AI_MONTHLY_BUDGET_USD;
ok("unset env → 0 (disabled)", getMonthlyBudgetUsd() === 0);
process.env.AI_MONTHLY_BUDGET_USD = "25";
ok("'25' → 25", getMonthlyBudgetUsd() === 25);
process.env.AI_MONTHLY_BUDGET_USD = "0";
ok("'0' → 0 (disabled)", getMonthlyBudgetUsd() === 0);
process.env.AI_MONTHLY_BUDGET_USD = "-5";
ok("'-5' → 0 (disabled)", getMonthlyBudgetUsd() === 0);
process.env.AI_MONTHLY_BUDGET_USD = "not-a-number";
ok("junk → 0 (disabled)", getMonthlyBudgetUsd() === 0);

// ── monthKeyUtc shape ─────────────────────────────────────────────────────
ok("monthKeyUtc is YYYY-MM", /^\d{4}-\d{2}$/.test(monthKeyUtc()));

// ── getBudgetStatus / getMonthToDateCostUsd against stubbed Firestore ─────
(async () => {
  // Disabled: no env → status.enabled false, and we never touch Firestore.
  delete process.env.AI_MONTHLY_BUDGET_USD;
  stubFirestore(async () => {
    throw new Error("Firestore must not be read when budget is disabled");
  });
  _resetBudgetCache();
  const disabled = await getBudgetStatus();
  ok("disabled budget → getBudgetStatus enabled false", disabled.enabled === false);

  // Under ceiling.
  process.env.AI_MONTHLY_BUDGET_USD = "100";
  stubFirestore(docGet(40));
  _resetBudgetCache();
  const under = await getBudgetStatus();
  ok("month spend 40 / 100 → not over", under.overBudget === false);

  // Over ceiling → the gate would refuse.
  stubFirestore(docGet(120));
  _resetBudgetCache();
  const over = await getBudgetStatus();
  ok("month spend 120 / 100 → over", over.overBudget === true);

  // Fail OPEN: a Firestore read error must report 0 spend (call allowed).
  stubFirestore(async () => {
    throw new Error("transient firestore error");
  });
  _resetBudgetCache();
  const failed = await getMonthToDateCostUsd();
  ok("read error → month cost 0 (fail open)", failed === 0);
  _resetBudgetCache();
  const failOpenStatus = await getBudgetStatus();
  ok("read error → getBudgetStatus not over (fail open)",
    failOpenStatus.overBudget === false);

  // Restore env for cleanliness.
  if (ORIG === undefined) delete process.env.AI_MONTHLY_BUDGET_USD;
  else process.env.AI_MONTHLY_BUDGET_USD = ORIG;

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
