/**
 * Session-restoration watchdog recovery policy.
 *
 * Guards the fix for Sentry PYTHON-K (`Error: Database is closing/hidden`):
 * Firebase Auth's IndexedDB persistence closes its DB on `visibilitychange →
 * hidden` and refuses to retry, so a tab hidden mid-initialisation leaves
 * `_initializationPromise` rejected and `_isInitialized` false for the life of
 * the page. `onAuthStateChanged` then never fires, the watchdog drops the
 * loading gate, and ProtectedRoute reads `loading === false && !currentUser`
 * as signed-out — logging out a user whose session was perfectly valid.
 *
 * The property under test is the decision table, plus the two directions the
 * termination argument depends on.
 */

import assert from 'node:assert/strict'
import {
  decideAuthInitRecovery,
  readRecoveryAttempted,
  markRecoveryAttempted,
  clearRecoveryAttempted,
  shouldFastRecover,
  planSessionRescue,
  readRescueAttempts,
  recordRescueAttempt,
  clearRescueAttempts,
  AUTH_INIT_RECOVERY_KEY,
  AUTH_SESSION_RESCUE_KEY,
  SESSION_RESCUE_DELAYS_MS,
  REVEAL,
  RELOAD,
  DEFER,
} from '../src/hooks/authInitRecoveryPolicy.js'

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

/** Minimal sessionStorage stand-in. `mode` forces the failure paths. */
function makeStorage(mode = 'ok') {
  const map = new Map()
  return {
    getItem(k) {
      if (mode === 'throw-read') throw new Error('SecurityError')
      return map.has(k) ? map.get(k) : null
    },
    setItem(k, v) {
      if (mode === 'throw-write') throw new Error('QuotaExceededError')
      map.set(k, String(v))
    },
    removeItem(k) {
      if (mode === 'throw-remove') throw new Error('SecurityError')
      map.delete(k)
    },
    _raw: map,
  }
}

console.log('\nauth init recovery — decision table')

test('a signed-out visitor is revealed, never reloaded', () => {
  assert.equal(
    decideAuthInitRecovery({ hasHint: false, recoveryAttempted: false, documentHidden: false }),
    REVEAL,
  )
  // Even hidden: there is no session to rescue, so a reload buys nothing.
  assert.equal(
    decideAuthInitRecovery({ hasHint: false, recoveryAttempted: false, documentHidden: true }),
    REVEAL,
  )
})

test('a hinted device on a visible page reloads to re-drive auth init', () => {
  assert.equal(
    decideAuthInitRecovery({ hasHint: true, recoveryAttempted: false, documentHidden: false }),
    RELOAD,
  )
})

test('a hinted device on a HIDDEN page defers instead of reloading', () => {
  // Hiding is what breaks initialisation, so reloading while hidden re-runs it
  // in exactly the conditions that caused the failure.
  assert.equal(
    decideAuthInitRecovery({ hasHint: true, recoveryAttempted: false, documentHidden: true }),
    DEFER,
  )
})

test('the reload is spent only once — a second failure reveals', () => {
  assert.equal(
    decideAuthInitRecovery({ hasHint: true, recoveryAttempted: true, documentHidden: false }),
    REVEAL,
  )
  assert.equal(
    decideAuthInitRecovery({ hasHint: true, recoveryAttempted: true, documentHidden: true }),
    REVEAL,
  )
})

console.log('\nauth init recovery — termination guards')

test('an unreadable storage reports "attempted", so it cannot reload', () => {
  // Fails closed: a reload we cannot record is one we cannot bound.
  assert.equal(readRecoveryAttempted(makeStorage('throw-read')), true)
  assert.equal(readRecoveryAttempted(null), true)
  assert.equal(readRecoveryAttempted(undefined), true)
})

test('an unwritable storage refuses the attempt, so the caller reveals', () => {
  assert.equal(markRecoveryAttempted(makeStorage('throw-write')), false)
  assert.equal(markRecoveryAttempted(null), false)
})

