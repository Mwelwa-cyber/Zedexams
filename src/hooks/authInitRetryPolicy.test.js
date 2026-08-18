/**
 * Node test for src/hooks/authInitRetryPolicy.js — the backoff ladder and the
 * "is this credential actually dead" classification. No React, no DOM, no
 * Firebase.
 *
 * Run: node src/hooks/authInitRetryPolicy.test.js
 */

import assert from 'node:assert/strict'
import {
  AUTH_INIT_RETRY_DELAYS_MS,
  TERMINAL_AUTH_ERROR_CODES,
  shouldClearStoredUser,
  planAuthInitAttempt,
  totalRetryWindowMs,
  RETRY,
  CLEAR,
  WEDGED,
} from './authInitRetryPolicy.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// ── The ladder itself ────────────────────────────────────────────────────
// Pinned to the exact values, because a "backoff ladder" that quietly became
// three 1-second attempts would still pass every behavioural assertion below
// while recovering none of the failures it exists for.
ok('ladder is 1s, 3s, 8s', JSON.stringify(AUTH_INIT_RETRY_DELAYS_MS) === '[1000,3000,8000]')
ok('ladder spends 12s in total', totalRetryWindowMs() === 12_000)

// ── Terminal classification ──────────────────────────────────────────────
ok('token-expired clears the stored user', shouldClearStoredUser('auth/user-token-expired'))
ok('user-disabled clears the stored user', shouldClearStoredUser('auth/user-disabled'))
ok('invalid-user-token clears the stored user', shouldClearStoredUser('auth/invalid-user-token'))
ok('exactly three codes are terminal', TERMINAL_AUTH_ERROR_CODES.length === 3)

// The whole point: these are trip failures, not credential failures, and
// clearing the user for one of them is the logout bug.
for (const code of [
  'auth/network-request-failed',
  'auth/timeout',
  'auth/too-many-requests',
  'auth/internal-error',
  'auth/web-storage-unsupported',
]) {
  ok(`${code} keeps the stored user`, !shouldClearStoredUser(code))
}
ok('an unclassifiable throw keeps the stored user', !shouldClearStoredUser(undefined))
ok('an unknown code keeps the stored user', !shouldClearStoredUser('auth/some-future-code'))
ok('null keeps the stored user', !shouldClearStoredUser(null))

// ── The ladder in motion ─────────────────────────────────────────────────
const rung0 = planAuthInitAttempt({ attempt: 0, hasHint: true })
ok('first miss retries after 1s', rung0.action === RETRY && rung0.delayMs === 1000)
ok('first miss keeps the user', rung0.keepsUser === true)
ok('first miss advances the attempt counter', rung0.attempt === 1)

const rung1 = planAuthInitAttempt({ attempt: 1, hasHint: true })
ok('second miss retries after 3s', rung1.action === RETRY && rung1.delayMs === 3000)

const rung2 = planAuthInitAttempt({ attempt: 2, hasHint: true })
ok('third miss retries after 8s', rung2.action === RETRY && rung2.delayMs === 8000)

const exhausted = planAuthInitAttempt({ attempt: 3, hasHint: true })
ok('ladder exhausted reports wedged', exhausted.action === WEDGED)
// The one that matters most: running out of attempts is not evidence the
// session is dead, so it must never be the thing that signs someone out.
ok('wedged still keeps the user', exhausted.keepsUser === true)

const beyond = planAuthInitAttempt({ attempt: 9, hasHint: true })
ok('an attempt past the ladder stays wedged', beyond.action === WEDGED && beyond.keepsUser === true)

// ── Terminal outranks the ladder ─────────────────────────────────────────
const revoked = planAuthInitAttempt({ attempt: 0, hasHint: true, errorCode: 'auth/user-token-expired' })
ok('a terminal code clears on the first attempt', revoked.action === CLEAR && revoked.keepsUser === false)
ok('a terminal code does not wait', revoked.delayMs === 0)

const revokedLate = planAuthInitAttempt({ attempt: 2, hasHint: true, errorCode: 'auth/user-disabled' })
ok('a terminal code clears mid-ladder too', revokedLate.action === CLEAR)

// A network failure at the same rung must go the other way. This pair is the
// whole regression: both are "the reload threw", and only one is a dead session.
const flaky = planAuthInitAttempt({ attempt: 0, hasHint: true, errorCode: 'auth/network-request-failed' })
ok('a network failure retries rather than clearing', flaky.action === RETRY && flaky.keepsUser === true)

// ── No hint, no ladder ───────────────────────────────────────────────────
// A signed-out visitor has no session to rescue; making them wait 12s to
// confirm that is a regression on the public pages.
const anonymous = planAuthInitAttempt({ attempt: 0, hasHint: false })
ok('no session hint skips the ladder', anonymous.action === WEDGED && anonymous.delayMs === 0)
// …but a terminal code still clears, because the hint may simply have been
// evicted while the stored user survived.
const anonRevoked = planAuthInitAttempt({ attempt: 0, hasHint: false, errorCode: 'auth/invalid-user-token' })
ok('no hint + terminal code still clears', anonRevoked.action === CLEAR)

// ── Injectable ladder ────────────────────────────────────────────────────
const custom = planAuthInitAttempt({ attempt: 0, hasHint: true, delays: [5] })
ok('a custom ladder is honoured', custom.action === RETRY && custom.delayMs === 5)
ok('a custom ladder terminates', planAuthInitAttempt({ attempt: 1, hasHint: true, delays: [5] }).action === WEDGED)

console.log(`\nauthInitRetryPolicy: ${passed} assertions passed`)
