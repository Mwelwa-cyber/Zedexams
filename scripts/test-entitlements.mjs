/**
 * test-entitlements — the gating service's pure rules.
 *
 * Covers the acceptance criteria that are arithmetic rather than rendering:
 * grace, quotas and their reset dates, the age-band default, the interruption
 * budget's five caps, the free-set boundary configuration, the guardian
 * message's block order, and the ladder's join to the checkout catalogue.
 *
 * Plain `node` (the repo's first suite) because none of it needs a DOM. The
 * rendering half — no overlay on sign-in, no price for an under-18, the
 * un-dismissible meter, the ungated review — lives in the Vitest specs beside
 * the components, where a rendered tree can actually be asserted on.
 */

import assert from 'node:assert/strict'

import {
  AGE_BAND,
  GRACE_DAYS,
  PLAN_STATUS,
  formatResetDate,
  isGateLocked,
  nextMonthlyReset,
  nextWeeklyReset,
  planChipLabel,
  quotaLeft,
  resolveAgeBand,
  resolvePlanState,
} from '../src/services/entitlements/planState.js'
import {
  FEATURE_GATES,
  FREE_PAPERS_PER_WEEK,
  GATE_IDS,
  MOMENT_OF_WIN_EVENTS,
  TIER,
  interpolate,
  resolveGateCopy,
} from '../src/services/entitlements/gates.js'
import {
  BLOCKED_CONTEXTS,
  LIMITS,
  SUPPRESSION,
  applyDismissal,
  decideCanRequestGuardian,
  decideCanShow,
} from '../src/services/entitlements/interruptionBudget.js'
import {
  meterLabel,
  resolveFreeSet,
  shouldShowMeter,
  validateFreeSetConfig,
} from '../src/services/entitlements/freeSet.js'
import {
  buildGuardianMessage,
  priceComesLast,
} from '../functions/shared/guardian/guardianMessageCore.js'
import { PLANS, availablePlans, cheapestPlan, planSaving, savingLabel } from '../src/config/plans.js'
import { PLANS as CHECKOUT_PLANS } from '../src/engines/payment-engine/subscriptionConfig.js'
import { crossedWinBackThreshold, daysToExam, examCountdownLabel } from '../src/config/examDates.js'

let failures = 0

/**
 * Tests and section headings are QUEUED, then run in order at the bottom of
 * this file.
 *
 * The obvious shape — `try { fn() } catch` — silently passes every async test
 * in the file: `fn()` returns a promise, the try block exits before it
 * settles, and a rejected assertion becomes an unhandled rejection that
 * `process.exit` beats to the finish line. Two tests here are async (the
 * codebase scan and the exam-date mirror) and both were reporting ✓ without
 * ever running their assertions. Queueing lets one `await` cover sync and
 * async alike, and keeps the printed order identical to the source order.
 */
const queue = []
function test(name, fn) { queue.push({ kind: 'test', name, fn }) }
function section(name) { queue.push({ kind: 'section', name }) }

