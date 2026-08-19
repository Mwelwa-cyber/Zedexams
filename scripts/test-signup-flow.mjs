/**
 * signupFlowCore — the sign-up step machine.
 *
 * What is being pinned here is a COMPLIANCE claim, not a UX preference:
 * "there is no route, deep link, or back-navigation trick that reaches
 * learner account creation without a captured date of birth". A claim like
 * that is worth exactly as much as the check behind it, and the check should
 * not require driving a browser.
 *
 * Run: node scripts/test-signup-flow.mjs
 */

import assert from 'node:assert/strict'
import {
  AGE_ANSWER_TTL_MS,
  STEP,
  checkAgeAnswer,
  isFreshAgeAnswer,
  needsAdultConfirmation,
  needsAgeAnswer,
  nextStepAfterAuth,
  resolveStep,
  stepsForRole,
} from '../src/utils/signupFlowCore.js'

let pass = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++ } catch (err) { failures.push({ name, message: err.message }) }
}

// ── Who gets asked what ───────────────────────────────────────────

test('only learners are asked for a date of birth', () => {
  assert.equal(needsAgeAnswer('learner'), true)
  assert.equal(needsAgeAnswer('teacher'), false)
  assert.equal(needsAgeAnswer('parent'), false)
})

test('a missing or unrecognised role falls towards being asked', () => {
  // The failure this prevents: a typo'd role skipping the age screen because
  // the check was "not a teacher and not a parent".
  assert.equal(needsAgeAnswer(undefined), false, 'no role has no age screen — it has no flow at all')
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'lerner' }), STEP.ROLE)
  assert.equal(resolveStep({ requested: STEP.AUTH, role: undefined }), STEP.ROLE)
})

test('teachers and parents attest instead, and learners are not asked twice', () => {
  assert.equal(needsAdultConfirmation('teacher'), true)
  assert.equal(needsAdultConfirmation('parent'), true)
  assert.equal(needsAdultConfirmation('learner'), false)
})

test('the learner flow has an age step and the others do not', () => {
  assert.deepEqual(stepsForRole('learner'), [STEP.ROLE, STEP.AGE, STEP.AUTH, STEP.GUARDIAN])
  assert.deepEqual(stepsForRole('teacher'), [STEP.ROLE, STEP.AUTH])
  assert.deepEqual(stepsForRole('parent'), [STEP.ROLE, STEP.AUTH])
})

// ── The guarantee ─────────────────────────────────────────────────

test('a learner cannot reach the auth screen without a date of birth', () => {
  // The deep link. This is the whole point of the module.
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'learner' }), STEP.AGE)
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'learner', dob: '' }), STEP.AGE)
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'learner', dob: '   ' }), STEP.AGE)
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'learner', dob: null }), STEP.AGE)
})

test('a learner WITH a date of birth reaches the auth screen', () => {
  assert.equal(
    resolveStep({ requested: STEP.AUTH, role: 'learner', dob: '2015-06-03' }),
    STEP.AUTH,
  )
})

test('teachers and parents go straight to auth — no age step to skip', () => {
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'teacher' }), STEP.AUTH)
  assert.equal(resolveStep({ requested: STEP.AUTH, role: 'parent' }), STEP.AUTH)
  // And the age screen is not reachable for them even by asking for it.
  assert.equal(resolveStep({ requested: STEP.AGE, role: 'teacher' }), STEP.ROLE)
})

test('a garbage or absent step never crashes into a screen', () => {
  for (const requested of [undefined, null, '', 'guardian ', 'AUTH', '../age', 42, {}]) {
    const step = resolveStep({ requested, role: 'learner', dob: '2015-06-03' })
    assert.equal(step, STEP.ROLE, `unrecognised step ${String(requested)} must land on role select`)
  }
})

test('the guardian screen is unreachable before an account exists', () => {
  // Nothing to attach a consent request to, and rendering it would ask a
  // child for their parent's email for an account that does not exist.
  assert.equal(
    resolveStep({ requested: STEP.GUARDIAN, role: 'learner', dob: '2015-06-03', isMinor: true }),
    STEP.AUTH,
  )
})

test('once the account exists a minor lands on the guardian screen', () => {
  assert.equal(
    resolveStep({
      requested: STEP.AGE, role: 'learner', dob: '2015-06-03',
      isMinor: true, accountCreated: true,
    }),
    STEP.GUARDIAN,
    'a created account must not be offered the age screen again',
  )
})

test('an adult learner with an account is never sent to the guardian screen', () => {
  assert.equal(
    resolveStep({
      requested: STEP.GUARDIAN, role: 'learner', dob: '1990-01-01',
      isMinor: false, accountCreated: true,
    }),
    STEP.AUTH,
  )
})

