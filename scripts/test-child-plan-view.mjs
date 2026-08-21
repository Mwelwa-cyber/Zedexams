// scripts/test-child-plan-view.mjs
//
// Pure-logic tests for what the family app says about a child's plan
// (src/features/parentPortal/lib/childPlanView.js). Run with
// `npm run test:child-plan-view`.
//
// The reported failure these are written against: a guardian paid for a
// day pass and no screen in /family said anything had happened. So the
// case that gets the most attention here is the one that used to render
// as nothing at all — a PAID child — and the property that matters most
// is that `describeChildPlan` always returns something to draw. A module
// that can return "say nothing" is a module that can reintroduce the bug.

import assert from 'node:assert/strict'
import {
  ENDING_SOON_DAYS,
  daysUntil,
  describeChildPlan,
  planLabelFor,
  planRouteFor,
  summariseFamilyPlan,
} from '../src/features/parentPortal/lib/childPlanView.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

const NOW = Date.UTC(2026, 7, 21, 9, 0)
const DAY = 86_400_000
const HOUR = 3_600_000

/**
 * A child row as `listGuardianChildren` actually sends it — four flat
 * fields, not a nested object. Building the fixture from the real
 * payload shape is the point: a test that invents its own shape passes
 * while the screen reads undefined.
 */
const paid = (over) => ({ childUid: 'kid-1', premium: true, ...over })

/* ── Every child gets a pill ───────────────────────────────────────── */

t('a plan always has something to draw', () => {
  // The bug was a state that rendered as nothing. Nothing must be
  // unreachable, including for junk input.
  for (const child of [undefined, null, {}, { premium: false }, { premium: true }, paid({})]) {
    const view = describeChildPlan(child, NOW)
    assert.ok(view && typeof view.pill === 'string' && view.pill.length > 0)
    assert.ok(typeof view.headline === 'string' && view.headline.length > 0)
    assert.ok(typeof view.cta === 'string' && view.cta.length > 0)
    assert.match(view.to, /^\/family\/plan/)
  }
})

/* ── Paid ──────────────────────────────────────────────────────────── */

t('a day pass bought this morning says so, and says when it ends', () => {
  const view = describeChildPlan(
    paid({ subscriptionPlan: 'day_pass', premiumExpiresAt: NOW + 20 * HOUR, subscriptionProvider: 'lenco' }),
    NOW,
  )
  assert.equal(view.paid, true)
  assert.equal(view.pill, 'Day pass')
  // Ceiling, not floor: twenty hours left is a day left to the person
  // holding it, and "0 days" on an account that still works reads as a bug.
  assert.equal(view.daysLeft, 1)
  assert.equal(view.headline, 'Day pass · Ends tomorrow')
  assert.match(view.detail, /Paid until 22 Aug/)
})

t('a month in hand is stated calmly; three days is a warning', () => {
  const calm = describeChildPlan(paid({ subscriptionPlan: 'monthly', premiumExpiresAt: NOW + 25 * DAY }), NOW)
  assert.equal(calm.tone, 'ok')
  assert.equal(calm.endingSoon, false)
  assert.equal(calm.cta, 'See plan')

  const soon = describeChildPlan(
    paid({ subscriptionPlan: 'weekly', premiumExpiresAt: NOW + ENDING_SOON_DAYS * DAY }),
    NOW,
  )
  assert.equal(soon.tone, 'warn')
  assert.equal(soon.endingSoon, true)
  assert.equal(soon.cta, 'See plan')
})

t('the pill names the plan and never the countdown', () => {
  // It sits beside a child's name in a list, where "2 days left" reads as
  // a fact about the child rather than about what was bought for them.
  const view = describeChildPlan(paid({ subscriptionPlan: 'term_pass', premiumExpiresAt: NOW + 2 * DAY }), NOW)
  assert.equal(view.pill, 'Term Pass')
  assert.doesNotMatch(view.pill, /day|left|ends/i)
})

t('a plan that came from the guardian’s own subscription says so', () => {
  const view = describeChildPlan(
    paid({ subscriptionPlan: 'monthly', premiumExpiresAt: NOW + 10 * DAY, subscriptionProvider: 'guardian_cascade' }),
    NOW,
  )
  assert.match(view.detail, /another child/)
})

