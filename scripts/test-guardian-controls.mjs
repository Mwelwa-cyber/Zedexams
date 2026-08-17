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
import {
  GUARDIAN_CONTROLS,
  GUARDIAN_CONTROL_KEYS,
  isGuardianControl,
  readGuardianControls,
  isAllowed,
  describeControlChange,
} from '../src/features/learnerHome/lib/guardianControlsCore.js'

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
