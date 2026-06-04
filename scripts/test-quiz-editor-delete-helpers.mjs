/**
 * Regression test for the quiz-editor delete-handler stale-closure fix.
 *
 * Root cause: removePassageQuestion (EditQuizV2.jsx) read `sections` from
 * its closure instead of from inside the functional setSections updater. When
 * the handler was memoised with useCallback([]) the closure went stale and the
 * wrong question's _id (or no id at all) was staged for deletion.
 *
 * Fix: the id-collection was refactored into two pure helpers exported from
 * src/utils/quizSections.js:
 *   - collectSectionFirestoreIds(section)
 *   - getPassageQuestionFirestoreId(sections, sectionIndex, questionIndex)
 *
 * These helpers are now called INSIDE the setSections functional updater so
 * they always see the current snapshot, not a stale closure.
 *
 * This test guards that the helpers return the correct ids for the common
 * editor scenarios: standalone remove, passage remove, and single
 * passage-question remove.
 *
 * Run: npm run test:quiz-editor-delete-helpers
 */

import assert from 'node:assert/strict'
import {
  collectSectionFirestoreIds,
  getPassageQuestionFirestoreId,
} from '../src/utils/quizSections.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function standaloneSection(id, firestoreId) {
  return {
    id,
    kind: 'standalone',
    question: {
      _id: firestoreId || undefined,
      localId: `local-${id}`,
      text: 'Q text',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 0,
    },
  }
}

function passageSection(id, questions) {
  return {
    id,
    kind: 'passage',
    passage: {
      id: `passage-${id}`,
      passageText: 'Once upon a time...',
      questions,
    },
  }
}

function passageQuestion(localId, firestoreId) {
  return {
    _id: firestoreId || undefined,
    localId,
    text: 'Sub-question text',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 0,
  }
}

// ─── collectSectionFirestoreIds ───────────────────────────────────────────────

console.log('\ncollectSectionFirestoreIds')

test('standalone section with saved _id returns that id', () => {
  const section = standaloneSection('s1', 'firestore-id-1')
  const ids = collectSectionFirestoreIds(section)
  assert.deepStrictEqual(ids, ['firestore-id-1'])
})

test('standalone section with no _id returns empty array', () => {
  const section = standaloneSection('s2')
  const ids = collectSectionFirestoreIds(section)
  assert.deepStrictEqual(ids, [])
})

test('standalone section with empty string _id returns empty array', () => {
  const section = standaloneSection('s3', '')
  const ids = collectSectionFirestoreIds(section)
  assert.deepStrictEqual(ids, [])
})

test('passage section collects all saved sub-question ids', () => {
  const section = passageSection('p1', [
    passageQuestion('q1', 'fs-q1'),
    passageQuestion('q2', 'fs-q2'),
    passageQuestion('q3'),
  ])
  const ids = collectSectionFirestoreIds(section)
  assert.deepStrictEqual(ids, ['fs-q1', 'fs-q2'])
})

test('passage section with no saved sub-questions returns empty array', () => {
  const section = passageSection('p2', [
    passageQuestion('q4'),
    passageQuestion('q5'),
  ])
  const ids = collectSectionFirestoreIds(section)
  assert.deepStrictEqual(ids, [])
})

test('passage section with empty questions array returns empty array', () => {
  const section = passageSection('p3', [])
  const ids = collectSectionFirestoreIds(section)
  assert.deepStrictEqual(ids, [])
})

test('null / undefined section returns empty array', () => {
  assert.deepStrictEqual(collectSectionFirestoreIds(null), [])
  assert.deepStrictEqual(collectSectionFirestoreIds(undefined), [])
})

// ─── getPassageQuestionFirestoreId ────────────────────────────────────────────

console.log('\ngetPassageQuestionFirestoreId')

const sections = [
  standaloneSection('s1', 'fs-standalone-1'),
  passageSection('p1', [
    passageQuestion('pq1', 'fs-pq1'),
    passageQuestion('pq2'),
    passageQuestion('pq3', 'fs-pq3'),
  ]),
  passageSection('p2', [
    passageQuestion('pq4', 'fs-pq4'),
  ]),
]

test('returns correct id for a saved passage question', () => {
  const id = getPassageQuestionFirestoreId(sections, 1, 0)
  assert.strictEqual(id, 'fs-pq1')
})

test('returns null for an unsaved passage question (no _id)', () => {
  const id = getPassageQuestionFirestoreId(sections, 1, 1)
  assert.strictEqual(id, null)
})

test('returns correct id for the last question in a passage', () => {
  const id = getPassageQuestionFirestoreId(sections, 1, 2)
  assert.strictEqual(id, 'fs-pq3')
})

test('returns correct id in a different passage section', () => {
  const id = getPassageQuestionFirestoreId(sections, 2, 0)
  assert.strictEqual(id, 'fs-pq4')
})

test('returns null when sectionIndex is out of range', () => {
  const id = getPassageQuestionFirestoreId(sections, 99, 0)
  assert.strictEqual(id, null)
})

test('returns null when questionIndex is out of range', () => {
  const id = getPassageQuestionFirestoreId(sections, 1, 99)
  assert.strictEqual(id, null)
})

test('returns null for a standalone section (no passage.questions)', () => {
  const id = getPassageQuestionFirestoreId(sections, 0, 0)
  assert.strictEqual(id, null)
})

test('handles null sections gracefully', () => {
  const id = getPassageQuestionFirestoreId(null, 0, 0)
  assert.strictEqual(id, null)
})

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL: ${f.name}\n    ${f.message}`)
  process.exit(1)
}
