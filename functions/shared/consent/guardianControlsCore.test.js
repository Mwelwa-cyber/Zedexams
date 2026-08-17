/**
 * guardianControlsCore — the rules a guardian's switches obey.
 *
 * The property this file exists to hold is the one in the module header:
 * controls NARROW and never widen. Everything else here is detail; that one
 * is the safety guarantee, so it is tested against hostile input rather than
 * against the shapes the UI happens to produce.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  GUARDIAN_CONTROL,
  DAILY_LIMIT_OPTIONS,
  PIN_MAX_ATTEMPTS,
  PIN_LOCKOUT_MS,
  normalizeGuardianControls,
  hasGuardianRestrictions,
  narrowCapabilities,
  isWellFormedGuardianPin,
  isWellFormedSetupCode,
  guardianPinAttemptState,
  guardianPinFailure,
  guardianPinSuccess,
  setupCodeState,
} from './guardianControlsCore.js'
import { CAPABILITY, resolveLearnerAccess, canLearnerUse } from './guardianConsentCore.js'

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

const MAP = { aiChat: CAPABILITY.AI_CHAT, social: CAPABILITY.SOCIAL }
const ALL = [CAPABILITY.BROWSE, CAPABILITY.AI_CHAT, CAPABILITY.SOCIAL, CAPABILITY.LEADERBOARD]

// ── normalize ─────────────────────────────────────────────────────────────

test('absent controls narrow nothing', () => {
  for (const raw of [undefined, null, {}, 'nonsense', 42, []]) {
    const c = normalizeGuardianControls(raw)
    assert.equal(c.askZed, true, `askZed for ${JSON.stringify(raw)}`)
    assert.equal(c.challenges, true)
    assert.equal(c.dailyLimitMinutes, null)
  }
})

test('only an explicit false is a denial', () => {
  // A missing field, a null, an empty string and the string "false" are all
  // things a half-written document produces. None of them may switch a
  // capability off — a guardian denial has to be a guardian's decision.
  assert.equal(normalizeGuardianControls({ askZed: null }).askZed, true)
  assert.equal(normalizeGuardianControls({ askZed: 0 }).askZed, true)
  assert.equal(normalizeGuardianControls({ askZed: 'false' }).askZed, true)
  assert.equal(normalizeGuardianControls({ askZed: false }).askZed, false)
})

test('the daily limit snaps to an offered option or to none', () => {
  assert.equal(normalizeGuardianControls({ dailyLimitMinutes: 60 }).dailyLimitMinutes, 60)
  assert.equal(normalizeGuardianControls({ dailyLimitMinutes: '90' }).dailyLimitMinutes, 90)
  assert.equal(normalizeGuardianControls({ dailyLimitMinutes: 47 }).dailyLimitMinutes, null)
  assert.equal(normalizeGuardianControls({ dailyLimitMinutes: -30 }).dailyLimitMinutes, null)
  assert.equal(normalizeGuardianControls({ dailyLimitMinutes: 'soon' }).dailyLimitMinutes, null)
  assert.ok(DAILY_LIMIT_OPTIONS.includes(null), 'no-limit must be an offered option')
})

test('hasGuardianRestrictions ignores the advisory time limit', () => {
  // A time limit is a nudge, not a capability. Reporting it as a restriction
  // would make the child's app claim a capability was taken away when none was.
  assert.equal(hasGuardianRestrictions({ dailyLimitMinutes: 60 }), false)
  assert.equal(hasGuardianRestrictions({ askZed: false }), true)
  assert.equal(hasGuardianRestrictions({ challenges: false }), true)
  assert.equal(hasGuardianRestrictions(null), false)
})

// ── the narrowing property ────────────────────────────────────────────────

test('narrowCapabilities removes what the guardian switched off', () => {
  const out = narrowCapabilities(ALL, { askZed: false }, MAP)
  assert.ok(!out.includes(CAPABILITY.AI_CHAT))
  assert.ok(out.includes(CAPABILITY.SOCIAL))
  assert.ok(out.includes(CAPABILITY.BROWSE))
})

test('narrowCapabilities can NEVER add a capability', () => {
  // The hostile case: a controls object that says "yes" to everything,
  // handed a limited capability list. It must not produce AI_CHAT.
  const limited = [CAPABILITY.BROWSE]
  const forged = { askZed: true, challenges: true, aiChat: true, capabilities: ALL, grant: 'all' }
  const out = narrowCapabilities(limited, forged, MAP)
  assert.deepEqual([...out], [CAPABILITY.BROWSE])
  for (const cap of out) {
    assert.ok(limited.includes(cap), `${cap} appeared from nowhere`)
  }
})

test('narrowCapabilities is a subset for every input shape', () => {
  const inputs = [undefined, null, {}, { askZed: false }, { challenges: false }, { askZed: false, challenges: false }]
  for (const raw of inputs) {
    const out = narrowCapabilities(ALL, raw, MAP)
    assert.ok(out.length <= ALL.length)
    for (const cap of out) assert.ok(ALL.includes(cap), `${cap} is not in the source list`)
  }
})

test('narrowCapabilities survives a non-array capability list', () => {
  assert.deepEqual([...narrowCapabilities(null, { askZed: false }, MAP)], [])
  assert.deepEqual([...narrowCapabilities('browse', {}, MAP)], [])
})

// ── the join with the consent decision ────────────────────────────────────

const approvedLearner = {
  role: 'learner',
  isMinor: true,
  guardian: { consentStatus: 'granted' },
}

test('an approved learner keeps everything when no control is set', () => {
  const access = resolveLearnerAccess(approvedLearner)
  assert.equal(access.reason, 'guardian-approved')
  assert.ok(access.capabilities.includes(CAPABILITY.AI_CHAT))
  assert.equal(access.restrictedByGuardian, false)
})

test('a guardian switching Ask Zed off removes AI_CHAT from the decision', () => {
  const access = resolveLearnerAccess({ ...approvedLearner, guardianControls: { askZed: false } })
  assert.ok(!access.capabilities.includes(CAPABILITY.AI_CHAT))
  assert.ok(access.capabilities.includes(CAPABILITY.SOCIAL), 'challenges were not switched off')
  assert.equal(access.restrictedByGuardian, true)
  // canLearnerUse is what every gate actually calls, on both sides.
  assert.equal(canLearnerUse(CAPABILITY.AI_CHAT, { ...approvedLearner, guardianControls: { askZed: false } }), false)
})

test('a guardian switching challenges off removes SOCIAL', () => {
  const user = { ...approvedLearner, guardianControls: { challenges: false } }
  assert.equal(canLearnerUse(CAPABILITY.SOCIAL, user), false)
  assert.equal(canLearnerUse(CAPABILITY.AI_CHAT, user), true)
})

test('controls cannot unlock a learner their guardian has not approved', () => {
  // The attack this ordering exists to refuse: a controls object saying
  // everything is allowed, on an account that is still waiting for consent.
  const pending = { role: 'learner', isMinor: true, guardian: { consentStatus: 'pending' } }
  const access = resolveLearnerAccess({ ...pending, guardianControls: { askZed: true, challenges: true } })
  assert.equal(access.limited, true)
  assert.ok(!access.capabilities.includes(CAPABILITY.AI_CHAT))
})

test('controls on a non-learner document are ignored', () => {
  const teacher = { role: 'teacher', guardianControls: { askZed: false } }
  const access = resolveLearnerAccess(teacher)
  assert.equal(access.reason, 'not-a-learner')
  assert.ok(access.capabilities.includes(CAPABILITY.AI_CHAT))
})

test('a denied account stays denied whatever the controls say', () => {
  const denied = {
    role: 'learner',
    isMinor: true,
    guardian: { consentStatus: 'denied' },
    guardianControls: { askZed: true, challenges: true },
  }
  assert.deepEqual([...resolveLearnerAccess(denied).capabilities], [])
})

// ── PIN shape ─────────────────────────────────────────────────────────────

test('a PIN is four to six digits and not a guessable one', () => {
  assert.equal(isWellFormedGuardianPin('4821'), true)
  assert.equal(isWellFormedGuardianPin('918273'), true)
  assert.equal(isWellFormedGuardianPin('123'), false, 'too short')
  assert.equal(isWellFormedGuardianPin('1234567'), false, 'too long')
  assert.equal(isWellFormedGuardianPin('12a4'), false)
  assert.equal(isWellFormedGuardianPin(''), false)
  assert.equal(isWellFormedGuardianPin(null), false)
  for (const trivial of ['0000', '1111', '1234', '123456', '5555', '888888']) {
    assert.equal(isWellFormedGuardianPin(trivial), false, `${trivial} must be refused`)
  }
})

test('a setup code is exactly six digits', () => {
  assert.equal(isWellFormedSetupCode('418293'), true)
  assert.equal(isWellFormedSetupCode('41829'), false)
  assert.equal(isWellFormedSetupCode('4182933'), false)
  assert.equal(isWellFormedSetupCode(undefined), false)
})

// ── lockout ───────────────────────────────────────────────────────────────

test('the fifth wrong PIN locks the zone for fifteen minutes', () => {
  const now = 1_000_000
  let record = null
  for (let i = 1; i < PIN_MAX_ATTEMPTS; i += 1) {
    record = guardianPinFailure(record, now)
    assert.equal(guardianPinAttemptState(record, now).allowed, true, `attempt ${i} should still be allowed`)
  }
  record = guardianPinFailure(record, now)
  const state = guardianPinAttemptState(record, now)
  assert.equal(state.allowed, false)
  assert.equal(state.retryInMs, PIN_LOCKOUT_MS)
})

test('the lockout clears the counter when it expires', () => {
  // Otherwise the window opens for exactly one attempt and slams shut again,
  // which reads to a parent as "the PIN stopped working".
  const now = 1_000_000
  let record = null
  for (let i = 0; i < PIN_MAX_ATTEMPTS; i += 1) record = guardianPinFailure(record, now)
  const later = now + PIN_LOCKOUT_MS + 1
  const state = guardianPinAttemptState(record, later)
  assert.equal(state.allowed, true)
  assert.equal(state.attempts, 0)
})

test('a correct PIN clears the counter', () => {
  const cleared = guardianPinSuccess()
  assert.equal(cleared.attempts, 0)
  assert.equal(cleared.lockedUntil, 0)
  assert.equal(guardianPinAttemptState(cleared, Date.now()).allowed, true)
})

test('a garbage attempt record does not lock anyone out', () => {
  for (const raw of [null, undefined, {}, { attempts: 'many' }, { lockedUntil: 'soon' }]) {
    assert.equal(guardianPinAttemptState(raw, Date.now()).allowed, true)
  }
})

// ── setup codes ───────────────────────────────────────────────────────────

test('a setup code is refused once used, once expired, and when unknown', () => {
  const now = 1_000_000
  assert.equal(setupCodeState({ expiresAt: now + 1000 }, now).ok, true)
  assert.equal(setupCodeState({ expiresAt: now + 1000, used: true }, now).reason, 'used')
  assert.equal(setupCodeState({ expiresAt: now - 1 }, now).reason, 'expired')
  assert.equal(setupCodeState(null, now).reason, 'unknown')
  assert.equal(setupCodeState({ expiresAt: 'later' }, now).ok, false)
})

test('the control keys are the ones the server and the UI both name', () => {
  assert.equal(GUARDIAN_CONTROL.ASK_ZED, 'askZed')
  assert.equal(GUARDIAN_CONTROL.CHALLENGES, 'challenges')
  assert.equal(GUARDIAN_CONTROL.DAILY_LIMIT_MINUTES, 'dailyLimitMinutes')
})

console.log(`\nguardianControlsCore: ${passed} passed`)
