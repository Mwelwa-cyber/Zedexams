/**
 * analyticsPolicy — the children's-privacy gate on product analytics.
 *
 * These assertions exist to make one sentence in the Privacy Policy §4
 * ("Learner accounts are excluded from session replay, and analytics for
 * learners is limited to anonymised usage counts") a statement about the
 * code rather than about our intentions. If a change here goes green, the
 * policy is still true; if it goes red, either the code or the policy has
 * to move.
 *
 * Plain `node` script (repo convention). Run: node src/utils/analyticsPolicy.test.js
 */

import assert from 'node:assert/strict'
import {
  FULL_POLICY,
  MINIMISED_POLICY,
  OBSERVABLE_ROLES,
  isMinimisedRole,
  resolveAnalyticsPolicy,
} from './analyticsPolicy.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('analyticsPolicy')

// ── The rule the policy states outright ───────────────────────────────────
test('a learner is never identified, never recorded, never geolocated', () => {
  const p = resolveAnalyticsPolicy('learner')
  assert.equal(p.identify, false, 'learner must not be identified to PostHog')
  assert.equal(p.sessionRecording, false, 'learner must not be session-recorded')
  assert.equal(p.geoip, false, 'learner IP must not be geolocated')
})

test('a learner is not heatmapped and is never shown a survey', () => {
  // "Session replay" is the headline recorder but not the only one. Heatmaps
  // buffer the pointer coordinate of every click and rageclick against the URL
  // it happened on; a survey asks a child a question and stores the free-text
  // answer. Both are separate PostHog subsystems that default to the PROJECT's
  // setting when the client says nothing, and this project has both enabled —
  // so leaving either out of the policy leaves it ON for every learner.
  const p = resolveAnalyticsPolicy('learner')
  assert.equal(p.heatmaps, false, 'learner clicks must not be heatmapped')
  assert.equal(p.surveys, false, 'learner must not be surveyed')
})

test('every observation switch is off in the minimised treatment', () => {
  // The guard against the next switch being added to FULL and forgotten in
  // MINIMISED. `capture` is the one deliberate exception — §4 permits
  // anonymised usage counts — so it is named here rather than inferred.
  const ALLOWED_WHEN_MINIMISED = new Set(['capture'])
  for (const [key, value] of Object.entries(MINIMISED_POLICY)) {
    if (ALLOWED_WHEN_MINIMISED.has(key)) continue
    assert.equal(value, false, `${key} must be off for a minimised role`)
  }
  // ...and the two objects must describe the same set of switches, or a key
  // present only in FULL is one no minimised role is ever protected from.
  assert.deepEqual(
    Object.keys(MINIMISED_POLICY).sort(),
    Object.keys(FULL_POLICY).sort(),
    'MINIMISED and FULL must declare the same switches',
  )
})

test('a learner still contributes anonymous usage counts', () => {
  // §4 permits "anonymised usage counts" — the minimised treatment is a
  // narrowing, not a total blackout. If this flips to false the product
  // loses its learner funnel entirely, which is a decision, not a detail.
  assert.equal(resolveAnalyticsPolicy('learner').capture, true)
})

// ── The default, which is the part that is easy to get wrong ──────────────
test('an unknown role is minimised, not observed', () => {
  // A role nobody has classified yet must fail towards privacy. The
  // allow-list makes this structural rather than a forgotten branch.
  for (const role of ['parent', 'schoolAdmin', 'guest', '', 'LEARNER', 'Teacher']) {
    assert.deepEqual(
      resolveAnalyticsPolicy(role),
      MINIMISED_POLICY,
      `unrecognised role ${JSON.stringify(role)} must be minimised`,
    )
  }
})

test('a session with no role yet is minimised', () => {
  // This is the window between PostHog initialising and AuthContext
  // resolving the profile — the landing page, /login, /register. A child
  // types on those screens, so it must be closed by default rather than
  // tightened afterwards: a recording that is stopped has already been made.
  for (const role of [null, undefined, 0, false, {}, []]) {
    assert.deepEqual(resolveAnalyticsPolicy(role), MINIMISED_POLICY)
  }
})

test('the parent role is minimised because the screen holds learner data', () => {
  assert.equal(OBSERVABLE_ROLES.includes('parent'), false)
  assert.equal(isMinimisedRole('parent'), true)
})

// ── The roles we do observe ───────────────────────────────────────────────
test('teachers and admins are observed in full', () => {
  for (const role of ['teacher', 'admin', 'superAdmin']) {
    assert.deepEqual(
      resolveAnalyticsPolicy(role),
      FULL_POLICY,
      `${role} should be observable in full`,
    )
    assert.equal(isMinimisedRole(role), false)
  }
})

test('surrounding whitespace on a role does not change the treatment', () => {
  // Roles arrive from a Firestore document, not a constant. A stray space
  // must not silently demote a teacher (or, worse, promote anything).
  assert.deepEqual(resolveAnalyticsPolicy('  teacher '), FULL_POLICY)
  assert.deepEqual(resolveAnalyticsPolicy(' learner '), MINIMISED_POLICY)
})

// ── The shared objects must not be mutable ────────────────────────────────
test('a caller cannot widen the policy for everyone else', () => {
  // resolveAnalyticsPolicy hands back a shared frozen object. If it were
  // mutable, one call site flipping a flag would re-treat every subsequent
  // learner on the page.
  const p = resolveAnalyticsPolicy('learner')
  assert.throws(() => { 'use strict'; p.sessionRecording = true }, TypeError)
  assert.equal(resolveAnalyticsPolicy('learner').sessionRecording, false)
  assert.equal(Object.isFrozen(OBSERVABLE_ROLES), true)
})

console.log(`\nanalyticsPolicy: ${passed} passed`)