async function runQueue() {
  for (const item of queue) {
    if (item.kind === 'section') { console.log(`\n${item.name}`); continue }
    try {
      await item.fn()
      console.log(`  ✓ ${item.name}`)
    } catch (err) {
      failures += 1
      console.error(`  ✗ ${item.name}\n    ${err.message}`)
    }
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-08-19T10:00:00Z') // a Wednesday

// ── Plan state ──────────────────────────────────────────────────────────
section('plan state')

test('a never-subscribed learner is on the free plan and that plan is ACTIVE', () => {
  const s = resolvePlanState({ role: 'learner', isMinor: false }, { now: NOW })
  assert.equal(s.plan, 'free')
  // Not "expired": expired describes a lapse, and a brand-new learner has not
  // lapsed. Calling them expired would put a grace ribbon on their first visit.
  assert.equal(s.status, PLAN_STATUS.ACTIVE)
  assert.equal(s.unlocked, false)
})

test('an active paid learner is unlocked and reports their ladder rung', () => {
  const s = resolvePlanState({
    role: 'learner', isMinor: false, premium: true,
    subscriptionPlan: 'term_pass',
    subscriptionExpiry: new Date(NOW.getTime() + 40 * DAY),
  }, { now: NOW })
  assert.equal(s.status, PLAN_STATUS.ACTIVE)
  assert.equal(s.plan, 'term')
  assert.equal(s.unlocked, true)
})

test('ACCEPTANCE 8 — within 3 days of expiry every gated feature stays unlocked', () => {
  const expiry = new Date(NOW.getTime() - 1 * DAY)
  const s = resolvePlanState({
    role: 'learner', isMinor: false, subscriptionPlan: 'monthly',
    subscriptionPaymentId: 'pay_1', subscriptionExpiry: expiry,
  }, { now: NOW, used: { papersThisWeek: 99 } })
  assert.equal(s.status, PLAN_STATUS.GRACE)
  assert.equal(s.unlocked, true)
  for (const gate of GATE_IDS) {
    assert.equal(isGateLocked(s, gate, FEATURE_GATES), false, `${gate} should be unlocked in grace`)
  }
  // Even an exhausted quota reports room, because nothing is being rationed.
  assert.equal(quotaLeft(s, 'papersThisWeek'), Infinity)
})

test('grace ends exactly GRACE_DAYS after expiry, then the account is expired', () => {
  const expiry = new Date(NOW.getTime() - (GRACE_DAYS * DAY + 1000))
  const s = resolvePlanState({
    role: 'learner', isMinor: false, subscriptionPlan: 'monthly',
    subscriptionPaymentId: 'pay_1', subscriptionExpiry: expiry,
  }, { now: NOW })
  assert.equal(s.status, PLAN_STATUS.EXPIRED)
  assert.equal(s.unlocked, false)
  assert.equal(s.plan, 'free')
})

test('ageBand fails closed — a learner is under18 unless isMinor is exactly false', () => {
  assert.equal(resolveAgeBand({ role: 'learner' }), AGE_BAND.UNDER_18)
  assert.equal(resolveAgeBand({ role: 'learner', isMinor: null }), AGE_BAND.UNDER_18)
  assert.equal(resolveAgeBand({ role: 'learner', isMinor: true }), AGE_BAND.UNDER_18)
  assert.equal(resolveAgeBand({ role: 'learner', isMinor: false }), AGE_BAND.ADULT)
  assert.equal(resolveAgeBand({}), AGE_BAND.UNDER_18)
  // Account holders by definition: there is no guardian to route to.
  assert.equal(resolveAgeBand({ role: 'teacher' }), AGE_BAND.ADULT)
  assert.equal(resolveAgeBand({ role: 'parent' }), AGE_BAND.ADULT)
})

test('every quota states a reset date, and the weekly one is the next Monday', () => {
  const s = resolvePlanState({ role: 'learner' }, { now: NOW })
  for (const key of Object.keys(s.quotas)) {
    assert.ok(s.resetsAt[key] instanceof Date, `${key} must expose a reset date`)
    assert.ok(!Number.isNaN(s.resetsAt[key].getTime()), `${key} reset date must be valid`)
  }
  const monday = nextWeeklyReset(new Date('2026-08-19T10:00:00'))
  assert.equal(monday.getDay(), 1)
  // Strictly after now, even when now IS a Monday — otherwise "unlocks Monday"
  // resolves to a moment already past.
  const onMonday = nextWeeklyReset(new Date('2026-08-24T09:00:00'))
  assert.equal(onMonday.getDate(), 31)
  assert.equal(nextMonthlyReset(new Date('2026-08-19T10:00:00')).getMonth(), 8)
})

test('a spent paper quota locks PAPER_OPEN and nothing else', () => {
  const s = resolvePlanState({ role: 'learner' }, {
    now: NOW, used: { papersThisWeek: FREE_PAPERS_PER_WEEK },
  })
  assert.equal(quotaLeft(s, 'papersThisWeek'), 0)
  assert.equal(isGateLocked(s, 'PAPER_OPEN', FEATURE_GATES), true)
  // A plan-only gate is locked for a free account regardless of the quota.
  assert.equal(isGateLocked(s, 'PAPER_OFFLINE', FEATURE_GATES), true)
})

test('quotaLeft never goes negative', () => {
  const s = resolvePlanState({ role: 'learner' }, { now: NOW, used: { papersThisWeek: 99 } })
  assert.equal(quotaLeft(s, 'papersThisWeek'), 0)
})

test('the chip says what is left, and switches to the warn wording at zero', () => {
  const some = resolvePlanState({ role: 'learner' }, { now: NOW, used: { papersThisWeek: 1 } })
  assert.equal(planChipLabel(some), `Free · ${FREE_PAPERS_PER_WEEK - 1} left`)
  const none = resolvePlanState({ role: 'learner' }, { now: NOW, used: { papersThisWeek: 3 } })
  assert.equal(planChipLabel(none), '0 left')
  const grace = resolvePlanState({
    role: 'learner', subscriptionPaymentId: 'p', subscriptionPlan: 'monthly',
    subscriptionExpiry: new Date(NOW.getTime() - DAY),
  }, { now: NOW })
  assert.equal(planChipLabel(grace), 'Grace')
})

test('formatResetDate names a weekday inside the week and a date beyond it', () => {
  const from = new Date('2026-08-19T10:00:00')
  assert.equal(formatResetDate(new Date('2026-08-24T00:00:00'), from), 'Monday')
  assert.match(formatResetDate(new Date('2026-09-01T00:00:00'), from), /September/)
  // No date → empty string, which every caller treats as "do not render a lock".
  assert.equal(formatResetDate(null, from), '')
  assert.equal(formatResetDate('not a date', from), '')
})

// ── Gate registry ───────────────────────────────────────────────────────
section('gate registry')

test('every gate declares a tier, an icon, a title and a body', () => {
  for (const [id, gate] of Object.entries(FEATURE_GATES)) {
    assert.ok(Number.isFinite(gate.tier), `${id} must declare a tier`)
    assert.ok(gate.icon, `${id} must declare an icon`)
    assert.ok(gate.title, `${id} must declare a title`)
    assert.ok(gate.body, `${id} must declare a body`)
  }
})

test('no gate may claim tier 3 — the full screen belongs to success events', () => {
  for (const [id, gate] of Object.entries(FEATURE_GATES)) {
    assert.ok(gate.tier < TIER.FULL_SCREEN, `${id} must not be a full-screen gate`)
  }
  assert.deepEqual(MOMENT_OF_WIN_EVENTS, [
    'quiz_completed', 'streak_extended', 'note_topic_completed', 'teacher_document_exported',
  ])
})

test('PAPER_CONTINUE is inline on the results screen, never a sheet', () => {
  assert.equal(FEATURE_GATES.PAPER_CONTINUE.surface, 'results-inline')
})

test('an unfilled token is removed rather than printed to a learner', () => {
  assert.equal(interpolate('Save {paperTitle} to your phone', {}), 'Save to your phone')
  assert.equal(
    interpolate('Save {paperTitle} to your phone', { paperTitle: '2025 ECZ' }),
    'Save 2025 ECZ to your phone',
  )
  const copy = resolveGateCopy('PAPER_CONTINUE', { remaining: 40, paperYear: '2025' })
  assert.equal(copy.title, '40 more questions in this paper')
  assert.match(copy.body, /2025 paper/)
  assert.equal(resolveGateCopy('NOT_A_GATE', {}), null)
})

// ── Interruption budget ─────────────────────────────────────────────────
section('interruption budget')

// A state that has cleared the new-account grace, so each cap can be tested on
// its own rather than through the grace that would refuse everything anyway.
const SETTLED = {
  sessions: 10,
  firstSeenAt: new Date(Date.now() - 30 * DAY).toISOString(),
  appOpenAt: new Date(Date.now() - 60_000).toISOString(),
  lastDismissedAt: null,
  dismissals: {},
  tier3ShownThisSession: 0,
  activeContexts: [],
}

test('ACCEPTANCE 4 — canShow is false in each of the five blocked contexts', () => {
  assert.equal(BLOCKED_CONTEXTS.length, 5)
  for (const context of BLOCKED_CONTEXTS) {
    const v = decideCanShow(SETTLED, { tier: TIER.CONTEXTUAL, surface: 's', context })
    assert.equal(v.allowed, false, `${context} must block`)
    assert.equal(v.reason, SUPPRESSION.BLOCKED_CONTEXT)
    // …and equally when the activity is on the stack rather than named in the
    // request, which is how a screen that pushed on mount protects itself.
    const stacked = decideCanShow(
      { ...SETTLED, activeContexts: [context] },
      { tier: TIER.CONTEXTUAL, surface: 's' },
    )
    assert.equal(stacked.allowed, false, `${context} on the stack must block`)
  }
})

test('ACCEPTANCE 4 — nothing interrupts in the first 10 seconds after app open', () => {
  const v = decideCanShow(
    { ...SETTLED, appOpenAt: new Date(Date.now() - 3000).toISOString() },
    { tier: TIER.CONTEXTUAL, surface: 's' },
  )
  assert.equal(v.allowed, false)
  assert.equal(v.reason, SUPPRESSION.APP_OPEN_QUIET)
  const after = decideCanShow(
    { ...SETTLED, appOpenAt: new Date(Date.now() - 11_000).toISOString() },
    { tier: TIER.CONTEXTUAL, surface: 's' },
  )
  assert.equal(after.allowed, true)
})

test('ACCEPTANCE 5 — a second tier-3 modal in one session is suppressed', () => {
  const first = decideCanShow(SETTLED, { tier: TIER.FULL_SCREEN, surface: 'moment-of-win' })
  assert.equal(first.allowed, true)
  const second = decideCanShow(
    { ...SETTLED, tier3ShownThisSession: 1 },
    { tier: TIER.FULL_SCREEN, surface: 'moment-of-win' },
  )
  assert.equal(second.allowed, false)
  assert.equal(second.reason, SUPPRESSION.SESSION_CAP)
  // The cap is on the full screen only — a tapped lock still opens its sheet.
  const sheet = decideCanShow(
    { ...SETTLED, tier3ShownThisSession: 1 },
    { tier: TIER.CONTEXTUAL, surface: 'unlock-sheet:PAPER_OPEN' },
  )
  assert.equal(sheet.allowed, true)
})

test('new-account grace needs BOTH conditions cleared — whichever is longer', () => {
  const old = new Date(Date.now() - 30 * DAY).toISOString()
  const fresh = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  // Three sessions in one evening does not end it…
  const manySessionsNewAccount = decideCanShow(
    { ...SETTLED, sessions: 12, firstSeenAt: fresh },
    { tier: TIER.CONTEXTUAL, surface: 's' },
  )
  assert.equal(manySessionsNewAccount.allowed, false)
  assert.equal(manySessionsNewAccount.reason, SUPPRESSION.NEW_ACCOUNT_GRACE)
  // …and neither does two days of not opening the app.
  const oldAccountFewSessions = decideCanShow(
    { ...SETTLED, sessions: 2, firstSeenAt: old },
    { tier: TIER.CONTEXTUAL, surface: 's' },
  )
  assert.equal(oldAccountFewSessions.allowed, false)
  assert.equal(oldAccountFewSessions.reason, SUPPRESSION.NEW_ACCOUNT_GRACE)
  assert.equal(
    decideCanShow({ ...SETTLED, sessions: 4, firstSeenAt: old }, { tier: TIER.CONTEXTUAL, surface: 's' }).allowed,
    true,
  )
})

test('24 hours quiet after any dismissal, 7 days after the third of one surface', () => {
  const justDismissed = applyDismissal(SETTLED, 'unlock-sheet:PAPER_OPEN', Date.now())
  const soon = decideCanShow(
    { ...justDismissed, appOpenAt: SETTLED.appOpenAt },
    { tier: TIER.CONTEXTUAL, surface: 'unlock-sheet:PAPER_OFFLINE' },
  )
  assert.equal(soon.allowed, false)
  assert.equal(soon.reason, SUPPRESSION.DISMISSAL_COOLDOWN)

  // Three dismissals of ONE surface: quiet for a week, even once the 24h
  // blanket cooldown has passed.
  const thrice = {
    ...SETTLED,
    lastDismissedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    dismissals: {
      'unlock-sheet:PAPER_OPEN': { count: 3, lastAt: new Date(Date.now() - 2 * DAY).toISOString() },
    },
  }
  const refused = decideCanShow(thrice, { tier: TIER.CONTEXTUAL, surface: 'unlock-sheet:PAPER_OPEN' })
  assert.equal(refused.allowed, false)
  assert.equal(refused.reason, SUPPRESSION.SURFACE_COOLDOWN)
  // A DIFFERENT surface is unaffected — the tally is per surface.
  assert.equal(
    decideCanShow(thrice, { tier: TIER.CONTEXTUAL, surface: 'unlock-sheet:PAPER_OFFLINE' }).allowed,
    true,
  )
})

test('tier 0 and tier 1 are never suppressed — a hidden padlock converts nobody', () => {
  const hostile = {
    ...SETTLED,
    sessions: 1,
    firstSeenAt: new Date().toISOString(),
    appOpenAt: new Date().toISOString(),
    lastDismissedAt: new Date().toISOString(),
    activeContexts: ['quiz_active'],
  }
  assert.equal(decideCanShow(hostile, { tier: TIER.AMBIENT, surface: 'plan-chip' }).allowed, true)
  assert.equal(decideCanShow(hostile, { tier: TIER.INLINE, surface: 'lock-badge' }).allowed, true)
})

test('ACCEPTANCE 6 (client half) — one guardian request per 72 hours', () => {
  assert.equal(LIMITS.guardianRequestCooldownMs, 72 * 60 * 60 * 1000)
  const fresh = decideCanRequestGuardian({ lastGuardianRequestAt: null })
  assert.equal(fresh.allowed, true)
  const recent = decideCanRequestGuardian({
    lastGuardianRequestAt: new Date(Date.now() - 2 * DAY).toISOString(),
  })
  assert.equal(recent.allowed, false)
  assert.equal(recent.reason, SUPPRESSION.GUARDIAN_RATE_LIMIT)
  assert.ok(recent.retryAfterMs > 0)
  const old = decideCanRequestGuardian({
    lastGuardianRequestAt: new Date(Date.now() - 4 * DAY).toISOString(),
  })
  assert.equal(old.allowed, true)
})

// ── The free set ────────────────────────────────────────────────────────
section('free set')

const PAPER = {
  id: 'p1',
  totalQuestions: 60,
  sections: [
    { id: 'a1', label: 'Section A, Part 1', title: 'Grammar', from: 1, to: 20 },
    { id: 'a2', label: 'Section A, Part 2', title: 'Spelling', from: 21, to: 35 },
    { id: 'b1', label: 'Section B', title: 'Punctuation', from: 36, to: 60 },
  ],
  freeSet: { toQuestion: 20, sectionId: 'a1' },
}

test('the free set reads its section label, so the boundary is a unit not a ration', () => {
  const fs = resolveFreeSet(PAPER, 60)
  assert.equal(fs.toQuestion, 20)
  assert.equal(fs.sectionLabel, 'Section A, Part 1')
  assert.equal(fs.sectionTitle, 'Grammar')
  assert.equal(fs.remaining, 40)
  assert.equal(fs.coversWholePaper, false)
  assert.deepEqual(fs.lockedSectionTitles, ['Spelling', 'Punctuation'])
})

test('a paper declaring no freeSet keeps the historical limit rather than losing one', () => {
  const fs = resolveFreeSet({ id: 'legacy' }, 60)
  assert.equal(fs.declared, false)
  assert.equal(fs.toQuestion, 30)
})

test('the free set is clamped to the questions that actually exist', () => {
  const fs = resolveFreeSet(PAPER, 12)
  assert.equal(fs.toQuestion, 12)
  assert.equal(fs.remaining, 0)
  assert.equal(fs.coversWholePaper, true)
})

test('ACCEPTANCE 13 — the meter appears from two questions out, and not before', () => {
  const fs = resolveFreeSet(PAPER, 60)
  assert.equal(shouldShowMeter(17, fs), false)
  assert.equal(shouldShowMeter(18, fs), true)
  assert.equal(shouldShowMeter(19, fs), true)
  assert.equal(shouldShowMeter(20, fs), true)
  assert.equal(meterLabel(18, fs), '3 left in your free set')
  assert.equal(meterLabel(19, fs), '2 left in your free set')
  // A paid learner never sees it, and neither does anyone on a paper whose
  // free set covers the lot — warning about a limit nobody reaches is noise.
  assert.equal(shouldShowMeter(19, fs, { unlocked: true }), false)
  assert.equal(shouldShowMeter(11, resolveFreeSet(PAPER, 12)), false)
})

test('ACCEPTANCE 17 — a declared freeSet must land on a section boundary', () => {
  assert.deepEqual(validateFreeSetConfig(PAPER), [])
  // Undeclared is legal: it falls back rather than failing.
  assert.deepEqual(validateFreeSetConfig({ id: 'legacy', sections: PAPER.sections }), [])

  const offBoundary = { ...PAPER, freeSet: { toQuestion: 22, sectionId: 'a1' } }
  const problems = validateFreeSetConfig(offBoundary)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /not a section boundary/)

  const wrongSection = { ...PAPER, freeSet: { toQuestion: 20, sectionId: 'a2' } }
  assert.match(validateFreeSetConfig(wrongSection)[0], /ends section "a1"/)

  const noSections = { id: 'x', freeSet: { toQuestion: 20 } }
  assert.match(validateFreeSetConfig(noSections)[0], /no sections/)

  const beyondPaper = { ...PAPER, totalQuestions: 10 }
  assert.ok(validateFreeSetConfig(beyondPaper).some((p) => /exceeds totalQuestions/.test(p)))
})

// ── The guardian message ────────────────────────────────────────────────
section('guardian message')

const FULL_PAYLOAD = {
  learnerName: 'Elena Banda',
  feature: 'PAPER_CONTINUE',
  score: 14,
  outOf: 20,
  subject: 'English',
  paperTitle: 'the 2025 ECZ English paper',
  weakTopic: 'sentence completion',
  weakTopicDetail: 'joining words like but, so, because',
  streakDays: 3,
  remaining: 40,
  daysToExam: 47,
  grade: 7,
  plan: { label: 'Term Pass', price: 120 },
  payUrl: 'https://zedexams.com/guardian-unlock?t=abc',
}

test('the block order is evidence → ask → countdown → price, and price is last', () => {
  const msg = buildGuardianMessage(FULL_PAYLOAD)
  assert.deepEqual(msg.blocks.map((b) => b.id), ['evidence', 'request', 'countdown', 'price'])
  assert.equal(priceComesLast(msg), true)
  // The evidence really is first in the rendered text, not merely first in an
  // array a renderer could reorder.
  assert.ok(msg.text.indexOf('14 out of 20') < msg.text.indexOf('K120'))
})

test('nothing is invented — a missing figure omits its line rather than guessing', () => {
  const bare = buildGuardianMessage({ learnerName: 'Elena', feature: 'PAPER_OFFLINE' })
  const ids = bare.blocks.map((b) => b.id)
  assert.ok(!ids.includes('evidence'))
  assert.ok(!ids.includes('countdown'))
  assert.ok(!ids.includes('price'))
  assert.equal(bare.cta, null)
  assert.ok(!/undefined|NaN|null/.test(bare.text))
  // A past exam is not a countdown of zero.
  const past = buildGuardianMessage({ ...FULL_PAYLOAD, daysToExam: -3 })
  assert.ok(!past.blocks.some((b) => b.id === 'countdown'))
})

test('the first name is used, and an unknown gate still produces a sane ask', () => {
  const msg = buildGuardianMessage(FULL_PAYLOAD)
  assert.ok(msg.text.startsWith('Elena scored 14 out of 20'))
  const unknown = buildGuardianMessage({ learnerName: 'Elena', feature: 'SOMETHING_NEW' })
  assert.match(unknown.text, /Elena is asking to unlock more practice/)
})

// ── The ladder ──────────────────────────────────────────────────────────
section('plan ladder')

test('every ladder rung names a checkout plan the server actually knows', () => {
  for (const plan of PLANS) {
    assert.ok(
      CHECKOUT_PLANS[plan.checkoutPlanId],
      `ladder rung "${plan.id}" names checkout plan "${plan.checkoutPlanId}", which does not exist`,
    )
    assert.equal(
      CHECKOUT_PLANS[plan.checkoutPlanId].priceZMW, plan.price,
      `ladder rung "${plan.id}" prices ${plan.price} but its checkout plan charges ${CHECKOUT_PLANS[plan.checkoutPlanId].priceZMW}`,
    )
  }
})

test('the saving is computed, not typed', () => {
  const term = PLANS.find((p) => p.id === 'term')
  assert.deepEqual(planSaving(term), { amount: 80, versus: 'Monthly', versusId: 'month' })
  assert.equal(savingLabel(term), 'Save K80 vs Monthly')
  // A rung claiming no saving renders nothing rather than "Save K0".
  assert.equal(planSaving(PLANS.find((p) => p.id === 'week')), null)
  assert.equal(savingLabel(PLANS.find((p) => p.id === 'week')), '')
})

test('the highlighted rung is the Term Pass, not Monthly', () => {
  const highlighted = PLANS.filter((p) => p.highlight)
  assert.equal(highlighted.length, 1)
  assert.equal(highlighted[0].id, 'term')
})

test('the seasonal Exam Pass is offered only inside its window', () => {
  const inSeason = availablePlans(new Date('2026-09-15')).map((p) => p.id)
  assert.ok(inSeason.includes('exam'))
  const outOfSeason = availablePlans(new Date('2026-02-15')).map((p) => p.id)
  assert.ok(!outOfSeason.includes('exam'))
  assert.equal(cheapestPlan(new Date('2026-02-15')).id, 'day')
})

// ── Exam countdown ──────────────────────────────────────────────────────
section('exam countdown')

test('ACCEPTANCE 9 — the countdown is null (never NaN, never negative) when unset or past', () => {
  assert.equal(daysToExam(9, NOW), null, 'a grade with no seeded date has no countdown')
  assert.equal(daysToExam(undefined, NOW), null)
  assert.equal(daysToExam(7, new Date('2027-01-01')), null, 'a past exam has no countdown')
  assert.equal(daysToExam(7, 'not a date'), null)
  assert.equal(examCountdownLabel(9, NOW), '')
  const days = daysToExam(7, NOW)
  assert.ok(Number.isInteger(days) && days > 0, `expected a positive integer, got ${days}`)
  assert.equal(examCountdownLabel(7, NOW), `${days} days`)
  assert.equal(daysToExam('Grade 7', NOW), days, 'accepts a labelled grade')
})

test('the win-back threshold fires on the CROSSING, not on every day under 30', () => {
  assert.equal(crossedWinBackThreshold(31, 30), true)
  assert.equal(crossedWinBackThreshold(30, 29), false, 'already below — this would be a daily nag')
  assert.equal(crossedWinBackThreshold(null, 20), false)
  assert.equal(crossedWinBackThreshold(40, null), false)
})

// ── Downgrade keeps what the learner earned ─────────────────────────────
section('downgrade')

test('ACCEPTANCE 7 — month → free preserves streak, XP, badges, downloads and history', () => {
  const earned = {
    currentStreak: 12,
    longestStreak: 30,
    xp: 4820,
    badges: ['first-quiz', 'week-warrior'],
    offlinePapers: ['p1', 'p2'],
    quizHistory: ['r1', 'r2', 'r3'],
  }
  const paid = {
    role: 'learner', isMinor: false, premium: true, subscriptionPlan: 'monthly',
    subscriptionExpiry: new Date(NOW.getTime() + 10 * DAY),
    ...earned,
  }
  const lapsed = {
    ...paid,
    premium: false,
    subscriptionExpiry: new Date(NOW.getTime() - 10 * DAY),
  }

  const before = resolvePlanState(paid, { now: NOW })
  const after = resolvePlanState(lapsed, { now: NOW })
  assert.equal(before.unlocked, true)
  assert.equal(after.status, PLAN_STATUS.EXPIRED)
  assert.equal(after.unlocked, false)

  // The resolver is pure — it derives a view and never edits the profile it
  // was handed. This is the mechanism by which nothing is taken away: there is
  // no downgrade *action* to forget to make safe.
  for (const [key, value] of Object.entries(earned)) {
    assert.deepEqual(lapsed[key], value, `${key} must survive the transition to free`)
  }
  // And the derived state carries no instruction to clear anything.
  for (const key of Object.keys(earned)) {
    assert.equal(key in after, false, `plan state must not restate ${key}`)
  }
})

test('ACCEPTANCE 7 — nothing in the codebase clears progress alongside a plan write', async () => {
  // The structural half. A behaviour test can only prove the resolver is
  // harmless; this proves no OTHER module quietly zeroes a learner's earned
  // progress on a downgrade — which is the way this promise would actually be
  // broken, months from now, by a well-meaning "clean up expired accounts"
  // script.
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')

  const PROGRESS_FIELDS = ['currentStreak', 'longestStreak', 'xp', 'badges', 'quizHistory']
  // A write that sets one of those to a falsy/empty value.
  const CLEARING = new RegExp(
    `(${PROGRESS_FIELDS.join('|')})\\s*:\\s*(0|null|\\[\\]|false|deleteField\\(\\))`,
  )
  const offenders = []
  let scanned = 0

  // `withFileTypes` rather than a readdir followed by a statSync on each name:
  // the entry type comes back from the SAME directory read, so there is no
  // window between deciding a path is a file and opening it. CodeQL flags the
  // check-then-use shape (js/file-system-race) and is right to — a scan that
  // walks the whole tree is exactly where a path can change underneath you.
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.isFile()) continue
      if (!/\.(js|jsx|mjs)$/.test(name)) continue
      if (/\.(test|spec)\./.test(name)) continue
      scanned += 1
      const text = readFileSync(full, 'utf8')
      // Only where a plan/expiry write is in the same file — a legitimate
      // "reset my stats" feature the user asked for is not this.
      if (!/subscriptionExpiry|subscriptionPlan|teacherPlanExpiresAt/.test(text)) continue
      for (const line of text.split('\n')) {
        if (CLEARING.test(line)) offenders.push(`${full}: ${line.trim()}`)
      }
    }
  }
  walk('src')
  walk('functions')

  // A scanner that walks nothing reports clean, and "no offenders" then means
  // "no evidence" rather than "no problem". `isFile()` skips symlinks, which
  // the old statSync followed, so the floor is also what would catch a future
  // tree layout this walk silently stops seeing. The number is a floor, not a
  // pin — it only has to be high enough that an empty or collapsed walk fails.
  assert.ok(
    scanned > 500,
    `the progress-clearing scan only reached ${scanned} files — it is not looking at the codebase`,
  )

  assert.deepEqual(
    offenders, [],
    `a plan/expiry write must not clear earned progress:\n${offenders.join('\n')}`,
  )
})

