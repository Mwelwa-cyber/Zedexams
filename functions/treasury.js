/**
 * functions/treasury.js
 *
 * The AI Company Treasury — the economic model that lets the ZedExams
 * agent company pay for its own API usage.
 *
 * THE IDEA (read this first)
 * --------------------------
 * Learners and teachers pay subscriptions in ZMW (Lenco) for content and
 * tools the agents produce. Those subscriptions are the company's income.
 * The agents' only material running cost is AI API spend (Anthropic /
 * OpenAI / Gemini), which is already tracked in USD by aiCostTracking.js.
 *
 * The company is allowed to spend only a fixed REINVESTMENT FRACTION of
 * the revenue it has ACTUALLY EARNED this month on AI APIs. That ceiling
 * is the "revenue-linked budget". Because the existing budget gate in
 * aiCostTracking.js refuses new AI calls once month-to-date spend reaches
 * the ceiling, API spend is structurally bounded by income — the company
 * cannot run a deficit on its core cost. It self-funds.
 *
 *     derivedBudgetUsd = revenueUsd * reinvestRatio
 *
 * This module is PURE + dormant by design:
 *   - `computeTreasury` does no I/O, so it unit-tests directly
 *     (functions/treasury.test.js) and is mirrored on the client in
 *     src/utils/treasury.js for the /admin/company dashboard.
 *   - The env readers below describe the contract for arming the
 *     revenue-linked governor. Nothing here is wired into the live AI
 *     gate yet — see "ARMING THE GOVERNOR" at the bottom — so deploying
 *     this file changes no production behaviour until the owner opts in.
 *
 * IMPORTANT — keep the math in sync with src/utils/treasury.js (client
 * mirror), the same client/server-mirror discipline used by
 * plans.js <-> subscriptionConfig.js.
 */

// ── Defaults / assumptions ────────────────────────────────────────────────
//
// ZMW per USD is an ASSUMPTION, not a locked rate — the kwacha moves daily
// and we deliberately do not hardcode a stale pair into anything that
// charges money. It is only used to express ZMW revenue on the same USD
// axis as API spend for the treasury read-out, and is surfaced as an
// editable assumption in the dashboard. ~26 ZMW/USD is a mid-2026
// placeholder; override with AI_TREASURY_ZMW_PER_USD.
const DEFAULT_ZMW_PER_USD = 26;

// Fraction of realized revenue the company may reinvest in AI APIs. 0.30
// means: for every K100 earned, at most ~K30 (in USD terms) may be spent
// on model calls. Conservative on purpose — leaves the rest for hosting,
// payment fees, and margin. Override with AI_REVENUE_REINVEST_RATIO.
const DEFAULT_REINVEST_RATIO = 0.30;

// When the company is still pre-revenue (or revenue is tiny), a hard floor
// keeps a small amount of AI spend available so the product can bootstrap
// at all. 0 disables the floor (pure self-funding). Override with
// AI_BUDGET_FLOOR_USD.
const DEFAULT_BUDGET_FLOOR_USD = 0;

// Burn ratio at/over which the dashboard flags the month as "tight".
const TIGHT_RATIO = 0.8;

function toFiniteNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Revenue-linked spend ceiling in USD.
 *
 *   deriveBudgetFromRevenueUsd({ revenueUsd, reinvestRatio, floorUsd })
 *
 * Returns max(floor, revenue * reinvestRatio). Never negative.
 */
function deriveBudgetFromRevenueUsd({
  revenueUsd,
  reinvestRatio = DEFAULT_REINVEST_RATIO,
  floorUsd = DEFAULT_BUDGET_FLOOR_USD,
} = {}) {
  const rev = Math.max(0, toFiniteNumber(revenueUsd));
  const ratio = Math.max(0, toFiniteNumber(reinvestRatio, DEFAULT_REINVEST_RATIO));
  const floor = Math.max(0, toFiniteNumber(floorUsd));
  return Math.max(floor, rev * ratio);
}

