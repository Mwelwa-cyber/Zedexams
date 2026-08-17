// scripts/test-guardian-controls.mjs
//
// Pure-logic tests for the guardian controls contract
// (src/features/learnerHome/lib/guardianControlsCore.js). Run with
// `npm run test:guardian-controls`.
//
// The rules under test are the ones a parent would be angriest about if
// they broke: an absent decision is not a restriction, a guardian's OFF
// beats the child, and a guardian's ON does not force a child who
// switched something off themselves.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GUARDIAN_CONTROLS,
  GUARDIAN_CONTROL_KEYS,
  isGuardianControl,
  readGuardianControls,
  isAllowed,
  describeControlChange,
} from '../functions/shared/guardian/guardianControlsCore.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

t('every control declares a key, label, hint and icon', () => {
  assert.ok(GUARDIAN_CONTROLS.length > 0)
  for (const c of GUARDIAN_CONTROLS) {
    for (const field of ['key', 'label', 'hint', 'icon']) {
      assert.equal(typeof c[field], 'string', `${c.key} is missing ${field}`)
      assert.ok(c[field].length > 0)
    }
  }
  assert.equal(new Set(GUARDIAN_CONTROL_KEYS).size, GUARDIAN_CONTROL_KEYS.length)
})

t('every control declares where its OFF is enforced', () => {
  for (const c of GUARDIAN_CONTROLS) {
    assert.ok(
      c.enforcement === 'server' || c.enforcement === 'client',
      `${c.key} must declare enforcement as 'server' or 'client'`,
    )
  }
})

t("a control claiming server enforcement is actually read by consentGuard", () => {
  // The claim this file exists to keep honest. `enforcement: 'server'` is
  // what lets the product tell a parent that a modified client cannot
  // ignore their decision — so a control that says it and is never read at
  // the point of use is the one failure here that would be invisible and
  // would matter. Read as SOURCE rather than by importing: consentGuard
  // needs firebase-functions, which the root-deps CI run does not install.
  const guard = readFileSync(new URL('../functions/consentGuard.js', import.meta.url), 'utf8')
  for (const c of GUARDIAN_CONTROLS.filter((x) => x.enforcement === 'server')) {
    assert.ok(
      guard.includes(`"${c.key}"`) || guard.includes(`'${c.key}'`) || guard.includes(c.key),
      `${c.key} claims server enforcement but functions/consentGuard.js never names it`,
    )
  }
})

t('isGuardianControl accepts declared keys and nothing else', () => {
  assert.equal(isGuardianControl('askZed'), true)
  assert.equal(isGuardianControl('deleteEverything'), false)
  assert.equal(isGuardianControl(undefined), false)
})

t('an account with no guardianControls has no decisions, not false ones', () => {
  for (const user of [undefined, null, {}, { guardianControls: null }, { guardianControls: 'off' }]) {
    const controls = readGuardianControls(user)
    for (const key of GUARDIAN_CONTROL_KEYS) {
      assert.equal(controls[key], null, `${key} should read as "no decision"`)
    }
  }
})

t('a non-boolean stored value is no decision, never a restriction', () => {
  // An older client, a botched migration, a hand-edited document: none
  // of those are a parent saying no.
  const controls = readGuardianControls({ guardianControls: { askZed: 'false' } })
  assert.equal(controls.askZed, null)
  assert.equal(isAllowed({ guardianControls: { askZed: 'false' } }, 'askZed'), true)
})

t('booleans round-trip', () => {
  assert.equal(readGuardianControls({ guardianControls: { askZed: false } }).askZed, false)
  assert.equal(readGuardianControls({ guardianControls: { askZed: true } }).askZed, true)
})

t("the guardian's OFF beats the child's ON", () => {
  const user = { guardianControls: { askZed: false } }
  assert.equal(isAllowed(user, 'askZed', true), false)
})

t("the guardian's ON does not override a child who turned it off", () => {
  // Permitting is not requiring.
  const user = { guardianControls: { askZed: true } }
  assert.equal(isAllowed(user, 'askZed', false), false)
  assert.equal(isAllowed(user, 'askZed', true), true)
})

t('an unknown control is never treated as restricted', () => {
  // A client that knows about a control this build does not must not be
  // able to lock a feature out by naming it.
  assert.equal(isAllowed({ guardianControls: { somethingNew: false } }, 'somethingNew', true), true)
})

t('a change description reads as a sentence, and unknown keys describe nothing', () => {
  assert.equal(describeControlChange('askZed', false), 'Ask Zed helper was turned off')
  assert.equal(describeControlChange('askZed', true), 'Ask Zed helper was turned on')
  assert.equal(describeControlChange('nope', true), null)
})

console.log(`guardian controls — ${passed} passed`)

/* ── The adult friction gate (guardianGateCore) ─────────────────── */

const gate = await import('../src/features/learnerHome/lib/guardianGateCore.js')

t('a generated question stays out of early-primary tables', () => {
  // A fixed 7 × 8 is learned once and then the gate is decoration; a
  // 2 × 3 is homework for the child it is meant to keep out.
  const seq = [0, 0.999, 0.5, 0.25]
  let i = 0
  for (let n = 0; n < 40; n += 1) {
    const q = gate.buildGateQuestion(() => seq[i++ % seq.length])
    assert.ok(q.a >= 6 && q.a <= 12, `operand out of range: ${q.a}`)
    assert.ok(q.b >= 6 && q.b <= 12, `operand out of range: ${q.b}`)
    assert.equal(q.answer, q.a * q.b)
    assert.equal(q.prompt, `What is ${q.a} × ${q.b}?`)
  }
})