t('a paid plan with no recorded date is still reported as on', () => {
  // The shape of an account activated before the dates were all written.
  // Thin, but true — and far better than telling a paying guardian they
  // are on the free plan.
  const view = describeChildPlan(paid({ subscriptionPlan: 'weekly', premiumExpiresAt: null }), NOW)
  assert.equal(view.paid, true)
  assert.equal(view.tone, 'ok')
  assert.equal(view.daysLeft, null)
  assert.doesNotMatch(view.detail, /undefined|NaN|Invalid/)
})

t('a paid child with no plan id recorded is still not called free', () => {
  // `premium` is the boolean the callable has always sent; the other
  // three are newer. A row carrying only the boolean must degrade to
  // "Premium" — thin, but true — never to "Free plan".
  const view = describeChildPlan({ childUid: 'k', premium: true }, NOW)
  assert.equal(view.paid, true)
  assert.equal(view.pill, 'Premium')
})

t('plan names come from subscriptionConfig, never from a raw id', () => {
  // No label table of its own — a mirror nobody guards is one that
  // drifts. And a parent must never be shown `grade7_termly`.
  assert.equal(planLabelFor('day_pass'), 'Day pass')
  assert.equal(planLabelFor('monthly'), 'Monthly')
  assert.equal(planLabelFor('some_future_bundle'), 'Premium')
  assert.equal(planLabelFor(undefined), 'Premium')
})

/* ── Free ──────────────────────────────────────────────────────────── */

t('a free child is told what free covers, not just that it is free', () => {
  const view = describeChildPlan({ childUid: 'kid-2' }, NOW)
  assert.equal(view.paid, false)
  assert.equal(view.pill, 'Free plan')
  assert.equal(view.cta, 'Unlock')
  assert.match(view.detail, /free/i)
})

t('the CTA aims at the child it is about', () => {
  assert.equal(planRouteFor('kid-2'), '/family/plan?child=kid-2')
  assert.equal(planRouteFor(''), '/family/plan')
  assert.equal(planRouteFor(null), '/family/plan')
  // A uid is never pasted raw into a URL.
  assert.equal(planRouteFor('a b&c'), '/family/plan?child=a%20b%26c')
})

/* ── Days ──────────────────────────────────────────────────────────── */

t('days round up, floor at zero, and refuse junk', () => {
  assert.equal(daysUntil(NOW + 20 * HOUR, NOW), 1)
  assert.equal(daysUntil(NOW + 25 * HOUR, NOW), 2)
  assert.equal(daysUntil(NOW - DAY, NOW), 0)
  assert.equal(daysUntil(NOW, NOW), 0)
  assert.equal(daysUntil(null, NOW), null)
  assert.equal(daysUntil(NOW, undefined), null)
})

/* ── The dashboard section ─────────────────────────────────────────── */

t('nobody linked means nothing to say', () => {
  assert.equal(summariseFamilyPlan([], NOW).show, false)
  assert.equal(summariseFamilyPlan(null, NOW).show, false)
})

t('all-paid still renders — that is the case that was invisible', () => {
  const view = summariseFamilyPlan(
    [paid({ subscriptionPlan: 'monthly', premiumExpiresAt: NOW + 20 * DAY })],
    NOW,
  )
  assert.equal(view.show, true)
  assert.equal(view.paidCount, 1)
  assert.equal(view.freeCount, 0)
  assert.match(view.lead, /Paid for/)
})

t('a mixed family is counted, never called “some”', () => {
  const view = summariseFamilyPlan([
    paid({ subscriptionPlan: 'monthly', premiumExpiresAt: NOW + 20 * DAY }),
    { childUid: 'kid-2' },
  ], NOW)
  assert.equal(view.lead, '1 of 2 unlocked.')
  assert.doesNotMatch(view.lead, /some/i)
  assert.equal(view.rows.length, 2)
  assert.equal(view.rows[0].plan.paid, true)
  assert.equal(view.rows[1].plan.paid, false)
})

t('a family whose only plan is about to end is told that, not “covered”', () => {
  const view = summariseFamilyPlan(
    [paid({ subscriptionPlan: 'day_pass', premiumExpiresAt: NOW + 6 * HOUR })],
    NOW,
  )
  assert.equal(view.endingSoonCount, 1)
  assert.match(view.lead, /about to end/)
})

t('nobody paid reads as an invitation rather than a verdict', () => {
  const one = summariseFamilyPlan([{ childUid: 'a' }], NOW)
  assert.match(one.lead, /see what a plan covers/i)
  const many = summariseFamilyPlan([{ childUid: 'a' }, { childUid: 'b' }], NOW)
  assert.match(many.lead, /None of your children/)
})

console.log(`child plan view — ${passed} groups passed`)
