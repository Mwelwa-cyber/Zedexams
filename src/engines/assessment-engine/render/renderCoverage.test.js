/**
 * Every canonical type is either DRAWN or declared undrawn — no third state.
 *
 * The gap this closes is the one a dispatcher creates by omission. A type with
 * no renderer and no entry in `UNSUPPORTED` is a type nobody decided about:
 * `canRender` says no, `unsupportedReason` invents "not a canonical question
 * type", and the first anyone learns of it is a thrown error in front of a
 * learner. Partitioning the registry — every type in exactly one of the two
 * lists — makes that state impossible to reach by accident.
 *
 * Shrink-only, Phase 1's idiom: `UNSUPPORTED` may LOSE entries as renderers
 * land, and gaining one fails here. Adding a type to the shared registry
 * without either drawing it or deciding in a diff that it stays undrawn is how
 * a gap becomes permanent.
 */
import assert from 'node:assert/strict'
import { QUESTION_TYPES } from '../../../../functions/shared/assessment/questionTypeCore.js'
import { SUPPORTED, UNSUPPORTED, canRender, unsupportedReason, unrenderableTypes } from './supportedTypes.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** The count `UNSUPPORTED` must never exceed. Lower it as renderers land. */
const UNSUPPORTED_CEILING = 11

console.log('engine — renderer type coverage')

test('the registry is read and is not empty', () => {
  assert.ok(QUESTION_TYPES.length >= 13, `expected the full registry, got ${QUESTION_TYPES.length}`)
})

test('every canonical type is in exactly ONE of the two lists', () => {
  const missing = QUESTION_TYPES.filter((t) => !SUPPORTED.includes(t) && !(t in UNSUPPORTED))
  assert.deepEqual(missing, [],
    'a question type is neither drawn nor declared undrawn — nobody decided about it, and '
    + 'the first sign will be a thrown error in front of a learner')

  const both = QUESTION_TYPES.filter((t) => SUPPORTED.includes(t) && t in UNSUPPORTED)
  assert.deepEqual(both, [], 'a type claims to be both drawn and undrawn')
})

test('neither list carries a type outside the registry', () => {
  // A renamed or removed type leaves a stale entry that looks like coverage.
  assert.deepEqual(SUPPORTED.filter((t) => !QUESTION_TYPES.includes(t)), [])
  assert.deepEqual(Object.keys(UNSUPPORTED).filter((t) => !QUESTION_TYPES.includes(t)), [])
})

test('every unsupported entry says what a LEARNER is missing', () => {
  // The engineering reason is not the useful one. What decides whether a
  // cutover may proceed is what the learner cannot do.
  for (const [type, reason] of Object.entries(UNSUPPORTED)) {
    assert.equal(typeof reason, 'string', type)
    assert.ok(reason.length > 20, `${type}: the reason is too thin to act on — "${reason}"`)
  }
})

test('the unsupported list is SHRINK-ONLY', () => {
  const count = Object.keys(UNSUPPORTED).length
  assert.ok(count <= UNSUPPORTED_CEILING,
    `UNSUPPORTED grew to ${count} (ceiling ${UNSUPPORTED_CEILING}). A new undrawn type is a `
    + 'decision to state in a PR. When a renderer lands, LOWER the ceiling in the same diff.')
})

test('the ceiling is not slack — it equals the current count', () => {
  // A ceiling above the real number is a ratchet with room to rot: the next
  // gap slides in under it without failing anything.
  assert.equal(Object.keys(UNSUPPORTED).length, UNSUPPORTED_CEILING)
})

// ── The predicates ───────────────────────────────────────────────────────────

test('canRender agrees with the lists', () => {
  for (const type of SUPPORTED) assert.equal(canRender(type), true, type)
  for (const type of Object.keys(UNSUPPORTED)) assert.equal(canRender(type), false, type)
})

test('a type outside the registry is not renderable, and says so', () => {
  assert.equal(canRender('ghost_type'), false)
  assert.equal(unsupportedReason('ghost_type'), 'not a canonical question type')
  assert.equal(canRender(undefined), false)
})

test('unsupportedReason returns null exactly for a drawable type', () => {
  assert.equal(unsupportedReason('mcq'), null)
  assert.ok(unsupportedReason('matching'))
})

// ── The cutover question ─────────────────────────────────────────────────────

test('unrenderableTypes names every undrawable type in an assessment', () => {
  const assessment = { questions: [
    { type: 'mcq' }, { type: 'matching' }, { type: 'mcq' }, { type: 'sequence' }, { type: 'matching' },
  ] }
  assert.deepEqual(unrenderableTypes(assessment), ['matching', 'sequence'],
    'deduplicated, in first-seen order')
})

test('an all-choice assessment is fully renderable', () => {
  assert.deepEqual(unrenderableTypes({ questions: [{ type: 'mcq' }, { type: 'tf' }] }), [])
})

test('an empty or missing assessment reports nothing undrawable', () => {
  // Not a special case worth branching on elsewhere: nothing to draw is not
  // the same as something that cannot be drawn.
  assert.deepEqual(unrenderableTypes({ questions: [] }), [])
  assert.deepEqual(unrenderableTypes(null), [])
  assert.deepEqual(unrenderableTypes(undefined), [])
})

test('both Phase 3 choice types are drawable — the canary depends on it', () => {
  // The past-paper zero-write canary is only meaningful if a past-paper quiz
  // renders end to end. Its questions are mcq and tf.
  assert.deepEqual(unrenderableTypes({ questions: [{ type: 'mcq' }, { type: 'tf' }] }), [])
})

console.log(`\nengine renderer coverage: ${passed} passed`)