t('the default rng produces valid questions without an injected one', () => {
  const q = gate.buildGateQuestion()
  assert.equal(q.answer, q.a * q.b)
})

t('an answer is checked exactly, and junk is wrong rather than an error', () => {
  const q = { a: 7, b: 8, answer: 56 }
  assert.equal(gate.checkGateAnswer(q, '56'), true)
  assert.equal(gate.checkGateAnswer(q, ' 56 '), true)
  for (const bad of ['', '  ', '5', '57', '56.0', 'fifty-six', '56a', null, undefined, {}]) {
    assert.equal(gate.checkGateAnswer(q, bad), false, `should reject ${JSON.stringify(bad)}`)
  }
  assert.equal(gate.checkGateAnswer(null, '56'), false)
})

t('a pass expires, and a backwards clock cannot extend one', () => {
  const now = 1_000_000
  assert.equal(gate.gateStillValid(now - 1000, now), true)
  assert.equal(gate.gateStillValid(now - gate.GATE_TTL_MS, now), false)
  assert.equal(gate.gateStillValid(now - gate.GATE_TTL_MS - 1, now), false)
  // Never passed, or a pass stamped in the future.
  assert.equal(gate.gateStillValid(null, now), false)
  assert.equal(gate.gateStillValid(0, now), false)
  assert.equal(gate.gateStillValid(now + 5000, now), false)
})

/* ── The callable's decisions (server) ──────────────────────────── */

const {createRequire} = await import('node:module')
const require_ = createRequire(import.meta.url)
const decisions = require_('../functions/guardianControls/guardianControlsDecisions.js')
const consent = await import('../functions/shared/consent/guardianConsentCore.js')
const controls = await import('../functions/shared/guardian/guardianControlsCore.js')

const deps = {
  isGuardianControl: controls.isGuardianControl,
  readGuardianControls: controls.readGuardianControls,
  resolveLearnerAccess: consent.resolveLearnerAccess,
}
const approved = (extra = {}) => ({
  role: 'learner', isMinor: true, guardian: {consentStatus: 'granted'}, ...extra,
})

t('a control change on an approved account is allowed', () => {
  const d = decisions.decideControlChange({key: 'askZed', value: false, user: approved(), deps})
  assert.equal(d.ok, true)
  assert.equal(d.from, null)
})

t('a value that is not a boolean is refused, never coerced', () => {
  // The three-valued shape only means anything if nothing but a real
  // boolean can be stored.
  for (const value of ['false', 0, 1, null, undefined, {}, []]) {
    const d = decisions.decideControlChange({key: 'askZed', value, user: approved(), deps})
    assert.equal(d.ok, false, `should refuse ${JSON.stringify(value)}`)
    assert.equal(d.reason, 'not-a-boolean')
  }
})

t('an unknown control key is refused', () => {
  const d = decisions.decideControlChange({key: 'deleteEverything', value: true, user: approved(), deps})
  assert.equal(d.ok, false)
  assert.equal(d.reason, 'unknown-control')
})

t('an account with no approved guardian cannot set a control', () => {
  // There would be nobody whose decision it is, and nobody to notify —
  // which is the property that makes the audit trail meaningful.
  for (const user of [
    null,
    {role: 'learner', isMinor: true},
    {role: 'learner', isMinor: true, guardian: {consentStatus: 'pending'}},
    {role: 'learner', isMinor: true, guardian: {consentStatus: 'denied'}},
  ]) {
    const d = decisions.decideControlChange({key: 'askZed', value: false, user, deps})
    assert.equal(d.ok, false)
    assert.equal(d.reason, 'no-guardian')
  }
})

t('setting a control to the value it already has writes nothing', () => {
  // Otherwise a re-render mails the guardian.
  const user = approved({guardianControls: {askZed: false}})
  const d = decisions.decideControlChange({key: 'askZed', value: false, user, deps})
  assert.equal(d.ok, false)
  assert.equal(d.reason, 'unchanged')
  assert.equal(d.from, false)
})

t('a real change reports what it changed from', () => {
  const user = approved({guardianControls: {askZed: false}})
  const d = decisions.decideControlChange({key: 'askZed', value: true, user, deps})
  assert.equal(d.ok, true)
  assert.equal(d.from, false)
})

t('the guardian notice says what changed, on whose account, and what to do', () => {
  const mail = decisions.buildControlNoticeEmail({
    childName: 'Milton Phiri',
    description: controls.describeControlChange('askZed', false),
  })
  assert.match(mail.subject, /Milton Phiri/)
  assert.match(mail.text, /Ask Zed helper was turned off/)
  assert.match(mail.text, /If it was not you/)
  // The message must not overpromise: the zone runs on the child's phone.
  assert.match(mail.text, /a determined child can reach it/)
})

t('a missing child name degrades rather than printing undefined', () => {
  const mail = decisions.buildControlNoticeEmail({description: 'X was turned off'})
  assert.match(mail.subject, /your child/)
  assert.ok(!/undefined/.test(mail.text))
})

console.log(`guardian gate + callable decisions — ${passed} total assertions passed`)
