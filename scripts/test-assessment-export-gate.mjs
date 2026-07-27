/**
 * Export-gate tests — functions/shared/assessment/exportReadinessCore.js.
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
} from '../functions/shared/assessment/exportReadinessCore.js'

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

/* ── an unresolved required figure ───────────────────────────────────────── */

const missingFigure = (n) => ({
  kind: 'library_diagram', questionNumber: n, questionId: `q${n}`,
  diagramKey: 'gone', stage: 'catalog', reason: 'not in the catalog', label: '',
})

test('a finished paper missing a required figure is BLOCKED, not warned', () => {
  // The classification this phase exists to make: a learner asked to label a
  // diagram that is not on the page cannot answer the question, so this ranks
  // with the unfinished questions and not with the printability advisories.
  // Asserted as one object rather than field by field: separate assertions pass
  // for a gate that names the right reason and forgets to set `blocked`, which
  // is the one combination that would leave the buttons live.
  assert.deepEqual(
    describeExportBlock({ issues: [], questionCount: 6, unresolvedFigures: [missingFigure(5)] }),
    {
      blocked: true,
      reason: 'unresolved-figure',
      numbers: [5],
      message: 'Question 5 requires a diagram, but the figure could not be rendered. '
        + 'Replace, regenerate or repair the diagram before exporting.',
    },
  )
})

test('the message names the same questions, in the same order, as the badges', () => {
  // The mismatch this pins: the numbers were sorted and de-duplicated while the
  // sentence led with whichever entry happened to be first in the array, so a
  // paper badging questions 2 and 9 opened with "Question 9 requires a
  // diagram". Both now come from one call.
  const gate = describeExportBlock({
    issues: [], questionCount: 9,
    unresolvedFigures: [missingFigure(9), missingFigure(2), missingFigure(9)],
  })
  assert.deepEqual(gate.numbers, [2, 9], 'de-duplicated and sorted')
  assert.equal(
    gate.message,
    'Questions 2 and 9 require diagrams, but the figures could not be rendered. '
    + 'Replace, regenerate or repair the diagrams before exporting.',
  )
  for (const n of gate.numbers) assert.ok(gate.message.includes(String(n)), `names ${n}`)
})

test('two broken figures on ONE question is still one question to go and fix', () => {
  // Counting figures would send a teacher looking for a second problem that is
  // not there.
  const gate = describeExportBlock({
    issues: [], questionCount: 6,
    unresolvedFigures: [missingFigure(5), { ...missingFigure(5), kind: 'option_diagram' }],
  })
  assert.deepEqual(gate.numbers, [5])
  assert.equal(
    gate.message,
    'Question 5 requires a diagram, but the figure could not be rendered. '
    + 'Replace, regenerate or repair the diagram before exporting.',
  )
})

test('an unfinished question is reported BEFORE a missing figure', () => {
  // Both at once is a paper still being written. "Finish question 3" is the more
  // useful first instruction; the figure is the last thing between a finished
  // paper and the photocopier.
  const gate = describeExportBlock({
    issues: [emptyText('c', 'Question 3')],
    questionNumbers: { c: 3 },
    questionCount: 6,
    unresolvedFigures: [missingFigure(5)],
  })
  assert.equal(gate.reason, 'incomplete-questions')
})

test('an empty paper is still reported as empty, not as a figure problem', () => {
  const gate = describeExportBlock({
    issues: [], questionCount: 0, unresolvedFigures: [missingFigure(1)],
  })
  assert.equal(gate.reason, 'empty')
})

test('no unresolved figures leaves a clean paper ready', () => {
  // The failure this pins: an empty list read as a block would make every paper
  // in the studio un-exportable.
  for (const empty of [undefined, [], null]) {
    const gate = describeExportBlock({ issues: [], questionCount: 3, unresolvedFigures: empty })
    assert.equal(gate.blocked, false, String(empty))
    assert.equal(gate.reason, 'ready')
  }
})

test('a figure with no question number still blocks', () => {
  // Losing the number must never downgrade the verdict — the paper is just as
  // un-exportable, the message just cannot point at a card.
  const gate = describeExportBlock({
    issues: [], questionCount: 3,
    unresolvedFigures: [{ ...missingFigure(1), questionNumber: null }],
  })
  assert.equal(gate.blocked, true)
  assert.equal(gate.reason, 'unresolved-figure')
  assert.deepEqual(gate.numbers, [])
  assert.match(gate.message, /^A question on this paper requires a diagram/)
})

console.log(`✓ assessment export gate — ${passed} tests passed`)