test('a healthy storage round-trips the attempt flag', () => {
  const storage = makeStorage()
  assert.equal(readRecoveryAttempted(storage), false)
  assert.equal(markRecoveryAttempted(storage), true)
  assert.equal(storage._raw.get(AUTH_INIT_RECOVERY_KEY), '1')
  assert.equal(readRecoveryAttempted(storage), true)
  clearRecoveryAttempted(storage)
  assert.equal(readRecoveryAttempted(storage), false)
})

test('clearing never throws, whatever the storage does', () => {
  assert.doesNotThrow(() => clearRecoveryAttempted(makeStorage('throw-remove')))
  assert.doesNotThrow(() => clearRecoveryAttempted(null))
})

console.log('\nauth init recovery — the loop the guards prevent')

test('a persistently failing device reloads exactly once', () => {
  const storage = makeStorage()
  let reloads = 0
  // Simulate five successive watchdog fires with auth never initialising.
  for (let i = 0; i < 5; i++) {
    const action = decideAuthInitRecovery({
      hasHint: true,
      recoveryAttempted: readRecoveryAttempted(storage),
      documentHidden: false,
    })
    if (action === RELOAD && markRecoveryAttempted(storage)) reloads++
  }
  assert.equal(reloads, 1, 'the watchdog must not reload more than once per episode')
})

test('a recovered session gets its reload back for a later episode', () => {
  const storage = makeStorage()
  assert.equal(markRecoveryAttempted(storage), true)
  // onAuthStateChanged fires → episode over.
  clearRecoveryAttempted(storage)
  assert.equal(
    decideAuthInitRecovery({
      hasHint: true,
      recoveryAttempted: readRecoveryAttempted(storage),
      documentHidden: false,
    }),
    RELOAD,
  )
})

console.log('\nauth init recovery — the fast path')

test('all three preconditions together make a rejection actionable', () => {
  assert.equal(
    shouldFastRecover({ hasHint: true, authUnresolved: true, hidDuringInit: true }),
    true,
  )
})

test('a rejection is ignored unless every precondition holds', () => {
  // No session to lose.
  assert.equal(shouldFastRecover({ hasHint: false, authUnresolved: true, hidDuringInit: true }), false)
  // Auth already spoke, so whatever rejected is a different problem.
  assert.equal(shouldFastRecover({ hasHint: true, authUnresolved: false, hidDuringInit: true }), false)
  // The page never hid, so this failure cannot be the hide-during-init race.
  assert.equal(shouldFastRecover({ hasHint: true, authUnresolved: true, hidDuringInit: false }), false)
})