/**
 * Pure treasury computation. All inputs are plain numbers so this is
 * trivially testable and identical on client + server.
 *
 *   computeTreasury({
 *     revenueZmw,     // month-to-date confirmed revenue, ZMW
 *     apiCostUsd,     // month-to-date AI API spend, USD
 *     zmwPerUsd,      // FX assumption (ZMW per 1 USD)
 *     reinvestRatio,  // fraction of revenue reinvestable in AI
 *     floorUsd,       // hard minimum AI budget (bootstrapping)
 *     daysElapsed,    // days elapsed in the month so far (>= 1)
 *     daysInMonth,    // total days in the month
 *   })
 *
 * Returns a rich, display-ready economics object (see keys below).
 */
function computeTreasury({
  revenueZmw = 0,
  apiCostUsd = 0,
  zmwPerUsd = DEFAULT_ZMW_PER_USD,
  reinvestRatio = DEFAULT_REINVEST_RATIO,
  floorUsd = DEFAULT_BUDGET_FLOOR_USD,
  daysElapsed = 1,
  daysInMonth = 30,
} = {}) {
  const revZmw = Math.max(0, toFiniteNumber(revenueZmw));
  const costUsd = Math.max(0, toFiniteNumber(apiCostUsd));
  const fx = Math.max(0.0001, toFiniteNumber(zmwPerUsd, DEFAULT_ZMW_PER_USD));
  const ratio = Math.max(0, toFiniteNumber(reinvestRatio, DEFAULT_REINVEST_RATIO));
  const elapsed = Math.max(1, toFiniteNumber(daysElapsed, 1));
  const monthLen = Math.max(elapsed, toFiniteNumber(daysInMonth, 30));

  const revenueUsd = revZmw / fx;
  const grossProfitUsd = revenueUsd - costUsd;
  const grossMarginPct = revenueUsd > 0 ? grossProfitUsd / revenueUsd : 0;

  // Self-funding ratio: how many times over the revenue covers the AI
  // spend. null when there is no spend yet (undefined, shown as "—"/∞).
  const selfFundingRatio = costUsd > 0 ? revenueUsd / costUsd : null;
  const sustainable = selfFundingRatio == null ? revenueUsd > 0 : selfFundingRatio >= 1;

  const derivedBudgetUsd = deriveBudgetFromRevenueUsd({
    revenueUsd, reinvestRatio: ratio, floorUsd,
  });
  const budgetHeadroomUsd = derivedBudgetUsd - costUsd;
  const budgetUsedPct = derivedBudgetUsd > 0 ? costUsd / derivedBudgetUsd : (costUsd > 0 ? Infinity : 0);

  const dailyBurnUsd = costUsd / elapsed;
  const dailyRevenueUsd = revenueUsd / elapsed;
  const projectedMonthCostUsd = dailyBurnUsd * monthLen;
  const projectedMonthRevenueUsd = dailyRevenueUsd * monthLen;
  const projectedBudgetUsd = deriveBudgetFromRevenueUsd({
    revenueUsd: projectedMonthRevenueUsd, reinvestRatio: ratio, floorUsd,
  });

  // Budget runway: at today's burn, how many more days the remaining
  // headroom under the (revenue-linked) ceiling can sustain. 0 if the
  // ceiling is already reached; Infinity if nothing is being spent.
  let runwayDays;
  if (dailyBurnUsd <= 0) runwayDays = Infinity;
  else if (budgetHeadroomUsd <= 0) runwayDays = 0;
  else runwayDays = budgetHeadroomUsd / dailyBurnUsd;

  // Status: a single word the dashboard can colour on.
  let status;
  if (revenueUsd <= 0 && costUsd <= 0) status = 'idle';
  else if (revenueUsd <= 0) status = 'bootstrapping';
  else if (budgetUsedPct >= 1) status = 'over';
  else if (budgetUsedPct >= TIGHT_RATIO) status = 'tight';
  else status = 'healthy';

  return {
    // inputs (echoed for display)
    revenueZmw: revZmw,
    apiCostUsd: costUsd,
    zmwPerUsd: fx,
    reinvestRatio: ratio,
    daysElapsed: elapsed,
    daysInMonth: monthLen,
    // core economics
    revenueUsd,
    grossProfitUsd,
    grossMarginPct,
    selfFundingRatio,
    sustainable,
    // the revenue-linked governor
    derivedBudgetUsd,
    budgetHeadroomUsd,
    budgetUsedPct,
    overBudget: budgetUsedPct >= 1,
    // run-rate + projections
    dailyBurnUsd,
    dailyRevenueUsd,
    projectedMonthCostUsd,
    projectedMonthRevenueUsd,
    projectedBudgetUsd,
    runwayDays,
    status,
  };
}

