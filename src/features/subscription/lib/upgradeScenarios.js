// upgradeScenarios — the copy map behind the compact contextual upgrade
// pop-up (ContextualUpgradeModal, hosted by PaywallHost).
//
// One resolver turns a paywall bus event — `paywall.show(reason, ctx)` — into
// everything the pop-up renders: heading, description, plan summary, at most
// three benefits, the primary CTA and the secondary action. Copy is
// contextual: it names the exact studio/feature that was blocked (from
// ctx.tool / ctx.feature) instead of one generic "you hit a limit" message.
//
// Pure module on purpose: prices come from the canonical client catalogue
// (subscriptionConfig PLANS — server-authoritative amounts are always
// recomputed in functions/plans.js at charge time), and there are no Firebase
// or React imports, so the whole map is unit-testable under Vitest with no
// mocks.
//
// Native (Capacitor Android) rule, per Google Play policy: every purchase
// runs through Play Billing, so ZMW price literals and the K25 Lenco one-off
// never render — pass { native: true } and the resolver strips them.

import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'

export const UPGRADE_REASONS = ['feature-locked', 'monthly-limit', 'daily-cap', 'max-feature']

// K25 top-up — existing offer string, kept verbatim from the previous paywall
// (the amount itself is charged server-side from functions/plans.js
// topup_generation; this label is display copy only).
const TOPUP_SECONDARY = { action: 'topup', label: 'Pay K25 — one extra now' }

const PRO_BENEFITS = [
  'More AI generations every day',
  'Unbranded Word & PDF downloads',
  'Unlocks worksheets, schemes, notes and more',
]

const MAX_BENEFITS = [
  'Unlimited test & exam papers with marking schemes',
  'The highest daily generation allowance',
  'Everything in Pro included',
]

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

// "K59/mo" — derived from the canonical catalogue, never hard-coded here.
function shortPrice(planId) {
  const plan = PLANS[planId]
  if (!plan || !Number(plan.priceZMW)) return ''
  return `K${plan.priceZMW}/${plan.billing === 'yearly' ? 'yr' : 'mo'}`
}

// "K59/month" — the plan-summary chip ("Teacher Pro — K59/month").
function longPrice(planId) {
  const plan = PLANS[planId]
  if (!plan || !Number(plan.priceZMW)) return ''
  return `K${plan.priceZMW}/${plan.billing === 'yearly' ? 'year' : 'month'}`
}

const PLAN_TARGETS = {
  pro: {
    planTarget: 'pro',
    planIds: ['pro_monthly', 'pro_yearly'],
    defaultPlanId: 'pro_monthly',
    planName: 'Teacher Pro',
  },
  max: {
    planTarget: 'max',
    planIds: ['max_monthly', 'max_yearly'],
    defaultPlanId: 'max_monthly',
    planName: 'Teacher Max',
  },
}

// Studio-specific phrasings, keyed by the tool id the gate passes in ctx.tool
// (the same ids the usage meter counts). Anything not listed falls back to a
// template built from ctx.feature — new studios degrade gracefully.
const TOOL_DESCRIPTIONS = {
  lesson_plan:
    'Your saved work is safe. Upgrade to continue creating lesson plans, worksheets, tests and other teaching materials.',
  worksheet:
    'Your saved work is safe. Upgrade to continue creating worksheets, lesson plans and other teaching materials.',
  scheme_of_work:
    'Your saved work is safe. Upgrade to generate complete, CBC-aligned schemes of work for the whole term.',
  notes:
    'Your saved work is safe. Upgrade to continue preparing teacher notes and other teaching materials.',
}

function proScenario(overrides) {
  return {
    ...PLAN_TARGETS.pro,
    benefits: PRO_BENEFITS,
    ...overrides,
  }
}

/**
 * @param {string} reason  paywall bus reason
 * @param {object} ctx     bus context: { feature, tool, resetDays }
 * @param {object} opts    { native } — Capacitor Android build
 * @returns {object|null}  scenario for ContextualUpgradeModal, or null for
 *                         reasons this pop-up does not handle
 *                         (e.g. 'quiz-preview-limit' → QuizLimitPopup).
 */
export function resolveUpgradeScenario(reason, ctx = {}, { native = false } = {}) {
  const feature = ctx.feature || ''
  let scenario = null

  if (reason === 'feature-locked') {
    scenario = proScenario({
      icon: '🔒',
      tag: '✦ Pro studio',
      heading: `${capitalize(feature) || 'This studio'} is a Pro studio`,
      description:
        TOOL_DESCRIPTIONS[ctx.tool] ||
        `Your saved work is safe. Upgrade to unlock ${lower(feature) || 'this studio'} and every other core teacher studio.`,
      secondary: null,
    })
  } else if (reason === 'monthly-limit') {
    scenario = proScenario({
      icon: '📄',
      tag: '⏱ Monthly limit reached',
      heading: `You've reached this month's ${lower(feature) || 'generation'} limit`,
      description:
        TOOL_DESCRIPTIONS[ctx.tool] ||
        'Your saved work is safe. Upgrade to continue preparing teaching materials without interruption.',
      note: Number(ctx.resetDays) > 0
        ? `Your free allowance resets in ${ctx.resetDays} day${Number(ctx.resetDays) === 1 ? '' : 's'}.`
        : null,
      secondary: TOPUP_SECONDARY,
    })
  } else if (reason === 'daily-cap') {
    scenario = proScenario({
      icon: '⏳',
      tag: '⏱ Daily cap reached',
      heading: "You've used today's generations",
      description:
        'Your work is saved. Upgrade for a higher daily allowance, or come back tomorrow when it resets.',
      secondary: TOPUP_SECONDARY,
    })
  } else if (reason === 'max-feature') {
    scenario = {
      ...PLAN_TARGETS.max,
      icon: '🦅',
      tag: '🦅 Max studio',
      heading: `${capitalize(feature) || 'Full papers'} are a Max studio`,
      description: `You've used this month's free ${lower(feature) || 'paper'}. Your saved work is safe — Max unlocks unlimited full papers with complete marking schemes.`,
      benefits: MAX_BENEFITS,
      secondary: TOPUP_SECONDARY,
    }
  }

  if (!scenario) return null

  const price = shortPrice(scenario.defaultPlanId)
  const planLabel = scenario.planTarget === 'max' ? 'Upgrade to Max' : 'Upgrade to Pro'

  return {
    reason,
    note: null,
    ...scenario,
    // Native strips ZMW literals (Play shows its own localized price) and the
    // Lenco K25 one-off (no Play product for it).
    primaryLabel: native || !price ? planLabel : `${planLabel} · ${price}`,
    secondary: native ? null : scenario.secondary || null,
    planSummary: {
      name: scenario.planName,
      priceLabel: native ? null : longPrice(scenario.defaultPlanId) || null,
    },
    dismissLabel: 'Not now',
    footerNote: native
      ? 'Cancel anytime in the Play Store'
      : 'Cancel anytime · No card needed for Free',
  }
}
