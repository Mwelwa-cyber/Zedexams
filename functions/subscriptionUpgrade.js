/**
 * functions/subscriptionUpgrade.js
 *
 * Server-authoritative prorated tier-upgrade pricing (Pro → Max).
 *
 * Mirror of src/engines/payment-engine/subscriptionUpgrade.js — keep the maths identical. When
 * a teacher steps up from Pro to Max mid-subscription we charge ONLY the
 * difference in daily rate for the days they have left, and we DO NOT extend
 * their renewal date (same model as Claude). The client copy drives what the
 * modal shows; THIS copy is the source of truth for the amount actually
 * charged and is recomputed in initiateLencoPayment — a client can pick a
 * target plan but never dictate the prorated price.
 *
 * Dependency-light on purpose (require('./plans') only) so the repo-root node
 * test suite can import it without firebase-admin — same pattern as plans.js.
 */

const {getPlan} = require("./plans");

const DAY = 24 * 60 * 60 * 1000;

// Lenco rejects zero/near-zero collections, so an upgrade that prorates down
// to almost nothing still charges this floor.
const MIN_UPGRADE_ZMW = 1;

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// functions/plans.js has no `tier` field, so derive it from the id (same
// mapping subscriptionActivation uses for the teacher studio tier).
function planTier(planId) {
  if (planId === "pro_monthly" || planId === "pro_yearly") return "pro";
  if (planId === "max_monthly" || planId === "max_yearly") return "max";
  return null;
}

function dailyRate(plan) {
  const price = Number(plan?.priceZMW || 0);
  const days = Number(plan?.durationDays || 0);
  return days > 0 ? price / days : 0;
}

// Only a *same-billing-period* Pro → Max step is a prorated "upgrade". A change
// of cadence (Pro Monthly → Max Yearly) keeps its own renewal date and adds no
// days under the prorated model, which is incoherent for an annual plan — it
// falls through to full-price checkout, which starts a fresh term. Keep this in
// sync with src/engines/payment-engine/subscriptionUpgrade.js.
function isUpgradePath(fromPlanId, toPlanId) {
  const from = getPlan(fromPlanId);
  const to = getPlan(toPlanId);
  return planTier(fromPlanId) === "pro" && planTier(toPlanId) === "max" &&
    Number(from?.durationDays) === Number(to?.durationDays);
}

function computeUpgradeQuote({fromPlan, toPlan, expiry, now = new Date()}) {
  const exp = toDate(expiry);
  const daysRemaining = exp ?
    Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / DAY)) :
    0;
  const perDayDiff = Math.max(0, dailyRate(toPlan) - dailyRate(fromPlan));
  const isUpgrade = daysRemaining > 0 && perDayDiff > 0;
  const amountZMW = isUpgrade ?
    Math.max(MIN_UPGRADE_ZMW, Math.round(perDayDiff * daysRemaining)) :
    0;
  return {isUpgrade, daysRemaining, amountZMW, perDayDiff, expiry: exp};
}

// The user's live tier, tolerant of the pre-2026-06 legacy teacherPlan ids
// (individual→pro, school→max). Returns 'pro' | 'max' | null.
function currentTier(user) {
  const tp = user?.teacherPlan;
  if (tp === "max" || tp === "school") return "max";
  if (tp === "pro" || tp === "individual") return "pro";
  return planTier(user?.subscriptionPlan);
}

// The exact Pro plan a teacher currently pays for, so we prorate against the
// right daily rate. Only meaningful once the caller has confirmed the user is
// actually on Pro; falls back to pro_monthly for a legacy/blank plan id.
function resolveCurrentProPlanId(user) {
  const id = user?.subscriptionPlan;
  if (planTier(id) === "pro") return id;
  return "pro_monthly";
}

/**
 * Quote an upgrade for a user record + target plan id. Returns
 * { isUpgrade:false } when it isn't a live Pro→Max step (the user isn't on
 * Pro, is already on Max, the target isn't Max, or the sub is expired) so
 * callers fall back to full-price checkout.
 */
function quoteUpgradeForUser(user, toPlanId, now = new Date()) {
  const fromPlanId = resolveCurrentProPlanId(user);
  const fromPlan = getPlan(fromPlanId);
  const toPlan = getPlan(toPlanId);
  const noop = {isUpgrade: false, daysRemaining: 0, amountZMW: 0, perDayDiff: 0, expiry: null, fromPlanId, toPlanId};
  // Guard on the user's ACTUAL tier first — a Max user must never be treated
  // as Pro by the pro_monthly fallback above.
  if (currentTier(user) !== "pro") return noop;
  // isUpgradePath enforces Pro→Max AND same billing period, so a cross-cadence
  // move (Pro Monthly → Max Yearly) returns the full-price no-op here.
  if (!fromPlan || !toPlan || !isUpgradePath(fromPlanId, toPlanId)) return noop;
  const expiry = user?.teacherPlanExpiresAt || user?.subscriptionExpiry;
  return {...computeUpgradeQuote({fromPlan, toPlan, expiry, now}), fromPlanId, toPlanId};
}

/**
 * Project the renewal/expiry date a successful purchase of `toPlanId` would
 * produce for this user — mirrors subscriptionActivation's grant logic so the
 * checkout can promise a date the activation will actually deliver: a
 * prorated upgrade keeps the current expiry (no days added); anything else
 * stacks a fresh durationDays onto the current expiry while it's still
 * active, otherwise onto now. Returns null for plans with no duration
 * (top-ups). Referral bonus days are granted at activation and are NOT
 * included here.
 */
function projectRenewalDate(user, toPlanId, now = new Date()) {
  const plan = getPlan(toPlanId);
  if (!plan || !Number(plan.durationDays)) return null;
  const quote = quoteUpgradeForUser(user, toPlanId, now);
  if (quote.isUpgrade) return quote.expiry;
  const current = toDate(user?.teacherPlanExpiresAt || user?.subscriptionExpiry);
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + Number(plan.durationDays) * DAY);
}

module.exports = {
  MIN_UPGRADE_ZMW,
  planTier,
  currentTier,
  dailyRate,
  isUpgradePath,
  computeUpgradeQuote,
  resolveCurrentProPlanId,
  quoteUpgradeForUser,
  projectRenewalDate,
};
