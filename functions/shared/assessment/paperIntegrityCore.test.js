/**
 * The defects a paper can have while every question is finished.
 *
 * Each case here is one a teacher would have discovered in a classroom: a
 * question number that does not exist, a marking key marking against a choice
 * the paper does not print, a cover total that contradicts the questions.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  INTEGRITY_ISSUES, checkNumbering, checkChoiceConsistency,
  collectPaperIntegrityIssues, integrityBlock,
} from './paperIntegrityCore.js'
import { CHOICE_ISSUES } from './answerChoicesCore.js'
import { MARKS_ISSUES } from './paperMarksCore.js'

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

const codes = (list) => list.map((i) => i.code)
const mcq = (over = {}) => ({
  type: 'mcq', options: ['a', 'b', 'c', 'd'], correctAnswer: 0, marks: 1, ...over,
})

console.log('\n— question numbering —')

test('a continuous paper has nothing to report', () => {
  assert.deepEqual(checkNumbering([1, 2, 3, 4]), [])
})

test('a gap is named by the number that is missing', () => {
  const issues = checkNumbering([1, 2, 3, 5])
  assert.deepEqual(codes(issues), [INTEGRITY_ISSUES.NUMBERING_GAP])
  assert.match(issues[0].message, /there is no question 4/)
})

test('a wider gap says how many are missing rather than naming one', () => {
  assert.match(checkNumbering([1, 5])[0].message, /skipping 3 numbers/)
})

test('two questions with the same number is its own defect', () => {
  const issues = checkNumbering([1, 2, 2, 3])
  assert.deepEqual(codes(issues), [INTEGRITY_ISSUES.NUMBERING_DUPLICATE])
  assert.match(issues[0].message, /both numbered 2/)
})

test('an empty paper is not a numbering defect', () => {
  assert.deepEqual(checkNumbering([]), [])
})

console.log('\n— answer choices —')

test('a paper set to A–C whose answer was D is blocked', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { answerChoiceCount: 3 },
    // Four stored options, the fourth marked correct. Rendering trims to three,
    // so the marking key would mark against a choice the learner never sees.
    questions: [mcq({ options: ['a', 'b', 'c', 'd'], correctAnswer: 3 })],
  })
  assert.ok(codes(result.blockers).includes(CHOICE_ISSUES.CORRECT_OUT_OF_RANGE))
})

test('the same paper at A–D is fine', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { answerChoiceCount: 4 },
    questions: [mcq({ correctAnswer: 3 })],
  })
  assert.deepEqual(result.blockers, [])
})

test('two distractors that are the same value written two ways are blocked', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { answerChoiceCount: 4 },
    questions: [mcq({ options: ['1/2', '1/3', '0.5', '3/4'] })],
  })
  assert.ok(codes(result.blockers).includes(CHOICE_ISSUES.EQUIVALENT_CHOICE))
})

test('a paper that never configured a count is judged on what it holds', () => {
  // Five options, no setting. The paper prints five, so five is correct — the
  // grade recommendation must not be applied retroactively to a saved paper.
  const result = collectPaperIntegrityIssues({
    assessment: { grade: 7 },
    questions: [mcq({ options: ['a', 'b', 'c', 'd', 'e'], correctAnswer: 4 })],
  })
  assert.deepEqual(result.blockers, [])
})

test('a section that mixes choice counts is a warning, not a blocker', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { parts: [{ id: 'p1', title: 'A' }] },
    questions: [
      mcq({ partId: 'p1', options: ['a', 'b', 'c'] }),
      mcq({ partId: 'p1', options: ['a', 'b', 'c', 'd'] }),
    ],
  })
  assert.ok(codes(result.warnings).includes(INTEGRITY_ISSUES.MIXED_CHOICE_COUNT))
  assert.deepEqual(result.blockers, [])
})

test('a section that configured a count reports each question, not the mix', () => {
  // Both messages describe the same defect; saying both names it twice.
  const result = collectPaperIntegrityIssues({
    assessment: { parts: [{ id: 'p1', title: 'A', answerChoiceCount: 4 }] },
    questions: [
      mcq({ partId: 'p1', options: ['a', 'b', 'c'] }),
      mcq({ partId: 'p1', options: ['a', 'b', 'c', 'd'] }),
    ],
  })
  assert.ok(!codes(result.warnings).includes(INTEGRITY_ISSUES.MIXED_CHOICE_COUNT))
  assert.ok(codes(result.blockers).includes(CHOICE_ISSUES.WRONG_COUNT))
})

test('checkChoiceConsistency ignores a group with one count', () => {
  assert.deepEqual(checkChoiceConsistency([
    { id: 'p1', label: 'Section A', configured: null, questions: [{ type: 'mcq', optionCount: 4, number: 1 }] },
  ]), [])
})

console.log('\n— marks —')

test('a cover total that contradicts the questions is blocked', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { declaredTotalMarks: 40 },
    questions: [mcq({ marks: 1 }), mcq({ marks: 1 })],
  })
  const issue = result.blockers.find((i) => i.code === MARKS_ISSUES.PAPER_TOTAL_CONFLICT)
  assert.ok(issue)
  assert.match(issue.message, /set to 40 total marks but its questions add up to 2/)
})

test('a section total that contradicts its questions is blocked', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { parts: [{ id: 'p1', title: 'A', marks: 25 }] },
    questions: [mcq({ partId: 'p1', marks: 1 })],
  })
  assert.ok(codes(result.blockers).includes(MARKS_ISSUES.SECTION_TOTAL_CONFLICT))
})

test('a uniform section is worth its per-question mark times its questions', () => {
  // 25 one-mark questions read 25 marks — the §11 acceptance result — and the
  // stored per-question marks are not consulted at all.
  const result = collectPaperIntegrityIssues({
    assessment: { parts: [{ id: 'p1', title: 'A', marksMode: 'uniform', marksPerQuestion: 1 }] },
    questions: Array.from({ length: 25 }, () => mcq({ partId: 'p1', marks: 3 })),
  })
  assert.equal(result.marks.totalMarks, 25)
  assert.equal(result.marks.sections[0].marks, 25)
})

test('a question the teacher locked keeps its own mark in a uniform section', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { parts: [{ id: 'p1', title: 'A', marksMode: 'uniform', marksPerQuestion: 1 }] },
    questions: [mcq({ partId: 'p1', marks: 1 }), mcq({ partId: 'p1', marks: 5, marksLocked: true })],
  })
  assert.equal(result.marks.totalMarks, 6)
})

console.log('\n— the sentence a teacher reads —')

test('nothing wrong reads as nothing, never as a block', () => {
  assert.equal(integrityBlock([]), null)
  assert.equal(integrityBlock(null), null)
})

test('one problem is stated and the teacher is told what to do', () => {
  const block = integrityBlock([{ code: 'x', message: 'Question 3 has no correct answer selected.', questionNumber: 3 }])
  assert.equal(block.blocked, true)
  assert.deepEqual(block.numbers, [3])
  assert.match(block.message, /Fix that, then download\./)
})

test('several problems name the first and count the rest', () => {
  const block = integrityBlock([
    { code: 'x', message: 'First problem.', questionNumber: 1 },
    { code: 'y', message: 'Second.', questionNumber: 2 },
    { code: 'z', message: 'Third.', questionNumber: 3 },
  ])
  assert.match(block.message, /First problem\. There are 2 other problems/)
  assert.deepEqual(block.numbers, [1, 2, 3])
})

console.log('\n— a finished, correct paper —')

test('a healthy paper reports nothing at all', () => {
  const result = collectPaperIntegrityIssues({
    assessment: { answerChoiceCount: 4, parts: [{ id: 'p1', title: 'A' }] },
    questions: [
      mcq({ partId: 'p1', options: ['Heart', 'Lung', 'Liver', 'Kidney'], correctAnswer: 0 }),
      mcq({ partId: 'p1', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 2 }),
    ],
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.marks.totalMarks, 2)
})

test('an empty paper is not an integrity failure — it is the gate’s "empty"', () => {
  const result = collectPaperIntegrityIssues({ assessment: {}, questions: [] })
  assert.deepEqual(result.blockers, [])
})

console.log(`\n✓ paper integrity — ${passed} tests passed`)
