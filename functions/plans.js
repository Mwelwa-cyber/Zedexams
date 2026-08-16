/**
 * functions/plans.js
 *
 * Server-authoritative subscription pricing for the payment pipeline.
 *
 * IMPORTANT: keep this in sync with src/engines/payment-engine/subscriptionConfig.js's
 * PLANS (same ids, prices, durations). The client copy drives what the
 * learner *sees*; THIS copy is the source of truth for the amount we
 * actually charge through Lenco — the initiate callable resolves the
 * price here and never trusts a client-supplied amount. (Same client/
 * server-mirror discipline as the CBC curriculum lists.)
 *
 * `free` is intentionally omitted: it is not purchasable.
 */

const PLANS = {
  weekly: {id: "weekly", name: "Weekly", priceZMW: 15, durationDays: 7},
  monthly: {id: "monthly", name: "Monthly", priceZMW: 50, durationDays: 30},

  grade7_monthly: {id: "grade7_monthly", name: "Grade 7 ECZ Pack · Monthly", priceZMW: 75, durationDays: 30},
  grade7_termly: {id: "grade7_termly", name: "Grade 7 ECZ Pack · Termly", priceZMW: 200, durationDays: 90},
  grade12_monthly: {id: "grade12_monthly", name: "Grade 12 ECZ Pack", priceZMW: 150, durationDays: 30},

  full_platform_termly: {id: "full_platform_termly", name: "Full Platform", priceZMW: 200, durationDays: 90},
  single_subject_monthly: {id: "single_subject_monthly", name: "Single Subject", priceZMW: 30, durationDays: 30},

  pro_monthly: {id: "pro_monthly", name: "Pro · Monthly", priceZMW: 59, durationDays: 30},
  pro_yearly: {id: "pro_yearly", name: "Pro · Yearly", priceZMW: 590, durationDays: 365},
  max_monthly: {id: "max_monthly", name: "Max · Monthly", priceZMW: 149, durationDays: 30},
  max_yearly: {id: "max_yearly", name: "Max · Yearly", priceZMW: 1490, durationDays: 365},

  // ── Pay-per-generation top-up ──────────────────────────────────────────
  // Not a subscription: a one-off K25 purchase that grants ONE extra
  // generation usable on ANY metered teacher tool. `kind: "topup"` makes
  // subscriptionActivation grant a `generationCredits` credit instead of
  // flipping the plan/expiry (it has no durationDays). Sold from the paywall
  // the moment a teacher hits a monthly or daily cap.
  topup_generation: {id: "topup_generation", name: "Extra generation (top-up)", priceZMW: 25, kind: "topup", credits: 1},
};

function getPlan(planId) {
  return PLANS[planId] || null;
}

module.exports = {PLANS, getPlan};
