// The entitlement cascade: a paid plan on a guardian unlocks every learner
// linked to them (functions/guardianEntitlement.js).
//
// Plain `node` assertion script (see CLAUDE.md "Two test suites").
//
// The decision is pure, so the rules a family would actually dispute are
// arithmetic here rather than a sequence of emulator writes with real
// money-shaped side effects. Four of them are load-bearing:
//
//   • a purchase never SHORTENS a plan the child already holds
//   • a suspended or guardian-denied account is not unlocked by money
//   • a lifetime grant is left alone
//   • unlinking later does not revoke — which this file pins by
//     construction, since the grant is a plain expiry on the child

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { decideCascade, toMillis, MAX_CASCADE } = require('../functions/guardianEntitlement.js')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000
const BOUGHT = NOW + 30 * DAY

console.log('\ndecideCascade — who gets the plan')

test('a learner with no plan is granted one', () => {
  const v = decideCascade({ learner: { role: 'learner' }, expiryMs: BOUGHT, planId: 'learner_monthly' })
  assert.equal(v.grant, true)
  assert.equal(v.reason, 'new')
  assert.equal(v.expiryMs, BOUGHT)
})

test('a learner whose plan expires SOONER is extended', () => {
  const v = decideCascade({
    learner: { subscriptionExpiry: NOW + 5 * DAY },
    expiryMs: BOUGHT,
    planId: 'learner_monthly',
  })
  assert.equal(v.grant, true)
  assert.equal(v.reason, 'extended')
})

test("a purchase never shortens a plan the child already holds", () => {
  // The failure this exists to stop: the other parent paid for three
  // months in January, this parent renews in February, and the cascade
  // silently writes a nearer date over the term somebody else bought.
  const v = decideCascade({
    learner: { subscriptionExpiry: NOW + 90 * DAY },
    expiryMs: BOUGHT,
    planId: 'learner_monthly',
  })
  assert.equal(v.grant, false)
  assert.equal(v.reason, 'already-longer')
})

test('an identical expiry is a no-op rather than a rewrite', () => {
  const v = decideCascade({ learner: { subscriptionExpiry: BOUGHT }, expiryMs: BOUGHT, planId: 'p' })
  assert.equal(v.grant, false)
})

test('a lifetime grant is left alone', () => {
  const v = decideCascade({ learner: { subscriptionLifetime: true }, expiryMs: BOUGHT, planId: 'p' })
  assert.equal(v.grant, false)
  assert.equal(v.reason, 'already-lifetime')
})

test('a suspended account is not unlocked by somebody paying', () => {
  const v = decideCascade({ learner: { status: 'suspended' }, expiryMs: BOUGHT, planId: 'p' })
  assert.equal(v.grant, false)
  assert.equal(v.reason, 'not-active')
})

test('money does not overturn a guardian who denied the account', () => {
  // `denied` suspends an account pending deletion at a guardian's request.
  // A second adult paying must not reinstate it — only the guardian who
  // denied it can.
  const v = decideCascade({
    learner: { guardian: { consentStatus: 'denied' } },
    expiryMs: BOUGHT,
    planId: 'p',
  })
  assert.equal(v.grant, false)
  assert.equal(v.reason, 'guardian-denied')
})

test('an unreadable expiry grants nothing rather than granting forever', () => {
  for (const bad of [undefined, null, NaN, 'soon', Infinity]) {
    assert.equal(decideCascade({ learner: {}, expiryMs: bad, planId: 'p' }).grant, false)
  }
})

test('a missing learner document grants nothing', () => {
  assert.equal(decideCascade({ learner: null, expiryMs: BOUGHT, planId: 'p' }).grant, false)
})

console.log('\nunlinking does not revoke')

test('the grant is a plain expiry on the CHILD, so removing a guardian cannot cancel it', () => {
  // Rule 4, pinned structurally rather than by comment. The decision
  // returns an expiry and nothing that references the guardian's own
  // subscription — so there is no field for a later unlink to invalidate,
  // and a child cannot lose the term they were paid for over an adult's
  // admin. If a future change made the grant conditional on the link, this
  // assertion is what would have to be deleted to do it.
  const v = decideCascade({ learner: {}, expiryMs: BOUGHT, planId: 'learner_monthly' })
  assert.equal(v.grant, true)
  assert.equal(typeof v.expiryMs, 'number')
  assert.ok(!('guardianUid' in v), 'the grant must not depend on the link surviving')
  assert.ok(!('linkId' in v))
})

console.log('\ntoMillis — every shape Firestore hands back')

test('Timestamps, Dates, ISO strings and numbers all read', () => {
  assert.equal(toMillis({ toMillis: () => NOW }), NOW)
  assert.equal(toMillis({ toDate: () => new Date(NOW) }), NOW)
  assert.equal(toMillis(new Date(NOW)), NOW)
  assert.equal(toMillis(NOW), NOW)
  assert.equal(toMillis('2023-11-14T22:13:20.000Z'), NOW)
})

test('anything unreadable is null, never zero', () => {
  // Zero would sort as the beginning of time and read as "expired long
  // ago", which in decideCascade's comparison silently becomes "grant".
  for (const bad of [null, undefined, 'never', {}, NaN, new Date('nope')]) {
    assert.equal(toMillis(bad), null)
  }
})

console.log('\nbounds')

test('the cascade is bounded, so one guardian cannot fan out unboundedly', () => {
  assert.ok(Number.isInteger(MAX_CASCADE) && MAX_CASCADE > 0 && MAX_CASCADE <= 50)
})

console.log(`\n${passed} guardian-entitlement assertions passed`)