// ── The server's copy of the exam date ──────────────────────────────────
section('exam date mirror')

test('the server mirror equals the seeded ECZ timetable date', async () => {
  // functions/ holds its own copy so a Cloud Function does not pull the whole
  // client timetable module in for one date — the same trade functions/plans.js
  // and functions/attendance/moeTermData.js already make. A mirror in this repo
  // carries a test, because the failure is silent: a guardian message counting
  // down to the wrong day looks exactly like one counting down to the right day.
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const server = require('../functions/guardianUnlock/examCountdown.js')
  const { GRADE7_ECZ_EXAM_START } = await import('../src/config/examDates.js')
  assert.equal(
    server.GRADE7_ECZ_EXAM_START, GRADE7_ECZ_EXAM_START,
    'functions/guardianUnlock/examCountdown.js has drifted from PSLE_2026.startsAt',
  )
  // …and the two agree on the answer, not merely on the string.
  assert.equal(server.daysToExam(7, NOW), daysToExam(7, NOW))
  assert.equal(server.daysToExam(7, new Date('2027-01-01')), null)
})

await runQueue()

// A file that queued nothing would print "All tests passed" having run none.
if (queue.filter((q) => q.kind === 'test').length === 0) {
  console.error('\nno tests were queued — the runner is not running anything')
  process.exit(1)
}

console.log(failures === 0 ? '\nAll entitlements tests passed.' : `\n${failures} failing`)
process.exit(failures === 0 ? 0 : 1)
