/**
 * plans — the learner unlock ladder, as data.
 *
 * Prices used to live inside JSX (the renewal modal hard-coded "K15" and
 * "Save K10 vs weekly" as strings), which meant a price change was a component
 * edit and the saving was a sentence somebody had typed rather than a number
 * anybody had computed. Both are here now: `price` is the only place a figure
 * appears, and `planSaving()` derives the "save K80" line from `saveVs` /
 * `saveAmount` so it cannot contradict the prices printed beside it.
 *
 * ── Two catalogues, and why they are not one ────────────────────────────
 *
 * This file is the LADDER — the four-to-five rungs a learner (or their
 * guardian) is offered in the contextual unlock sheet, ordered from
 * airtime-sized to term-sized. `src/engines/payment-engine/subscriptionConfig.js` PLANS is the
 * CHECKOUT catalogue: every purchasable product, learner and teacher, keyed by
 * the id Lenco and `functions/plans.js` charge against. A rung is a
 * presentation choice; a checkout plan is a contract with a payment provider,
 * and the two change for different reasons.
 *
 * `checkoutPlanId` is the join. Every rung must name a real checkout plan —
 * `test:plans-ladder` fails the build if one names an id the checkout
 * catalogue (and therefore the server) does not know, because a ladder rung
 * that cannot be paid for is a button that takes money nowhere.
 *
 * ── Never render a price from here to a learner under 18 ────────────────
 *
 * Nothing in this module knows the viewer's age. The age decision belongs to
 * `useUnlockFlow` — an under-18 learner is routed to the guardian-ask sheet,
 * which imports none of this. If you find yourself importing PLANS into a
 * learner-facing component, check which sheet it renders first.
 */

/**
 * The ladder. `id` is ours; `checkoutPlanId` is the payment system's.
 *
 * `availableFrom` / `availableTo` are ISO dates (inclusive from, exclusive
 * to). A rung with neither is always offered. The Exam Pass is seasonal: it
 * only means anything in the run-up to the October ECZ papers, and offering
 * "until the exam" in February prices a promise nobody wants.
 */
export const PLANS = [
  {
    id: 'day',
    checkoutPlanId: 'day_pass',
    price: 5,
    label: 'Day pass',
    period: 'today',
    blurb: "Tonight's revision",
  },
  {
    id: 'week',
    checkoutPlanId: 'weekly',
    price: 15,
    label: 'Weekly',
    period: '/week',
    blurb: "This week's test",
  },
  {
    id: 'month',
    checkoutPlanId: 'monthly',
    price: 50,
    label: 'Monthly',
    period: '/month',
    blurb: 'Keep going',
  },
  {
    id: 'term',
    checkoutPlanId: 'term_pass',
    price: 120,
    label: 'Term Pass',
    period: '4 months',
    blurb: 'Cover the whole term',
    highlight: true,
    badge: 'BEST FOR EXAMS',
    saveVs: 'month',
    saveAmount: 80,
  },
  {
    id: 'exam',
    checkoutPlanId: 'exam_pass',
    price: 99,
    label: 'Exam Pass',
    period: 'until the exam',
    availableFrom: '2026-09-01',
    availableTo: '2026-11-30',
  },
]

/** Sibling add-on, priced per extra learner on the same guardian's account. */
export const SIBLING_ADDON = { price: 20, period: '/month' }

/**
 * The rung the sheet highlights when the caller does not choose one.
 *
 * Deliberately the Term Pass, not Monthly. Zambian school fees are already
 * budgeted per term, so the term-sized rung is the one that matches how the
 * payer thinks about money — and it is the rung that survives the exam.
 */
export const DEFAULT_HIGHLIGHT_PLAN_ID = 'term'

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The rungs offered right now.
 *
 * A seasonal rung outside its window is omitted rather than disabled: a greyed
 * "Exam Pass — not yet" rung spends a row of a five-row sheet saying nothing.
 */
export function availablePlans(now = new Date()) {
  const at = toDate(now) || new Date()
  return PLANS.filter((plan) => {
    const from = toDate(plan.availableFrom)
    const to = toDate(plan.availableTo)
    if (from && at < from) return false
    if (to && at >= to) return false
    return true
  })
}

export function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) || null
}

/**
 * The saving a rung represents, computed rather than written down.
 *
 * Returns `null` when the rung claims no saving, so a caller renders nothing
 * instead of "Save K0". When `saveAmount` is stated it wins (a promotional
 * saving is a decision, not arithmetic); otherwise the saving is derived from
 * the comparison rung's price over the same period, which is what stops the
 * printed figure drifting from the printed prices.
 */
export function planSaving(plan) {
  if (!plan || !plan.saveVs) return null
  const against = getPlan(plan.saveVs)
  if (!against) return null
  const amount = Number.isFinite(plan.saveAmount) ? plan.saveAmount : null
  if (amount == null || amount <= 0) return null
  return { amount, versus: against.label, versusId: against.id }
}

/** "K120" — one formatter so no component invents a second currency style. */
export function formatKwacha(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return ''
  return `K${Math.round(n)}`
}

/** "Save K80 vs Monthly", or '' when the rung claims no saving. */
export function savingLabel(plan) {
  const saving = planSaving(plan)
  if (!saving) return ''
  return `Save ${formatKwacha(saving.amount)} vs ${saving.versus}`
}

/** The cheapest rung on offer — the "from K5" the lock card quotes. */
export function cheapestPlan(now = new Date()) {
  const offered = availablePlans(now)
  if (!offered.length) return null
  return offered.reduce((min, p) => (p.price < min.price ? p : min), offered[0])
}
