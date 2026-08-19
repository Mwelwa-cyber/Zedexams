/**
 * test:route-404-severity
 *
 * The rule that decides which 404s get escalated. Worth pinning because every
 * way it can be wrong is quiet: escalate everything and the high-severity
 * bucket is noise again; escalate nothing and a broken learner link sits
 * unreported for a month, which is exactly how /subscription went unnoticed at
 * 4 hits over 30 days.
 */
import assert from 'node:assert/strict'
import {
  SEVERITY,
  isLearnerRole,
  isInAppReferrer,
  resolveRouteNotFoundSeverity,
} from '../src/utils/routeNotFoundSeverity.js'

const ORIGIN = 'https://zedexams.com'

// ── Both stored spellings of the learner role escalate ──────────────────
for (const role of ['learner', 'student']) {
  assert.equal(isLearnerRole(role), true, `${role} is a learner role`)
  const v = resolveRouteNotFoundSeverity({ role, path: '/subscription', origin: ORIGIN })
  assert.equal(v.severity, SEVERITY.HIGH, `${role} 404 is high severity`)
  assert.equal(v.isLearner, true)
}

// Surrounding whitespace in a stored profile must not demote the report.
assert.equal(isLearnerRole(' learner '), true)

// ── Every other role stays normal ───────────────────────────────────────
for (const role of ['teacher', 'admin', 'superAdmin', 'parent', 'anonymous', '', undefined, null]) {
  const v = resolveRouteNotFoundSeverity({ role, path: '/nope', origin: ORIGIN })
  assert.equal(v.severity, SEVERITY.NORMAL, `${String(role)} 404 is not escalated`)
  assert.equal(v.isLearner, false)
}

// ── In-app detection ────────────────────────────────────────────────────
assert.equal(isInAppReferrer('https://zedexams.com/dashboard', ORIGIN), true)
assert.equal(isInAppReferrer('https://google.com/search?q=x', ORIGIN), false)
// A typed URL has no referrer, and an unknown origin must not be guessed at.
assert.equal(isInAppReferrer('', ORIGIN), false)
assert.equal(isInAppReferrer('https://zedexams.com/x', ''), false)
// A malformed referrer must return false rather than throw — this runs inside
// an effect on the error screen, which is the worst place to raise.
assert.equal(isInAppReferrer('not a url', ORIGIN), false)

// ── The reason travels with the verdict ─────────────────────────────────
assert.equal(
  resolveRouteNotFoundSeverity({
    role: 'learner', from: `${ORIGIN}/dashboard`, origin: ORIGIN,
  }).reason,
  'learner_role_in_app_link',
)
assert.equal(
  resolveRouteNotFoundSeverity({ role: 'learner', from: '', origin: ORIGIN }).reason,
  'learner_role',
)
assert.equal(
  resolveRouteNotFoundSeverity({
    role: 'teacher', from: `${ORIGIN}/teacher`, origin: ORIGIN,
  }).reason,
  'in_app_link',
)
assert.equal(
  resolveRouteNotFoundSeverity({ role: 'teacher', from: '', origin: ORIGIN }).reason,
  'external_or_typed',
)

// ── A learner 404 escalates even without referrer evidence ──────────────
// We do not make a learner prove our link was broken before treating it so.
assert.equal(
  resolveRouteNotFoundSeverity({ role: 'learner', from: 'https://facebook.com/', origin: ORIGIN }).severity,
  SEVERITY.HIGH,
)

// ── Never throws on junk input ──────────────────────────────────────────
assert.equal(resolveRouteNotFoundSeverity().severity, SEVERITY.NORMAL)
assert.equal(resolveRouteNotFoundSeverity({}).severity, SEVERITY.NORMAL)

console.log('✓ route-not-found severity rules')