test('it is a pure precondition test — no message matching', () => {
  // The guard against binding to one SDK version's wording: the decision must
  // not consult an error at all, so a reworded Firebase message cannot silently
  // switch the detector off.
  assert.equal(shouldFastRecover.length, 1, 'takes only the precondition object')
  const src = shouldFastRecover.toString()
  assert.ok(!/Database|closing|hidden'/.test(src), 'must not match on the error text')
})

test('a missing precondition object never throws', () => {
  assert.equal(shouldFastRecover({}), false)
})

/* ── The session-rescue budget ───────────────────────────────────────────────
 *
 * The regression these guard: the wedge recovery and the boot-check rescue
 * shared ONE single-use sessionStorage flag while answering two different
 * failures. The wedge reloads without `onAuthStateChanged` ever firing, and the
 * flag is only cleared from inside that callback — so it survived the reload
 * and the next boot-check failure read a spent attempt that was never its own.
 * The rescue was refused, AuthContext fell through, and `authReady` was set
 * with `currentUser === null`: a logout of a session still on disk and never
 * rejected by anyone. sessionStorage outlives a reload, so a tab that hit the
 * wedge once logged out on EVERY boot-check failure thereafter.
 */

test('the two recoveries do not share a key', () => {
  // The entire bug in one assertion. Same key → the interference is back.
  assert.notEqual(AUTH_SESSION_RESCUE_KEY, AUTH_INIT_RECOVERY_KEY)
})

test("a spent wedge reload does not spend the rescue's budget", () => {
  const storage = makeStorage()
  // Exactly the state a tab is in after the wedge recovery reloaded: the wedge
  // flag is set and, because onAuthStateChanged never fired, never cleared.
  assert.equal(markRecoveryAttempted(storage), true)
  assert.equal(readRecoveryAttempted(storage), true)
  // The rescue must still have its full budget.
  assert.equal(readRescueAttempts(storage), 0)
  assert.equal(planSessionRescue({ attempts: readRescueAttempts(storage) }).action, RELOAD)
})

test("a spent rescue does not spend the wedge's budget", () => {
  // The same interference in the other direction.
  const storage = makeStorage()
  assert.equal(recordRescueAttempt(storage, 1), true)
  assert.equal(readRecoveryAttempted(storage), false)
  assert.equal(
    decideAuthInitRecovery({
      hasHint: true,
      recoveryAttempted: readRecoveryAttempted(storage),
      documentHidden: false,
    }),
    RELOAD,
  )
})

test('the rescue ladder climbs, then stops', () => {
  const seen = []
  let attempts = 0
  for (let i = 0; i < 6; i++) {
    const plan = planSessionRescue({ attempts })
    if (plan.action === REVEAL) { seen.push('reveal'); break }
    seen.push(plan.delayMs)
    attempts = plan.attempt
  }
  // Bounded: every rung is spent, then it reveals — it cannot loop, because
  // `attempt` only ever climbs and is reset solely by an auth event that
  // settled (which requires a successful initialisation in between).
  assert.deepEqual(seen, [...SESSION_RESCUE_DELAYS_MS, 'reveal'])
})

test('each rung waits longer than the last', () => {
  // The single 1500ms attempt this replaced re-asked inside the same bad
  // window as the failure — a project-wide 429 outlives it every time.
  for (let i = 1; i < SESSION_RESCUE_DELAYS_MS.length; i++) {
    assert.ok(SESSION_RESCUE_DELAYS_MS[i] > SESSION_RESCUE_DELAYS_MS[i - 1])
  }
})

test('the rescue budget round-trips through storage', () => {
  const storage = makeStorage()
  assert.equal(readRescueAttempts(storage), 0)
  recordRescueAttempt(storage, 1)
  assert.equal(storage._raw.get(AUTH_SESSION_RESCUE_KEY), '1')
  assert.equal(readRescueAttempts(storage), 1)
  clearRescueAttempts(storage)
  assert.equal(readRescueAttempts(storage), 0)
})

test('unusable storage fails CLOSED, never into a loop', () => {
  // An attempt we cannot count is an attempt we cannot bound, so it reports the
  // budget exhausted — the same direction readRecoveryAttempted fails in.
  const exhausted = SESSION_RESCUE_DELAYS_MS.length
  assert.equal(readRescueAttempts(null), exhausted)
  assert.equal(readRescueAttempts(makeStorage('throw-read')), exhausted)
  assert.equal(planSessionRescue({ attempts: readRescueAttempts(null) }).action, REVEAL)
  // A garbage value is not a licence to reload forever either.
  const storage = makeStorage()
  storage.setItem(AUTH_SESSION_RESCUE_KEY, 'not-a-number')
  assert.equal(readRescueAttempts(storage), exhausted)
  storage.setItem(AUTH_SESSION_RESCUE_KEY, '-3')
  assert.equal(readRescueAttempts(storage), exhausted)
})

test('an unwritable attempt is never reloaded on', () => {
  assert.equal(recordRescueAttempt(makeStorage('throw-write'), 1), false)
  assert.equal(recordRescueAttempt(null, 1), false)
  assert.doesNotThrow(() => clearRescueAttempts(makeStorage('throw-remove')))
  assert.doesNotThrow(() => clearRescueAttempts(null))
})

test('a missing argument object never throws', () => {
  assert.equal(planSessionRescue().action, RELOAD)
  assert.equal(planSessionRescue({}).action, RELOAD)
})

console.log(`\n✓ auth init recovery: ${passed} tests passed\n`)
