/**
 * The journal differ's rules — every way two journals can differ, asserted.
 *
 * This file matters more than its size suggests. `diffJournals` is what will
 * decide whether a cutover is byte-compatible, and the failure mode of a
 * comparison test is not that it breaks — it is that it passes. A differ that
 * quietly ignores an added field, or compares `4` equal to `'4'`, reports a
 * clean cutover for a changed document.
 *
 * So each rule has a case that FAILS when the rule is doing its job, and the
 * three volatile exemptions have cases proving they exempt the value and not
 * the field.
 */
import assert from 'node:assert/strict'
import { createRecorder, diffJournals, isVolatile, VOLATILE } from './journal.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const j = (...entries) => entries
const w = (payload, op = 'addDoc', path = 'results') => ({ op, path, payload })

console.log('replay journal differ')

// ── Identical is identical ───────────────────────────────────────────────────

test('two identical journals are identical', () => {
  const a = j(w({ score: 3, mode: 'practice' }))
  const b = j(w({ score: 3, mode: 'practice' }))
  assert.equal(diffJournals(a, b).identical, true)
})

test('key ORDER does not make two payloads differ', () => {
  // Firestore stores a document, not an ordered record. Two paths building the
  // same fields in a different order write the same document.
  const a = j(w({ score: 3, mode: 'practice' }))
  const b = j(w({ mode: 'practice', score: 3 }))
  assert.equal(diffJournals(a, b).identical, true)
})

// ── Rule 1: write count and targets ──────────────────────────────────────────

test('an extra write is caught, and named', () => {
  const a = j(w({ score: 1 }))
  const b = j(w({ score: 1 }), w({ streak: 2 }, 'setDoc', 'dailyStreaks/u1'))
  const { identical, differences } = diffJournals(a, b)
  assert.equal(identical, false)
  assert.ok(differences.some((d) => d.includes('write count: 1 vs 2')))
  assert.ok(differences.some((d) => d.includes('only in B') && d.includes('dailyStreaks/u1')),
    'the extra write must be named — "count differs" does not say which')
})

test('the same payload written to a different collection is caught', () => {
  const a = j(w({ score: 1 }, 'addDoc', 'results'))
  const b = j(w({ score: 1 }, 'addDoc', 'scores'))
  assert.equal(diffJournals(a, b).identical, false)
})

test('the same payload written with a different operation is caught', () => {
  const a = j(w({ score: 1 }, 'addDoc', 'results'))
  const b = j(w({ score: 1 }, 'setDoc', 'results'))
  assert.equal(diffJournals(a, b).identical, false)
})

// ── Rule 2: field set ────────────────────────────────────────────────────────

test('an ADDED field is caught — a new field in results is a schema change', () => {
  const a = j(w({ score: 1 }))
  const b = j(w({ score: 1, schemaVersion: 1 }))
  const { identical, differences } = diffJournals(a, b)
  assert.equal(identical, false)
  assert.ok(differences.some((d) => d.includes('schemaVersion') && d.includes('absent in A')))
})

test('a REMOVED field is caught', () => {
  const a = j(w({ score: 1, topicScores: {} }))
  const b = j(w({ score: 1 }))
  assert.equal(diffJournals(a, b).identical, false)
})

// ── Rule 3: values ───────────────────────────────────────────────────────────

test('a changed value is caught, with both sides shown', () => {
  const a = j(w({ percentage: 100 }))
  const b = j(w({ percentage: 50 }))
  const { differences } = diffJournals(a, b)
  assert.ok(differences.some((d) => d.includes('100') && d.includes('50')))
})

test('nested objects are compared field by field', () => {
  const a = j(w({ topicScores: { Addition: { correct: 1, total: 2 } } }))
  const b = j(w({ topicScores: { Addition: { correct: 0, total: 2 } } }))
  const { identical, differences } = diffJournals(a, b)
  assert.equal(identical, false)
  assert.ok(differences.some((d) => d.includes('topicScores.Addition.correct')))
})

test('arrays are compared by length and element', () => {
  assert.equal(diffJournals(j(w({ ids: ['a', 'b'] })), j(w({ ids: ['a'] }))).identical, false)
  assert.equal(diffJournals(j(w({ ids: ['a', 'b'] })), j(w({ ids: ['a', 'c'] }))).identical, false)
  assert.equal(diffJournals(j(w({ ids: ['a', 'b'] })), j(w({ ids: ['a', 'b'] }))).identical, true)
})

