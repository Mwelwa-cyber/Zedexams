// Regression tests for the teacher-plan resolution that drives the dashboard
// "Current plan" stat and the UsageMeter widget.
//
// The bug this guards against: the dashboard banner read the learner-style
// isPremium flag while the usage meter read the stale usageMeters snapshot, so
// a teacher who paid for Pro could see "Pro" in the banner but free-tier caps,
// locked Pro tools and a "Free" chip in the meter. Both surfaces now resolve
// the LIVE teacher plan from the profile via src/engines/payment-engine/teacherPlans.js, using
// the same logic + limits the server gates on.
//
// Run: node scripts/test-teacher-plan-resolution.mjs

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  resolveTeacherPlan,
  normalizeTeacherPlan,
  PLAN_LIMITS,
  PLAN_LABELS,
  DAILY_LIMITS,
  FREE_PREVIEW_LIMITS,
  PLAN_CATALOG_VERSION,
  TEACHER_TRIAL_DAYS,
} = await import('../src/engines/payment-engine/teacherPlans.js')

// Server-side catalogue the client mirror must stay in sync with.
const server = require('../functions/teacherTools/teacherPlans.js')

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

// ── resolveTeacherPlan ────────────────────────────────────────────────────
test('no profile resolves to free', () => {
  assert.equal(resolveTeacherPlan(null), 'free')
  assert.equal(resolveTeacherPlan(undefined), 'free')
  assert.equal(resolveTeacherPlan({}), 'free')
})

test('canonical pro / max resolve as-is', () => {
  assert.equal(resolveTeacherPlan({ teacherPlan: 'pro' }), 'pro')
  assert.equal(resolveTeacherPlan({ teacherPlan: 'max' }), 'max')
})

test('legacy individual / school ids still map to pro / max', () => {
  assert.equal(resolveTeacherPlan({ teacherPlan: 'individual' }), 'pro')
  assert.equal(resolveTeacherPlan({ teacherPlan: 'school' }), 'max')
})

test('unknown teacherPlan value falls back to free', () => {
  assert.equal(resolveTeacherPlan({ teacherPlan: 'platinum' }), 'free')
  assert.equal(resolveTeacherPlan({ teacherPlan: 42 }), 'free')
})

test('a premium learner with no teacher plan is NOT Pro (the reported bug)', () => {
  // This is exactly the screenshot: premium flags set, but teacherPlan unset.
  // The banner used to read isPremium and falsely showed "Pro".
  const premiumLearner = {
    premium: true,
    isPremium: true,
    paymentStatus: 'active',
    subscriptionStatus: 'active',
    subscriptionPlan: 'monthly',
  }
  assert.equal(resolveTeacherPlan(premiumLearner), 'free')
})

test('expired teacherPlanExpiresAt downgrades to free', () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
  assert.equal(resolveTeacherPlan({ teacherPlan: 'pro', teacherPlanExpiresAt: past }), 'free')
  // Firestore Timestamp-like shape (has toDate()).
  assert.equal(
    resolveTeacherPlan({ teacherPlan: 'pro', teacherPlanExpiresAt: { toDate: () => past } }),
    'free',
  )
})

test('future teacherPlanExpiresAt keeps the plan active', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
  assert.equal(resolveTeacherPlan({ teacherPlan: 'pro', teacherPlanExpiresAt: future }), 'pro')
})

test('super admins resolve to max regardless of teacherPlan / expiry', () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
  assert.equal(resolveTeacherPlan({ role: 'admin' }), 'max')
  assert.equal(resolveTeacherPlan({ role: 'superAdmin', teacherPlan: 'free' }), 'max')
  assert.equal(resolveTeacherPlan({ role: 'admin', teacherPlanExpiresAt: past }), 'max')
})

// ── the free teacher trial ────────────────────────────────────────────────
test('an active trial resolves to trial (Pro-tier limits)', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
  assert.equal(resolveTeacherPlan({ teacherPlan: 'trial', teacherTrialEndsAt: future }), 'trial')
})

test('a lapsed trial falls back to free — never to pro/max', () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
  assert.equal(resolveTeacherPlan({ teacherPlan: 'trial', teacherTrialEndsAt: past }), 'free')
  // Firestore Timestamp-like shape.
  assert.equal(
    resolveTeacherPlan({ teacherPlan: 'trial', teacherTrialEndsAt: { toDate: () => past } }),
    'free',
  )
})

test('a trial with no teacherTrialEndsAt stamped at all is free, not indefinitely trial', () => {
  assert.equal(resolveTeacherPlan({ teacherPlan: 'trial' }), 'free')
})

test('PLAN_LIMITS.trial is a plain alias of PLAN_LIMITS.pro (never a diverging copy)', () => {
  assert.equal(PLAN_LIMITS.trial, PLAN_LIMITS.pro)
  assert.equal(server.PLAN_LIMITS.trial, server.PLAN_LIMITS.pro)
})

test('TEACHER_TRIAL_DAYS matches the server', () => {
  assert.equal(TEACHER_TRIAL_DAYS, server.TEACHER_TRIAL_DAYS)
})

// ── normalizeTeacherPlan parity with the server ───────────────────────────
test('normalizeTeacherPlan matches the server for every relevant input', () => {
  for (const raw of ['free', 'pro', 'max', 'individual', 'school', 'nope', '', null, 7]) {
    assert.equal(normalizeTeacherPlan(raw), server.normalizeTeacherPlan(raw), `input=${raw}`)
  }
})

// ── client mirror stays in sync with the server catalogue ─────────────────
test('client PLAN_LIMITS deep-equals the server PLAN_LIMITS', () => {
  assert.deepEqual(PLAN_LIMITS, server.PLAN_LIMITS)
})

test('client PLAN_LABELS and DAILY_LIMITS match the server', () => {
  assert.deepEqual(PLAN_LABELS, server.PLAN_LABELS)
  assert.deepEqual(DAILY_LIMITS, server.DAILY_LIMITS)
})

test('client FREE_PREVIEW_LIMITS deep-equals the server', () => {
  assert.deepEqual(FREE_PREVIEW_LIMITS, server.FREE_PREVIEW_LIMITS)
})

test('client PLAN_CATALOG_VERSION matches the server', () => {
  assert.equal(PLAN_CATALOG_VERSION, server.PLAN_CATALOG_VERSION)
})

console.log(`\nteacher-plan-resolution: ${passed} tests passed`)
