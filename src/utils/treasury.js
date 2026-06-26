/**
 * src/utils/treasury.js
 *
 * Client mirror of the AI Company Treasury economic model. The
 * /admin/company dashboard ("AI Company HQ") uses this to turn
 * month-to-date ZMW revenue + USD API spend into the self-funding
 * read-out: revenue vs spend, self-funding ratio, the revenue-linked
 * budget ceiling, headroom, and runway.
 *
 * IMPORTANT — keep the math identical to functions/treasury.js (the
 * authoritative, node-tested copy). The same client/server-mirror
 * discipline as subscriptionConfig.js <-> plans.js. The canonical fixture
 * in treasury.spec.js asserts the SAME numbers as the node test so the
 * two copies cannot silently drift.
 *
 * See ORG.md → "Treasury & Self-Funding" for the model in prose.
 */

export const DEFAULT_ZMW_PER_USD = 26
export const DEFAULT_REINVEST_RATIO = 0.30
export const DEFAULT_BUDGET_FLOOR_USD = 0
export const TIGHT_RATIO = 0.8

function toFiniteNumber(n, fallback = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

/** Revenue-linked spend ceiling in USD: max(floor, revenue × ratio). */
export function deriveBudgetFromRevenueUsd({
  revenueUsd,
  reinvestRatio = DEFAULT_REINVEST_RATIO,
  floorUsd = DEFAULT_BUDGET_FLOOR_USD,
} = {}) {
  const rev = Math.max(0, toFiniteNumber(revenueUsd))
  const ratio = Math.max(0, toFiniteNumber(reinvestRatio, DEFAULT_REINVEST_RATIO))
  const floor = Math.max(0, toFiniteNumber(floorUsd))
  return Math.max(floor, rev * ratio)
}

/**
 * Pure treasury computation (mirror of functions/treasury.js
 * computeTreasury). See that file for the full doc.
 */
export function computeTreasury({
  revenueZmw = 0,
  apiCostUsd = 0,
  zmwPerUsd = DEFAULT_ZMW_PER_USD,
  reinvestRatio = DEFAULT_REINVEST_RATIO,
  floorUsd = DEFAULT_BUDGET_FLOOR_USD,
  daysElapsed = 1,
  daysInMonth = 30,
} = {}) {
  const revZmw = Math.max(0, toFiniteNumber(revenueZmw))
  const costUsd = Math.max(0, toFiniteNumber(apiCostUsd))
  const fx = Math.max(0.0001, toFiniteNumber(zmwPerUsd, DEFAULT_ZMW_PER_USD))
  const ratio = Math.max(0, toFiniteNumber(reinvestRatio, DEFAULT_REINVEST_RATIO))
  const elapsed = Math.max(1, toFiniteNumber(daysElapsed, 1))
  const monthLen = Math.max(elapsed, toFiniteNumber(daysInMonth, 30))

  const revenueUsd = revZmw / fx
  const grossProfitUsd = revenueUsd - costUsd
  const grossMarginPct = revenueUsd > 0 ? grossProfitUsd / revenueUsd : 0

  const selfFundingRatio = costUsd > 0 ? revenueUsd / costUsd : null
  const sustainable = selfFundingRatio == null ? revenueUsd > 0 : selfFundingRatio >= 1

  const derivedBudgetUsd = deriveBudgetFromRevenueUsd({ revenueUsd, reinvestRatio: ratio, floorUsd })
  const budgetHeadroomUsd = derivedBudgetUsd - costUsd
  const budgetUsedPct = derivedBudgetUsd > 0 ? costUsd / derivedBudgetUsd : (costUsd > 0 ? Infinity : 0)

  const dailyBurnUsd = costUsd / elapsed
  const dailyRevenueUsd = revenueUsd / elapsed
  const projectedMonthCostUsd = dailyBurnUsd * monthLen
  const projectedMonthRevenueUsd = dailyRevenueUsd * monthLen
  const projectedBudgetUsd = deriveBudgetFromRevenueUsd({
    revenueUsd: projectedMonthRevenueUsd, reinvestRatio: ratio, floorUsd,
  })

  let runwayDays
  if (dailyBurnUsd <= 0) runwayDays = Infinity
  else if (budgetHeadroomUsd <= 0) runwayDays = 0
  else runwayDays = budgetHeadroomUsd / dailyBurnUsd

  let status
  if (revenueUsd <= 0 && costUsd <= 0) status = 'idle'
  else if (revenueUsd <= 0) status = 'bootstrapping'
  else if (budgetUsedPct >= 1) status = 'over'
  else if (budgetUsedPct >= TIGHT_RATIO) status = 'tight'
  else status = 'healthy'

  return {
    revenueZmw: revZmw,
    apiCostUsd: costUsd,
    zmwPerUsd: fx,
    reinvestRatio: ratio,
    daysElapsed: elapsed,
    daysInMonth: monthLen,
    revenueUsd,
    grossProfitUsd,
    grossMarginPct,
    selfFundingRatio,
    sustainable,
    derivedBudgetUsd,
    budgetHeadroomUsd,
    budgetUsedPct,
    overBudget: budgetUsedPct >= 1,
    dailyBurnUsd,
    dailyRevenueUsd,
    projectedMonthCostUsd,
    projectedMonthRevenueUsd,
    projectedBudgetUsd,
    runwayDays,
    status,
  }
}

/** Days elapsed + length of the CURRENT calendar month (local time). */
export function monthProgress(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysElapsed = now.getDate()
  return { daysElapsed, daysInMonth }
}

/** 'YYYY-MM' key for the current month (UTC) — matches aiUsage doc ids. */
export function currentMonthKey(now = new Date()) {
  return now.toISOString().slice(0, 7)
}

// ── Display helpers ───────────────────────────────────────────────────────

export function fmtUsd(n, digits = 2) {
  if (!Number.isFinite(n)) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtZmw(n) {
  if (!Number.isFinite(n)) return '—'
  return `K${Math.round(n).toLocaleString('en-ZM')}`
}

export function fmtPct(ratio, digits = 0) {
  if (!Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

export function fmtRatio(r) {
  if (r == null) return '∞'
  if (!Number.isFinite(r)) return '∞'
  return `${r.toFixed(1)}×`
}

export function fmtRunway(days) {
  if (!Number.isFinite(days)) return 'unbounded'
  if (days <= 0) return '0 days'
  if (days >= 1) return `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`
  return `${Math.round(days * 24)} hrs`
}

// ── Preview seed data ─────────────────────────────────────────────────────
//
// Realistic mid-2026 numbers for a growing Zambian CBC platform, so the
// dashboard renders fully populated before any live data exists. Marked
// "Preview" in the UI and never persisted.

export function seedTreasuryInputs(now = new Date()) {
  const { daysElapsed, daysInMonth } = monthProgress(now)
  // ~232 active subscriptions @ a ~K79 blended price, accrued pro-rata to
  // the day of month; AI spend scaled to land the company comfortably
  // self-funding (ratio ~3–4×, budget ~75% used).
  const monthlyRevenueZmw = 18400
  const monthlyApiCostUsd = 196
  const revenueZmw = Math.round((monthlyRevenueZmw * daysElapsed) / daysInMonth)
  const apiCostUsd = Number(((monthlyApiCostUsd * daysElapsed) / daysInMonth).toFixed(2))
  return {
    revenueZmw,
    apiCostUsd,
    zmwPerUsd: DEFAULT_ZMW_PER_USD,
    reinvestRatio: DEFAULT_REINVEST_RATIO,
    daysElapsed,
    daysInMonth,
  }
}
