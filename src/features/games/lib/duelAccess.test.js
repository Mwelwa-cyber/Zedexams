/**
 * duelAllowed — who may race Zed.
 *
 * This module deliberately fails OPEN where guardianConsentCore fails closed,
 * so the exact boundary is worth pinning: a guardian's denial and limited mode
 * must still block, and only the "we do not know yet" states may fall through.
 * Get that wrong in one direction and a parent's switch does nothing; get it
 * wrong in the other and a learner whose profile has not loaded is told their
 * guardian switched something off, which nobody did.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { duelAllowed } from './duelAccess.js'

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

console.log('\nduelAllowed')

const USER = { uid: 'learner-1' }
const APPROVED = { role: 'learner', isMinor: true, guardian: { consentStatus: 'granted' } }

test('a signed-out visitor may race', () => {
  assert.equal(duelAllowed(null, null), true)
})

test('an approved learner may race', () => {
  assert.equal(duelAllowed(USER, APPROVED), true)
})

test("a guardian's switch blocks the race", () => {
  assert.equal(duelAllowed(USER, { ...APPROVED, guardianControls: { challenges: false } }), false)
})

test('switching Ask Zed off does NOT block the race', () => {
  // Two independent controls. Taking one must not take the other.
  assert.equal(duelAllowed(USER, { ...APPROVED, guardianControls: { askZed: false } }), true)
})

test('limited mode blocks the race', () => {
  assert.equal(duelAllowed(USER, { role: 'learner', isMinor: true, guardian: { consentStatus: 'pending' } }), false)
  assert.equal(duelAllowed(USER, { role: 'learner', isMinor: true, guardian: { consentStatus: 'denied' } }), false)
})

test('an adult learner may race', () => {
  assert.equal(duelAllowed(USER, { role: 'learner', isMinor: false }), true)
})

test('a profile that has not loaded is not treated as a denial', () => {
  // The UX failure this prevents: "challenges are switched off for this
  // account" shown during a Firestore round trip, naming a decision nobody
  // made and sending the learner to a parent with nothing to turn back on.
  assert.equal(duelAllowed(USER, null), true)
  assert.equal(duelAllowed(USER, undefined), true)
  assert.equal(duelAllowed(USER, {}), true)
})

test('a profile still being repaired is not treated as a denial', () => {
  // bootstrapMissingProfile can leave a document without a role for a moment.
  assert.equal(duelAllowed(USER, { displayName: 'Mahenga', grade: 4 }), true)
})

test('a teacher or admin is never blocked', () => {
  assert.equal(duelAllowed(USER, { role: 'teacher' }), true)
  assert.equal(duelAllowed(USER, { role: 'admin' }), true)
})

test('a forged controls object cannot unlock a pending learner', () => {
  const forged = {
    role: 'learner',
    isMinor: true,
    guardian: { consentStatus: 'pending' },
    guardianControls: { challenges: true, social: true },
  }
  assert.equal(duelAllowed(USER, forged), false)
})

console.log(`\nduelAllowed: ${passed} passed`)
