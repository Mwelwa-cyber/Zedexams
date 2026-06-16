/**
 * functions/plans.js
 *
 * Server-authoritative subscription pricing for the payment pipeline.
 *
 * IMPORTANT: keep this in sync with src/utils/subscriptionConfig.js's
 * PLANS (same ids, prices, durations). The client copy drives what the
 * learner *sees*; THIS copy is the source of truth for the amount we
 * actually charge through Lenco — the initiate callable resolves the
 * price here and never trusts a client-supplied amount. (Same client/
 * server-mirror discipline as the CBC curriculum lists.)
 *
 * `free` is intentionally omitted: it is not purchasable.
 */

const PLANS = {
  monthly: {id: "monthly", name: "Monthly", priceZMW: 50, durationDays: 30},
  termly: {id: "termly", name: "Termly", priceZMW: 120, durationDays: 91},
  yearly: {id: "yearly", name: "Yearly", priceZMW: 400, durationDays: 365},

  grade7_monthly: {id: "grade7_monthly", name: "Grade 7 ECZ Pack · Monthly", priceZMW: 75, durationDays: 30},
  grade7_termly: {id: "grade7_termly", name: "Grade 7 ECZ Pack · Termly", priceZMW: 200, durationDays: 90},
  grade12_monthly: {id: "grade12_monthly", name: "Grade 12 ECZ Pack", priceZMW: 150, durationDays: 30},

  full_platform_termly: {id: "full_platform_termly", name: "Full Platform", priceZMW: 200, durationDays: 90},
  single_subject_monthly: {id: "single_subject_monthly", name: "Single Subject", priceZMW: 30, durationDays: 30},

  pro_monthly: {id: "pro_monthly", name: "Pro · Monthly", priceZMW: 79, durationDays: 30},
  pro_yearly: {id: "pro_yearly", name: "Pro · Yearly", priceZMW: 790, durationDays: 365},
  max_monthly: {id: "max_monthly", name: "Max · Monthly", priceZMW: 199, durationDays: 30},
  max_yearly: {id: "max_yearly", name: "Max · Yearly", priceZMW: 1990, durationDays: 365},
};

function getPlan(planId) {
  return PLANS[planId] || null;
}

module.exports = {PLANS, getPlan};
