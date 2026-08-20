/**
 * guardianConsentCore — the gate between a child and the parts of the app
 * that talk, share, or spend.
 *
 * Two failure directions, both bad and neither symmetric:
 *   • Too open — a child reaches a leaderboard with no guardian
 *     approval. That is the Families-policy violation and the DPA breach.
 *   • Too closed — the entire existing learner base is locked out by a
 *     deploy. That is a live outage for real users who did nothing wrong.
 *
 * The migration exception is where those two meet, so it gets the most tests.
 *
 * Plain `node` script. Run: node functions/shared/consent/guardianConsentCore.test.js
 */

import assert from 'node:assert/strict'
import {
  CAPABILITY,
  CONSENT_STATUS,
  GUARDIAN_CONSENT_AGE,
  ageInYears,
  canLearnerUse,
  consentTokenState,
  requiresGuardianConsent,
  resolveLearnerAccess,
} from './guardianConsentCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const NOW = new Date('2026-07-29T12:00:00Z')
const learner = (guardian, extra = {}) => ({role: 'learner', guardian, ...extra})

console.log('ageInYears')

test('computes whole years and respects the birthday boundary', () => {
  assert.equal(ageInYears('2016-07-29', NOW), 10, 'birthday today counts')
  assert.equal(ageInYears('2016-07-30', NOW), 9, 'birthday tomorrow does not')
  assert.equal(ageInYears('2008-07-30', NOW), 17, 'turns 18 tomorrow — still 17 today')
  assert.equal(ageInYears('2008-07-29', NOW), 18, 'turns 18 today')
})

test('rejects impossible and malformed dates rather than coercing them', () => {
  // `new Date('2026-02-31')` silently rolls into March. A DOB that rolls is a
  // typo, and treating it as a real date invents an age nobody entered.
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', 'yesterday', '', '29-07-2016', null, undefined, 42]) {
    assert.equal(ageInYears(bad, NOW), null, `expected null for ${JSON.stringify(bad)}`)
  }
})

test('a future date of birth is not an age', () => {
  assert.equal(ageInYears('2030-01-01', NOW), null)
})

console.log('\nrequiresGuardianConsent')

test('routes by the age of majority', () => {
  assert.equal(GUARDIAN_CONSENT_AGE, 18)
  assert.equal(requiresGuardianConsent('2016-01-01', NOW), true, '10-year-old')
  assert.equal(requiresGuardianConsent('2008-07-30', NOW), true, '17, turns 18 tomorrow')
  assert.equal(requiresGuardianConsent('2008-07-29', NOW), false, '18 today')
  assert.equal(requiresGuardianConsent('1990-01-01', NOW), false, 'adult')
})

test('an unreadable date of birth is treated as a child', () => {
  // The only way here is a tampered or broken client. In an app built for
  // nine-year-olds, "we do not know how old you are" must not resolve to
  // "adult" — that is the one wrong answer with no way back.
  for (const bad of [null, undefined, '', 'nope', '2026-02-31']) {
    assert.equal(requiresGuardianConsent(bad, NOW), true, `expected child for ${JSON.stringify(bad)}`)
  }
})

console.log('\nresolveLearnerAccess — the approved and refused states')

test('a granted minor has the full experience', () => {
  const a = resolveLearnerAccess(learner({consentStatus: 'granted'}))
  assert.equal(a.limited, false)
  for (const cap of Object.values(CAPABILITY)) {
    assert.ok(a.capabilities.includes(cap), `granted learner should keep ${cap}`)
  }
})

test('a pending minor keeps browsing and loses everything else', () => {
  const a = resolveLearnerAccess(learner({consentStatus: 'pending'}))
  assert.equal(a.limited, true)
  assert.deepEqual(a.capabilities, [CAPABILITY.BROWSE])
  // The four that matter, named individually so a future widening of the
  // limited set has to delete an assertion rather than slip through.
  assert.equal(canLearnerUse(CAPABILITY.AI_CHAT, learner({consentStatus: 'pending'})), false)
  assert.equal(canLearnerUse(CAPABILITY.SOCIAL, learner({consentStatus: 'pending'})), false)
  assert.equal(canLearnerUse(CAPABILITY.LEADERBOARD, learner({consentStatus: 'pending'})), false)
  assert.equal(canLearnerUse(CAPABILITY.PURCHASE, learner({consentStatus: 'pending'})), false)
})

test('an expired link behaves like pending but is distinguishable', () => {
  const a = resolveLearnerAccess(learner({consentStatus: 'expired'}))
  assert.equal(a.limited, true)
  assert.deepEqual(a.capabilities, [CAPABILITY.BROWSE])
  // Same capabilities, different reason — the learner needs "resend", not "wait".
  assert.equal(a.reason, 'consent-expired')
})

test('a denied account keeps nothing at all', () => {
  // The guardian was told the account is deactivated. Leaving it able to
  // browse would make that message false.
  const a = resolveLearnerAccess(learner({consentStatus: 'denied'}))
  assert.deepEqual(a.capabilities, [])
  assert.equal(canLearnerUse(CAPABILITY.BROWSE, learner({consentStatus: 'denied'})), false)
})

