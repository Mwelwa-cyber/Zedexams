/**
 * Question → section → paper, from one rule.
 *
 * The failure this guards is a paper that is arithmetically correct in five
 * places over four different sets of questions.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  DEFAULT_MCQ_MARKS, MARKS_ISSUES, computeMarksModel, marksLabel, normalizeMarks,
  normalizeMarksMode, resolveQuestionMarks, sectionOfQuestion, showMarksFor,
} from './paperMarksCore.js'

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

console.log('\n— one question —')

test('multiple choice defaults to one mark', () => {
  assert.equal(resolveQuestionMarks({ type: 'mcq' }), DEFAULT_MCQ_MARKS)
  assert.equal(resolveQuestionMarks({ type: 'tf' }), 1)
})

test('a stored mark wins over the default', () => {
  assert.equal(resolveQuestionMarks({ type: 'mcq', marks: 3 }), 3)
})

test('a uniform section overrides the stored mark', () => {
  assert.equal(
    resolveQuestionMarks({ type: 'short', marks: 4 }, { marksMode: 'uniform', marksPerQuestion: 2 }),
    2,
  )
})

test('…but not one the teacher locked', () => {
  // Switching a section to uniform must not silently rewrite a mark that was set
  // on purpose. The only evidence would be the total moving.
  assert.equal(
    resolveQuestionMarks({ type: 'short', marks: 4, marksLocked: true }, { marksMode: 'uniform', marksPerQuestion: 2 }),
    4,
  )
})

test('a uniform section with no per-question mark falls through', () => {
  assert.equal(resolveQuestionMarks({ type: 'mcq', marks: 3 }, { marksMode: 'uniform' }), 3)
})

test('half marks survive, thirds do not', () => {
  assert.equal(normalizeMarks(2.5), 2.5)
  assert.equal(normalizeMarks(1 / 3), 0.5)
  assert.equal(normalizeMarks(-1), null)
  assert.equal(normalizeMarks('x'), null)
  assert.equal(normalizeMarks(undefined, 7), 7)
})

test('an unknown marking mode is individual', () => {
  assert.equal(normalizeMarksMode('nonsense'), 'individual')
  assert.equal(normalizeMarksMode('uniform'), 'uniform')
})

console.log('\n— showing the mark —')

test('marks print unless something turns them off', () => {
  assert.equal(showMarksFor(null, null), true)
  assert.equal(showMarksFor(null, { showQuestionMarks: false }), false)
  assert.equal(showMarksFor({ showMarks: true }, { showQuestionMarks: false }), true,
    'a section decides for itself before the paper does')
})

console.log('\n— the whole paper —')

const paper = {
  parts: [
    { id: 'p1', title: 'Multiple choice', marksMode: 'uniform', marksPerQuestion: 1 },
    { id: 'p2', title: 'Structured' },
  ],
}
const questions = [
  ...Array.from({ length: 25 }, () => ({ type: 'mcq', partId: 'p1', marks: 1 })),
  { type: 'short', partId: 'p2', marks: 5 },
  { type: 'essay', partId: 'p2', marks: 10 },
]

test('a 25-question one-mark section is 25 marks', () => {
  const model = computeMarksModel(paper, questions)
  assert.equal(model.sections[0].marks, 25)
  assert.equal(model.sections[0].questionCount, 25)
})

test('the paper total is the sum of its sections', () => {
  const model = computeMarksModel(paper, questions)
  assert.equal(model.totalMarks, 40)
  assert.equal(model.conflicted, false)
})

test('questions outside any section are counted too', () => {
  const model = computeMarksModel(paper, [...questions, { type: 'short', marks: 2 }])
  assert.equal(model.ungrouped.marks, 2)
  assert.equal(model.totalMarks, 42)
})

test('a declared paper total that disagrees is a conflict, not a correction', () => {
  const model = computeMarksModel({ ...paper, declaredTotalMarks: 50 }, questions)
  assert.equal(model.conflicted, true)
  assert.equal(model.totalMarks, 40, 'the computed sum is still reported honestly')
  assert.ok(model.issues.some((i) => i.code === MARKS_ISSUES.PAPER_TOTAL_CONFLICT))
})

test('a declared total that agrees is not a conflict', () => {
  assert.equal(computeMarksModel({ ...paper, declaredTotalMarks: 40 }, questions).conflicted, false)
})

test('a paper of nothing but zero-mark questions is one error, not twenty-five', () => {
  const model = computeMarksModel({}, Array.from({ length: 25 }, () => ({ type: 'mcq', marks: 0 })))
  assert.deepEqual(model.issues.map((i) => i.code), [MARKS_ISSUES.NO_MARKS])
})

test('one zero-mark question among others is a warning naming it', () => {
  const model = computeMarksModel({}, [{ type: 'mcq', marks: 1 }, { type: 'mcq', marks: 0 }])
  const issue = model.issues.find((i) => i.code === MARKS_ISSUES.ZERO_MARK_QUESTION)
  assert.equal(issue.severity, 'warning')
  assert.equal(issue.questionNumber, 2)
})

test('an empty paper has no marks and no complaints', () => {
  const model = computeMarksModel({}, [])
  assert.equal(model.totalMarks, 0)
  assert.deepEqual(model.issues, [])
})

test('a question finds its section', () => {
  assert.equal(sectionOfQuestion({ partId: 'p2' }, paper.parts).title, 'Structured')
  assert.equal(sectionOfQuestion({}, paper.parts), null)
  assert.equal(sectionOfQuestion({ partId: 'gone' }, paper.parts), null)
})

console.log('\n— the words —')

test('one mark is singular', () => {
  assert.equal(marksLabel(1), '1 mark')
  assert.equal(marksLabel(0), '0 marks')
  assert.equal(marksLabel(2.5), '2.5 marks')
})

console.log(`\n✓ paper marks — ${passed} tests passed`)
