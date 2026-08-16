#!/usr/bin/env node
/**
 * Tests for the subscription-status resolver that drives the reminder system.
 * Run: npm run test:sub-status
 */

const {
  resolveSubscriptionStatus,
  SUB_STATUS,
  AUDIENCE,
  upgradePortal,
  reminderCopy,
} = await import('../src/engines/payment-engine/subscriptionStatus.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const NOW = new Date('2026-06-16T10:00:00Z')
const future = (days) => new Date(NOW.getTime() + days * 86400000)
const past = (days) => new Date(NOW.getTime() - days * 86400000)
const resolve = (profile, audience) =>
  resolveSubscriptionStatus(profile, { audience, now: NOW })

// ── Learner ─────────────────────────────────────────────────────────────────
test('learner with no plan is Free and gets reminders', () => {
  const r = resolve({ role: 'learner', subscriptionPlan: 'free' }, AUDIENCE.LEARNER)
  assert(r.status === SUB_STATUS.FREE, `expected free, got ${r.status}`)
  assert(r.isFree && r.shouldRemind, 'free learner should be reminded')
  assert(r.planLabel === 'Free', `label ${r.planLabel}`)
})

test('learner with active premium + future expiry is Pro, no reminders', () => {
  const r = resolve({
    role: 'learner', isPremium: true, subscriptionStatus: 'active',
    subscriptionPlan: 'grade7_monthly', subscriptionExpiry: future(20),
  }, AUDIENCE.LEARNER)
  assert(r.status === SUB_STATUS.PRO, `expected pro, got ${r.status}`)
  assert(r.isPro && !r.shouldRemind, 'pro learner must NOT be reminded')
  assert(r.daysLeft === 20, `daysLeft ${r.daysLeft}`)
})

test('learner with active flags but past expiry is Expired', () => {
  const r = resolve({
    role: 'learner', isPremium: true, paymentStatus: 'active',
    subscriptionPlan: 'grade7_monthly', subscriptionExpiry: past(3),
  }, AUDIENCE.LEARNER)
  assert(r.status === SUB_STATUS.EXPIRED, `expected expired, got ${r.status}`)
  assert(r.isExpired && r.shouldRemind, 'expired learner should be reminded')
})

test('learner who paid before but flags cleared is Expired', () => {
  const r = resolve({
    role: 'learner', subscriptionPlan: 'grade7_monthly',
    subscriptionPaymentId: 'pay_123', isPremium: false,
  }, AUDIENCE.LEARNER)
  assert(r.status === SUB_STATUS.EXPIRED, `expected expired, got ${r.status}`)
})

test('learner trial flag yields Trial with access (no reminders)', () => {
  const r = resolve({
    role: 'learner', subscriptionStatus: 'trial', trialEndsAt: future(5),
  }, AUDIENCE.LEARNER)
  assert(r.status === SUB_STATUS.TRIAL, `expected trial, got ${r.status}`)
  assert(!r.shouldRemind, 'trial has access — no nag')
})

test('super-admin is always Pro', () => {
  const r = resolve({ role: 'superAdmin' }, AUDIENCE.LEARNER)
  assert(r.status === SUB_STATUS.PRO, `expected pro, got ${r.status}`)
})

test('learner benefits mention past papers, never teacher tools', () => {
  const r = resolve({ role: 'learner' }, AUDIENCE.LEARNER)
  const joined = r.benefits.join(' ').toLowerCase()
  assert(joined.includes('past paper'), 'learner benefits should mention past papers')
  assert(!joined.includes('lesson plan'), 'learner benefits must not mention lesson plans')
})

// ── Teacher ─────────────────────────────────────────────────────────────────
test('teacher with no plan is Free and gets reminders', () => {
  const r = resolve({ role: 'teacher' }, AUDIENCE.TEACHER)
  assert(r.status === SUB_STATUS.FREE, `expected free, got ${r.status}`)
  assert(r.shouldRemind, 'free teacher should be reminded')
})

test('teacher on Pro plan with future expiry is Pro, no reminders', () => {
  const r = resolve({
    role: 'teacher', teacherPlan: 'pro', teacherPlanExpiresAt: future(15),
  }, AUDIENCE.TEACHER)
  assert(r.status === SUB_STATUS.PRO, `expected pro, got ${r.status}`)
  assert(r.planLabel === 'Pro', `label ${r.planLabel}`)
  assert(!r.shouldRemind, 'pro teacher must NOT be reminded')
})

test('teacher whose Pro plan lapsed is Expired', () => {
  const r = resolve({
    role: 'teacher', teacherPlan: 'pro', teacherPlanExpiresAt: past(2),
  }, AUDIENCE.TEACHER)
  assert(r.status === SUB_STATUS.EXPIRED, `expected expired, got ${r.status}`)
  assert(r.shouldRemind, 'lapsed teacher should be reminded')
})

test('teacher benefits mention lesson plans, never past papers', () => {
  const r = resolve({ role: 'teacher' }, AUDIENCE.TEACHER)
  const joined = r.benefits.join(' ').toLowerCase()
  assert(joined.includes('lesson plan'), 'teacher benefits should mention lesson plans')
  assert(!joined.includes('past paper'), 'teacher benefits must not mention past papers')
})

// ── Audience routing + copy ─────────────────────────────────────────────────
test('learner audience falls back from role', () => {
  const r = resolveSubscriptionStatus({ role: 'learner' }, { now: NOW })
  assert(r.audience === AUDIENCE.LEARNER, `audience ${r.audience}`)
})

test('teacher audience falls back from role', () => {
  const r = resolveSubscriptionStatus({ role: 'teacher' }, { now: NOW })
  assert(r.audience === AUDIENCE.TEACHER, `audience ${r.audience}`)
})

test('upgradePortal routes audiences to the right plans', () => {
  assert(upgradePortal(AUDIENCE.TEACHER).portal === 'teacher', 'teacher portal')
  assert(upgradePortal(AUDIENCE.TEACHER).defaultPlanId === 'pro_monthly', 'teacher plan')
  assert(upgradePortal(AUDIENCE.LEARNER).portal === 'learner', 'learner portal')
  // The learner offer is now just Weekly (K15) + Monthly (K50); the generic
  // termly/yearly plans were retired. Monthly is the default (best value).
  assert(upgradePortal(AUDIENCE.LEARNER).defaultPlanId === 'monthly', 'learner plan')
  assert(
    JSON.stringify(upgradePortal(AUDIENCE.LEARNER).planIds) === JSON.stringify(['weekly', 'monthly']),
    'learner plan list should be weekly + monthly only',
  )
})

test('reminder copy is benefit-led, never "you must pay"', () => {
  for (const audience of ['learner', 'teacher']) {
    for (const status of [SUB_STATUS.FREE, SUB_STATUS.EXPIRED]) {
      const c = reminderCopy(status, audience)
      const text = `${c.title} ${c.body} ${c.cta}`.toLowerCase()
      assert(!text.includes('you must pay'), `"${status}/${audience}" should avoid "you must pay"`)
      assert(c.cta.length > 0, 'cta present')
    }
  }
  assert(reminderCopy(SUB_STATUS.EXPIRED, 'learner').badge === 'Expired Subscription', 'expired badge')
  assert(reminderCopy(SUB_STATUS.FREE, 'learner').badge === 'Free Plan', 'free badge')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