test('an unrecognised status is treated as pending, never as approval', () => {
  for (const status of ['approved', 'ok', 'GRANTED', 'yes', '', 42, null, {}]) {
    const a = resolveLearnerAccess(learner({consentStatus: status}))
    assert.equal(a.limited, true, `status ${JSON.stringify(status)} must not unlock`)
    assert.equal(a.capabilities.includes(CAPABILITY.AI_CHAT), false)
  }
})

console.log('\nresolveLearnerAccess — the migration exception')

test('an account predating the flow is NOT locked out by default', () => {
  // The whole live learner base is in this state on the deploy that ships
  // this. Restricting them by default would be an outage, not a safeguard.
  const a = resolveLearnerAccess(learner(null))
  assert.equal(a.limited, false)
  assert.equal(a.reason, 'migration-grace')
  assert.equal(canLearnerUse(CAPABILITY.AI_CHAT, learner(null)), true)
})

test('enforcement is one flag away, and then it really does restrict', () => {
  const a = resolveLearnerAccess(learner(null), {enforceMigration: true})
  assert.equal(a.limited, true)
  assert.equal(a.reason, 'migration-required')
  assert.deepEqual(a.capabilities, [CAPABILITY.BROWSE])
})

test('the flag does NOT rescue a pending or denied account', () => {
  // The grace period is for accounts nobody has asked yet. Someone who was
  // asked and has not answered is pending, and pending is restricted whether
  // or not migration is being enforced.
  for (const status of ['pending', 'expired', 'denied']) {
    const off = resolveLearnerAccess(learner({consentStatus: status}), {enforceMigration: false})
    assert.equal(off.limited, true, `${status} must stay limited with the flag off`)
  }
})

console.log('\nresolveLearnerAccess — who is out of scope')

test('teachers and admins are untouched', () => {
  for (const role of ['teacher', 'admin', 'superAdmin']) {
    const a = resolveLearnerAccess({role})
    assert.equal(a.limited, false)
    assert.equal(a.reason, 'not-a-learner')
  }
})

test('an adult learner needs no guardian', () => {
  const a = resolveLearnerAccess({role: 'learner', isMinor: false})
  assert.equal(a.limited, false)
  assert.equal(a.reason, 'adult-learner')
})

test('isMinor must be explicitly false to count as an adult', () => {
  // Absent, null or a truthy string must not read as "adult" — only the
  // boolean the signup flow writes does.
  for (const v of [undefined, null, 0, '', 'false', 'no']) {
    const a = resolveLearnerAccess({role: 'learner', isMinor: v, guardian: null}, {enforceMigration: true})
    assert.equal(a.limited, true, `isMinor=${JSON.stringify(v)} must not unlock the account`)
  }
})

test('a missing or malformed user is refused, not waved through', () => {
  // This happens for real: a profile read that failed, or a document still
  // being repaired by bootstrapMissingProfile. Answering "full access" would
  // make every transient Firestore hiccup an open door — and it would do so
  // with the migration flag ON, which is meant to be the strict setting.
  for (const u of [null, undefined, 'learner', 42, []]) {
    const a = resolveLearnerAccess(u, {enforceMigration: true})
    assert.equal(a.limited, true, `${JSON.stringify(u)} must not unlock`)
    assert.equal(a.capabilities.includes(CAPABILITY.AI_CHAT), false)
  }
})

test('a profile with no role, or an unknown one, is refused', () => {
  // The role check is an allow-list. "Not a learner" must not be inferred
  // from the absence of the string 'learner'.
  for (const role of [undefined, null, '', 'user', 'Learner', 'guest']) {
    const a = resolveLearnerAccess({role}, {enforceMigration: true})
    assert.equal(a.capabilities.includes(CAPABILITY.AI_CHAT), false, `role ${JSON.stringify(role)} must not unlock`)
  }
})

test('the recognised non-learner roles still pass cleanly', () => {
  for (const role of ['teacher', 'parent', 'admin', 'superAdmin']) {
    const a = resolveLearnerAccess({role}, {enforceMigration: true})
    assert.equal(a.limited, false, `${role} must not be caught by the learner gate`)
  }
})

console.log('\nconsentTokenState')

const future = new Date(NOW.getTime() + 86400000)
const past = new Date(NOW.getTime() - 1000)

test('a fresh unused token is valid', () => {
  assert.equal(consentTokenState({used: false, expiresAt: future}, NOW), 'valid')
})

test('a used token cannot be replayed', () => {
  // Checked BEFORE expiry so a second click on a still-fresh link reports
  // "already handled" rather than silently re-granting.
  assert.equal(consentTokenState({used: true, expiresAt: future}, NOW), 'used')
})

test('an expired token is refused', () => {
  assert.equal(consentTokenState({used: false, expiresAt: past}, NOW), 'expired')
  // Exactly at the boundary counts as expired — a token is not valid at the
  // instant it dies.
  assert.equal(consentTokenState({used: false, expiresAt: NOW}, NOW), 'expired')
})

test('a Firestore Timestamp is understood', () => {
  const ts = {toDate: () => future}
  assert.equal(consentTokenState({used: false, expiresAt: ts}, NOW), 'valid')
})

test('a record with no usable expiry is invalid, not eternal', () => {
  for (const record of [null, undefined, {}, {used: false}, {used: false, expiresAt: 'soon'}]) {
    assert.equal(consentTokenState(record, NOW), 'invalid')
  }
})

console.log(`\nguardianConsentCore: ${passed} passed`)