// ── Env contract for arming the revenue-linked governor ───────────────────
//
// All off / defaulted unless the owner sets them on the Cloud Functions
// runtime. These describe HOW to switch the static AI_MONTHLY_BUDGET_USD
// ceiling over to a revenue-linked one — see "ARMING THE GOVERNOR" below.

/** 'revenue_linked' arms the self-funding ceiling; anything else = static. */
function getBudgetMode() {
  const raw = String(process.env.AI_BUDGET_MODE || '').trim().toLowerCase();
  return raw === 'revenue_linked' ? 'revenue_linked' : 'static';
}

/** Reinvestment fraction (clamped to a sane 0–1), default 0.30. */
function getReinvestRatio() {
  const raw = Number(process.env.AI_REVENUE_REINVEST_RATIO);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_REINVEST_RATIO;
  return Math.min(1, raw);
}

/** FX assumption (ZMW per USD), default 26. */
function getZmwPerUsd() {
  const raw = Number(process.env.AI_TREASURY_ZMW_PER_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ZMW_PER_USD;
}

/** Hard floor budget in USD for the pre-revenue bootstrap, default 0. */
function getBudgetFloorUsd() {
  const raw = Number(process.env.AI_BUDGET_FLOOR_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_FLOOR_USD;
}

// ── ARMING THE GOVERNOR ────────────────────────────────────────────────────
//
// WIRED. aiCostTracking.getBudgetStatus() branches on getBudgetMode():
// 'static' (default) keeps the fixed AI_MONTHLY_BUDGET_USD ceiling, while
// 'revenue_linked' reads month-to-date revenue and uses
// deriveBudgetFromRevenueUsd({ revenueUsd, reinvestRatio: getReinvestRatio(),
// floorUsd: getBudgetFloorUsd() }) as the ceiling. Everything downstream
// (overBudget gate, 80% warning, daily summary) is unchanged — only the
// SOURCE of the ceiling moves. Both paths fail OPEN, and a $0 derived ceiling
// (no revenue, no floor) falls back to the static budget so arming this can
// never brick AI. See functions/aiBudgetRevenueLinked.test.js.
//
// To switch it on, set on the Cloud Functions runtime:
//     AI_BUDGET_MODE=revenue_linked
//     AI_REVENUE_REINVEST_RATIO=0.30   (optional; default 0.30)
//     AI_TREASURY_ZMW_PER_USD=26       (optional; default 26)
//     AI_BUDGET_FLOOR_USD=10           (optional; bootstrap floor, default 0)
// Leaving AI_BUDGET_MODE unset keeps today's static behaviour.

module.exports = {
  DEFAULT_ZMW_PER_USD,
  DEFAULT_REINVEST_RATIO,
  DEFAULT_BUDGET_FLOOR_USD,
  TIGHT_RATIO,
  deriveBudgetFromRevenueUsd,
  computeTreasury,
  getBudgetMode,
  getReinvestRatio,
  getZmwPerUsd,
  getBudgetFloorUsd,
};