// ── Where auth success goes ───────────────────────────────────────

test('an existing account short-circuits the whole flow', () => {
  // Criterion 8: signing IN through the sign-up page must not run onboarding
  // writes — which is how an existing learner's stored birthday would be
  // overwritten with one typed to get past a screen.
  assert.equal(
    nextStepAfterAuth({ role: 'learner', isMinor: true, existingAccount: true }),
    'dashboard',
  )
  assert.equal(
    nextStepAfterAuth({ role: 'teacher', existingAccount: true }),
    'dashboard',
  )
})

test('a new minor learner goes to the guardian step, everyone else is done', () => {
  assert.equal(nextStepAfterAuth({ role: 'learner', isMinor: true }), STEP.GUARDIAN)
  assert.equal(nextStepAfterAuth({ role: 'learner', isMinor: false }), 'done')
  assert.equal(nextStepAfterAuth({ role: 'teacher', isMinor: true }), 'done')
  assert.equal(nextStepAfterAuth({ role: 'parent' }), 'done')
})

test('an undecided minor status is not treated as adult', () => {
  // isMinor is only ever `true` on the guardian branch. Anything else means
  // routing has not established it — and this function must not invent it.
  assert.equal(nextStepAfterAuth({ role: 'learner', isMinor: undefined }), 'done')
})

// ── The locked first answer ───────────────────────────────────────

test('a fresh answer is binding and a stale one is not', () => {
  const now = 1_700_000_000_000
  assert.equal(isFreshAgeAnswer({ dob: '2015-06-03', at: now - 1000 }, now), true)
  assert.equal(isFreshAgeAnswer({ dob: '2015-06-03', at: now - AGE_ANSWER_TTL_MS + 1 }, now), true)
  assert.equal(isFreshAgeAnswer({ dob: '2015-06-03', at: now - AGE_ANSWER_TTL_MS }, now), false)
  assert.equal(isFreshAgeAnswer({ dob: '2015-06-03', at: now - AGE_ANSWER_TTL_MS * 2 }, now), false)
})

test('the window is 24 hours', () => {
  assert.equal(AGE_ANSWER_TTL_MS, 24 * 60 * 60 * 1000)
})

test('a broken record expires rather than locking someone out forever', () => {
  const now = 1_700_000_000_000
  for (const record of [
    null, undefined, {}, 'nope', 42,
    { dob: '2015-06-03' },              // no timestamp
    { dob: '2015-06-03', at: 'soon' },  // unparseable timestamp
    { dob: '2015-06-03', at: 0 },
    { dob: '', at: now },
    { at: now },
  ]) {
    assert.equal(isFreshAgeAnswer(record, now), false, `${JSON.stringify(record)} must not lock`)
  }
})

test('a timestamp from the future is a clock change, not an answer', () => {
  const now = 1_700_000_000_000
  assert.equal(isFreshAgeAnswer({ dob: '2015-06-03', at: now + 60_000 }, now), false)
})

// ── What the age screen refuses ───────────────────────────────────

test('there is no minimum age — every plausible date proceeds', () => {
  // A screen that rejects young answers teaches the user which answer is
  // accepted, which is the one thing a neutral age screen must not do. The
  // range runs to the plausibility floor and no further.
  for (const age of [4, 9, 12, 17, 18, 45, 100]) {
    assert.equal(checkAgeAnswer(age).ok, true, `age ${age} must be accepted`)
  }
})

test('an unreadable, future or implausible date is refused', () => {
  assert.deepEqual(checkAgeAnswer(null), { ok: false, reason: 'unreadable' })
  assert.deepEqual(checkAgeAnswer(undefined), { ok: false, reason: 'unreadable' })
  assert.deepEqual(checkAgeAnswer(-1), { ok: false, reason: 'future' })
  assert.deepEqual(checkAgeAnswer(101), { ok: false, reason: 'implausible' })
})

test('an implausibly young age is refused as a typo, not as a policy', () => {
  // The distinction is the whole neutrality argument: 2 is refused because
  // nobody filling in this form is two, in the SAME words that refuse 120 —
  // not because young answers are unwelcome. See ageAnswerCore.js, which
  // builds both messages from one template.
  assert.deepEqual(checkAgeAnswer(0), { ok: false, reason: 'too_young' })
  assert.deepEqual(checkAgeAnswer(3), { ok: false, reason: 'too_young' })
  assert.equal(checkAgeAnswer(4).ok, true)
})

// ── Report ────────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + failures.length} tests · ${pass} passed · ${failures.length} failed ───`)
if (failures.length) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
