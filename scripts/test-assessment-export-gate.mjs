/**
 * Export-gate tests — src/utils/assessmentExportGate.js.
 *
 * The regression these pin: a Grade 4 paper downloaded while its only block was
 * the untouched starter, and printed as "1. (no question text) … TOTAL MARKS:
 * ___ / 1". Save was already gated on the same blocking issues; the four export
 * buttons were not.
 *
 * Run: node scripts/test-assessment-export-gate.mjs
 */

import assert from 'node:assert/strict'
import {
  blockingIssues, blockingIssuesByLocalId, incompleteQuestionNumbers,
  listNumbers, describeExportBlock,
} from '../src/utils/assessmentExportGate.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

const emptyText = (localId, label) => ({
  id: `question-text-${localId}`, label: `${label}: question text is empty.`,
  severity: 'error', localId,
})

/* ── the reported bug ───────────────────────────────────────────────────── */

test('a brand-new paper cannot be exported', () => {
  // countQuizQuestions sees the starter block as one question, so the old
  // `questionCount === 0` guard let it straight through.
  const gate = describeExportBlock({
    issues: [emptyText('a', 'Question 1')],
    questionNumbers: { a: 1 },
    questionCount: 1,
    emptyStarter: true,
  })
  assert.equal(gate.blocked, true)
  assert.equal(gate.reason, 'empty')
  assert.match(gate.message, /Add at least one question/)
})

test('a paper with no questions at all is blocked', () => {
  const gate = describeExportBlock({ questionCount: 0 })
  assert.equal(gate.blocked, true)
  assert.equal(gate.reason, 'empty')
})

/* ── naming the offending questions ─────────────────────────────────────── */

test('one unfinished question is named by number', () => {
  const gate = describeExportBlock({
    issues: [emptyText('c', 'Question 3')],
    questionNumbers: { a: 1, b: 2, c: 3 },
    questionCount: 5,
  })
  assert.equal(gate.blocked, true)
  assert.equal(gate.reason, 'incomplete-questions')
  assert.deepEqual(gate.numbers, [3])
  assert.match(gate.message, /Question 3 is not finished/)
})

test('several unfinished questions are listed in order', () => {
  const gate = describeExportBlock({
    issues: [emptyText('g', 'Question 7'), emptyText('c', 'Question 3')],
    questionNumbers: { c: 3, g: 7 },
    questionCount: 9,
  })
  assert.deepEqual(gate.numbers, [3, 7])
  assert.match(gate.message, /Questions 3 and 7 are not finished/)
})

test('a question with two problems is named once', () => {
  const gate = describeExportBlock({
    issues: [
      emptyText('c', 'Question 3'),
      { id: 'correct-c', label: 'Question 3: pick the correct answer.', severity: 'error', localId: 'c' },
    ],
    questionNumbers: { c: 3 },
    questionCount: 4,
  })
  assert.deepEqual(gate.numbers, [3])
})

test('every per-question blocker type is recognised, not just empty text', () => {
  const kinds = [
    'opt-count-x', 'opt-empty-x-0', 'correct-x', 'numeric-x', 'fill-blanks-x',
    'matching-x', 'sequence-x', 'hotspot-x', 'diagram-label-x',
    'question-uploading-x', 'passage-text-x', 'passage-questions-x',
  ]
  for (const id of kinds) {
    const gate = describeExportBlock({
      issues: [{ id, label: 'Question 2: not finished.', severity: 'error', localId: 'x' }],
      questionNumbers: { x: 2 },
      questionCount: 3,
    })
    assert.deepEqual(gate.numbers, [2], id)
  }
})

/* ── paper-level blockers ───────────────────────────────────────────────── */

test('a paper-level blocker is reported in its own words', () => {
  const gate = describeExportBlock({
    issues: [{ id: 'subject', label: 'Pick a subject.', severity: 'error', localId: null }],
    questionNumbers: { a: 1 },
    questionCount: 3,
  })
  assert.equal(gate.blocked, true)
  assert.equal(gate.reason, 'paper-details')
  assert.match(gate.message, /Pick a subject\./)
})

test('unfinished questions take priority over paper-level blockers', () => {
  // Naming the questions is the actionable message; the health modal lists the
  // rest.
  const gate = describeExportBlock({
    issues: [
      { id: 'subject', label: 'Pick a subject.', severity: 'error', localId: null },
      emptyText('c', 'Question 3'),
    ],
    questionNumbers: { c: 3 },
    questionCount: 4,
  })
  assert.equal(gate.reason, 'incomplete-questions')
})

/* ── the happy path ─────────────────────────────────────────────────────── */

test('a finished paper exports', () => {
  const gate = describeExportBlock({
    issues: [],
    questionNumbers: { a: 1, b: 2 },
    questionCount: 2,
  })
  assert.equal(gate.blocked, false)
  assert.equal(gate.message, '')
})

test('advisory warnings never block an export', () => {
  // "0 marks on 2 questions" is a nudge, not a wall — the paper still prints
  // correctly, so the teacher stays in control of shipping it.
  const gate = describeExportBlock({
    issues: [{ id: 'some-missing-marks', label: '2 questions have 0 marks.', severity: 'warn', localId: null }],
    questionCount: 4,
  })
  assert.equal(gate.blocked, false)
})

/* ── helpers ────────────────────────────────────────────────────────────── */

test('blockingIssues drops advisories', () => {
  const issues = [
    { id: 'a', severity: 'error' }, { id: 'b', severity: 'warn' }, { id: 'c' },
  ]
  assert.deepEqual(blockingIssues(issues).map((i) => i.id), ['a', 'c'])
  assert.deepEqual(blockingIssues(null), [])
})

test('blockingIssuesByLocalId groups a card’s problems together', () => {
  const map = blockingIssuesByLocalId([
    emptyText('c', 'Question 3'),
    { id: 'correct-c', label: 'Question 3: pick the correct answer.', severity: 'error', localId: 'c' },
    { id: 'subject', label: 'Pick a subject.', severity: 'error', localId: null },
    { id: 'repeats', label: 'possible repeat', severity: 'warn', localId: 'c' },
  ])
  assert.equal(map.size, 1)
  assert.equal(map.get('c').length, 2)
})

test('incompleteQuestionNumbers ignores unnumbered and advisory issues', () => {
  const numbers = incompleteQuestionNumbers([
    emptyText('c', 'Question 3'),
    emptyText('zz', 'Question ?'),          // not in the numbering map
    { id: 'question-text-d', label: 'x', severity: 'warn', localId: 'd' },
  ], { c: 3, d: 4 })
  assert.deepEqual(numbers, [3])
})

test('listNumbers reads as prose', () => {
  assert.equal(listNumbers([]), '')
  assert.equal(listNumbers([3]), '3')
  assert.equal(listNumbers([3, 7]), '3 and 7')
  assert.equal(listNumbers([3, 7, 9]), '3, 7 and 9')
})

console.log(`✓ assessment export gate — ${passed} tests passed`)
