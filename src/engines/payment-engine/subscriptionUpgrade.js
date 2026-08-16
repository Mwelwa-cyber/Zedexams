// Prorated tier-upgrade pricing (Pro → Max), client copy.
//
// Models an upgrade the way Claude (and most SaaS) does it: when you step up
// to a higher tier mid-subscription you do NOT start a fresh period and you
// are NOT charged the full price of the new plan. Instead you keep your
// existing renewal date and pay only the *difference* in daily rate for the
// days you have left. Nothing is "added" to your expiry.
//
// The maths is intentionally tiny and side-effect free so the server can run
// the exact same calculation (see functions/subscriptionUpgrade.js — keep the
// two in sync). The server is authoritative for the amount actually charged;
// this copy only drives what the modal *shows*.

import { PLANS } from './subscriptionConfig'

const DAY = 24 * 60 * 60 * 1000

// Lenco rejects zero/near-zero collections, so an upgrade that prorates down
// to almost nothing still charges this floor.
export const MIN_UPGRADE_ZMW = 1

function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Price per day for a plan, e.g. Pro · Monthly = 59/30 ≈ 1.97.
export function dailyRate(plan) {
  const price = Number(plan?.priceZMW || 0)
  const days = Number(plan?.durationDays || 0)
  return days > 0 ? price / days : 0
}

// Only a *same-billing-period* Pro → Max step is a prorated "upgrade": pay the
// daily-rate difference for the days you have left and keep your renewal date.
// Same-tier repurchases (renewals), down-grades, and learner packs fall through
// to the normal stack-the-days purchase path.
//
// The same-period guard is load-bearing. Proration keeps your existing renewal
// date and adds NO days, which is only coherent when the target bills on the
// same cadence you're already on (monthly→monthly, yearly→yearly). Applying it
// across cadences (Pro Monthly → Max Yearly) is nonsense: the annual plan's
// lower daily rate makes the prorated fee come out *below* the monthly upgrade,
// and "yearly" would grant only the days left on your monthly cycle. A change
// of cadence is a plan change, not a tier bump — it falls through to full-price
// checkout, which starts a fresh term.
export function isUpgradePath(fromPlanId, toPlanId) {
  const from = PLANS[fromPlanId]
  const to = PLANS[toPlanId]
  return (
    from?.tier === 'pro' &&
    to?.tier === 'max' &&
    Number(from.durationDays) === Number(to.durationDays)
  )
}

/**
 * Quote a tier upgrade.
 *
 * @param {object} args
 * @param {object} args.fromPlan  current plan ({ priceZMW, durationDays })
 * @param {object} args.toPlan    target plan
 * @param {*}      args.expiry    current subscription expiry (Date | Timestamp | iso)
 * @param {Date}   [args.now]
 * @returns {{ isUpgrade:boolean, daysRemaining:number, amountZMW:number,
 *            perDayDiff:number, expiry:Date|null }}
 */
export function computeUpgradeQuote({ fromPlan, toPlan, expiry, now = new Date() }) {
  const exp = toDate(expiry)
  const daysRemaining = exp
    ? Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / DAY))
    : 0
  const perDayDiff = Math.max(0, dailyRate(toPlan) - dailyRate(fromPlan))
  const isUpgrade = daysRemaining > 0 && perDayDiff > 0
  const amountZMW = isUpgrade ? Math.max(MIN_UPGRADE_ZMW, Math.round(perDayDiff * daysRemaining)) : 0
  return { isUpgrade, daysRemaining, amountZMW, perDayDiff, expiry: exp }
}

// The user's live tier, tolerant of the pre-2026-06 legacy teacherPlan ids
// (individual→pro, school→max). Returns 'pro' | 'max' | null.
export function currentTier(userProfile) {
  const tp = userProfile?.teacherPlan
  if (tp === 'max' || tp === 'school') return 'max'
  if (tp === 'pro' || tp === 'individual') return 'pro'
  return PLANS[userProfile?.subscriptionPlan]?.tier ?? null
}

// The exact Pro plan a teacher currently pays for, so we prorate against the
// right daily rate. subscriptionPlan holds the concrete id (pro_monthly /
// pro_yearly); fall back to pro_monthly if it's an older/unknown value.
export function resolveCurrentProPlanId(userProfile) {
  const id = userProfile?.subscriptionPlan
  if (PLANS[id]?.tier === 'pro') return id
  return 'pro_monthly'
}

/**
 * Quote an upgrade straight from a user profile + the target plan id. Returns
 * { isUpgrade:false } whenever the move isn't a live Pro→Max step (free/expired
 * teacher, already on Max, learner, unknown plan) so callers can fall back to
 * full-price checkout.
 */
export function getUpgradeQuoteForProfile(userProfile, toPlanId, now = new Date()) {
  const fromPlanId = resolveCurrentProPlanId(userProfile)
  const fromPlan = PLANS[fromPlanId]
  const toPlan = PLANS[toPlanId]
  const noop = { isUpgrade: false, daysRemaining: 0, amountZMW: 0, perDayDiff: 0, expiry: null, fromPlanId, toPlanId }
  // Guard on the user's ACTUAL tier first — a Max user must never be treated
  // as Pro by the pro_monthly fallback above.
  if (currentTier(userProfile) !== 'pro') return noop
  // isUpgradePath enforces Pro→Max AND same billing period, so a cross-cadence
  // move (Pro Monthly → Max Yearly) returns the full-price no-op here.
  if (!fromPlan || !toPlan || !isUpgradePath(fromPlanId, toPlanId)) return noop
  // Teachers gate on teacherPlanExpiresAt; fall back to the premium expiry.
  const expiry = userProfile?.teacherPlanExpiresAt ?? userProfile?.subscriptionExpiry
  return { ...computeUpgradeQuote({ fromPlan, toPlan, expiry, now }), fromPlanId, toPlanId }
}