// ── Rule 4: types ────────────────────────────────────────────────────────────
//
// The games path stores grade as a Number and subject lowercased by documented,
// deliberate divergence. An engine that "tidied" either would break every games
// leaderboard query, and a value-only comparison would stay green.

test("4 and '4' are NOT the same value", () => {
  const { identical, differences } = diffJournals(j(w({ grade: 4 })), j(w({ grade: '4' })))
  assert.equal(identical, false)
  assert.ok(differences.some((d) => d.includes('type number vs string')))
})

test('null and undefined-shaped values are distinguished from each other', () => {
  assert.equal(diffJournals(j(w({ x: null })), j(w({ x: 0 }))).identical, false)
  assert.equal(diffJournals(j(w({ x: null })), j(w({ x: '' }))).identical, false)
})

test('an object is not equal to an array with the same contents', () => {
  assert.equal(diffJournals(j(w({ x: { 0: 'a' } })), j(w({ x: ['a'] }))).identical, false)
})

// ── The three volatile exemptions ────────────────────────────────────────────

test('the exemption list is exactly three categories, and is asserted here', () => {
  // If a fourth category is added, this fails — which is the point. A new
  // exemption is a deliberate diff a reviewer sees, not a matcher loosened
  // until a comparison passes.
  assert.deepEqual(Object.keys(VOLATILE).sort(),
    ['autoIdFields', 'serverTimestampFields', 'wallClockFields'])
})

test('a server timestamp may differ in VALUE', () => {
  const a = j(w({ score: 1, completedAt: 'SENTINEL_A' }))
  const b = j(w({ score: 1, completedAt: 'SENTINEL_B' }))
  assert.equal(diffJournals(a, b).identical, true)
})

test('a wall-clock duration may differ in VALUE', () => {
  assert.equal(diffJournals(j(w({ timeSpent: 42 })), j(w({ timeSpent: 43 }))).identical, true)
})

test('but a volatile field DISAPPEARING is still a difference', () => {
  // Exempting the value must not exempt the field: a path that stopped writing
  // completedAt writes a different document.
  const a = j(w({ score: 1, completedAt: 'X' }))
  const b = j(w({ score: 1 }))
  const { identical, differences } = diffJournals(a, b)
  assert.equal(identical, false)
  assert.ok(differences.some((d) => d.includes('completedAt')))
})

test('a non-volatile field is never exempted, however noisy it looks', () => {
  assert.equal(isVolatile('percentage'), false)
  assert.equal(isVolatile('score'), false)
  assert.equal(diffJournals(j(w({ percentage: 99 })), j(w({ percentage: 98 }))).identical, false)
})

test('volatility is an exact field match, not a prefix or substring rule', () => {
  // `completedAtFakeField` is not `completedAt`, and a fuzzy rule would exempt
  // a field nobody decided to exempt.
  assert.equal(isVolatile('completedAtFakeField'), false)
  assert.equal(isVolatile('myTimeSpent'), false)
  assert.equal(diffJournals(j(w({ myTimeSpent: 1 })), j(w({ myTimeSpent: 2 }))).identical, false)
})

// ── The recorder ─────────────────────────────────────────────────────────────

test('the recorder records operation, path and payload in order', () => {
  const r = createRecorder()
  r.addDoc('results', { score: 1 })
  r.setDoc('daily_exam_locks/u1_math_2026-08-05', { status: 'submitted' })
  const journal = r.journal()
  assert.equal(journal.length, 2)
  assert.deepEqual(journal[0], { op: 'addDoc', path: 'results', payload: { score: 1 } })
  assert.equal(journal[1].op, 'setDoc')
})

test('a transaction flattens its writes into the journal in order', () => {
  const r = createRecorder()
  r.runTransaction((tx) => {
    tx.update('exam_attempts/a1', { status: 'submitted' })
    tx.set('exam_attempts/a1/private/detail', { answers: {} })
  })
  assert.deepEqual(r.journal().map((e) => e.op), ['tx.update', 'tx.set'])
})

test('the journal is a copy — a caller cannot mutate the record', () => {
  const r = createRecorder()
  r.addDoc('results', { score: 1 })
  const first = r.journal()
  first[0].payload = { score: 999 }
  assert.equal(r.journal()[0].payload.score, 1)
})

console.log(`\nreplay journal differ: ${passed} passed`)
