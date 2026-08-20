/**
 * duelAllowed — who may race Zed.
 *
 * The boundary worth pinning is which states count as a denial. A
 * guardian's OFF must block; "we do not know yet" must not, because the
 * screen behind a block says "challenges are switched off for this
 * account", and showing that to a learner whose profile simply has not
 * loaded names a decision nobody made and sends them to a parent with
 * nothing to turn back on.
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
const LEARNER = { role: 'learner' }

test('a signed-out visitor may race', () => {
  assert.equal(duelAllowed(null, null), true)
})

test('a learner whose guardian has expressed no view may race', () => {
  // The three-valued contract: absent is no decision, never a restriction.
  assert.equal(duelAllowed(USER, LEARNER), true)
  assert.equal(duelAllowed(USER, { ...LEARNER, guardianControls: {} }), true)
  assert.equal(duelAllowed(USER, { ...LEARNER, guardianControls: { challenges: null } }), true)
})

test("a guardian's OFF blocks the race", () => {
  assert.equal(duelAllowed(USER, { ...LEARNER, guardianControls: { challenges: false } }), false)
})

test("a guardian's ON allows it explicitly", () => {
  assert.equal(duelAllowed(USER, { ...LEARNER, guardianControls: { challenges: true } }), true)
})

test('an unrelated guardian control does NOT block the race', () => {
  // Two independent controls. Taking one must not take the other.
  assert.equal(duelAllowed(USER, { ...LEARNER, guardianControls: { somethingElse: false } }), true)
})

test('a non-boolean stored value is no decision, never a restriction', () => {
  for (const value of ['false', 0, '', 'off']) {
    assert.equal(
      duelAllowed(USER, { ...LEARNER, guardianControls: { challenges: value } }),
      true,
      `challenges=${JSON.stringify(value)}`,
    )
  }
})

test('a profile that has not loaded is not treated as a denial', () => {
  assert.equal(duelAllowed(USER, null), true)
  assert.equal(duelAllowed(USER, undefined), true)
  assert.equal(duelAllowed(USER, {}), true)
})

test('a profile still being repaired is not treated as a denial', () => {
  // bootstrapMissingProfile can leave a document without a role for a moment.
  assert.equal(duelAllowed(USER, { displayName: 'Mahenga', grade: 4 }), true)
})

test('a teacher or admin is never blocked', () => {
  // Neither is somebody's child, so a control about a child means nothing.
  assert.equal(duelAllowed(USER, { role: 'teacher', guardianControls: { challenges: false } }), true)
  assert.equal(duelAllowed(USER, { role: 'admin' }), true)
})

console.log(`\nduelAllowed: ${passed} passed`)
