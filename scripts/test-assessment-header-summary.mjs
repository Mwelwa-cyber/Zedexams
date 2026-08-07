// src/components/teacher/assessmentHeaderSummary.js
//
// The rule that decides whether the eighteen-field Paper Header form gets out
// of the teacher's way, and the one line it collapses to.
//
// The failure this guards against is a form that hides settings a teacher has
// not finished setting: a paper missing its school name or its duration is a
// paper whose header is not done, and collapsing it would bury the reason the
// export is about to be refused.

import assert from 'node:assert/strict'
import {
  missingHeaderFields, headerIsComplete, shouldCollapsePaperHeader,
  pageSetupLabel, mcqSummaryLabel, paperHeaderSummaryLine, paperHeaderSummarySegments,
} from '../src/components/teacher/assessmentHeaderSummary.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const complete = {
  schoolName: 'Jemareen Academy',
  grade: '4',
  subject: 'Integrated Science',
  assessmentType: 'end_of_term',
  term: '1',
  year: 2026,
  duration: 60,
  pageSize: 'a4',
  orientation: 'portrait',
  mcqAnswerChoiceCount: 4,
  mcqOptionLayout: 'vertical',
}

console.log('\nassessmentHeaderSummary — completeness')

test('a filled header is complete', () => {
  assert.deepEqual(missingHeaderFields(complete), [])
  assert.equal(headerIsComplete(complete), true)
})

test('a blank school name is a missing field, not an empty string that passes', () => {
  assert.deepEqual(missingHeaderFields({ ...complete, schoolName: '   ' }), ['schoolName'])
  assert.equal(headerIsComplete({ ...complete, schoolName: '' }), false)
})

test('an empty form reports every required field', () => {
  assert.deepEqual(missingHeaderFields({}), [
    'schoolName', 'grade', 'subject', 'assessmentType', 'term', 'year', 'duration',
  ])
})

test('optional fields cannot hold the form open', () => {
  assert.equal(headerIsComplete({ ...complete, className: '', assessmentDate: '' }), true)
})

console.log('\nassessmentHeaderSummary — when it collapses')

test('a brand-new paper keeps the form open, even once every field is filled', () => {
  // On a new paper these settings ARE the task.
  assert.equal(shouldCollapsePaperHeader({ form: complete, savedOnce: false }), false)
})

test('collapses once the paper has been filed and the header is complete', () => {
  assert.equal(shouldCollapsePaperHeader({ form: complete, savedOnce: true }), true)
})

test('an incomplete header never collapses, however many times it was saved', () => {
  assert.equal(
    shouldCollapsePaperHeader({ form: { ...complete, duration: '' }, savedOnce: true }),
    false,
  )
})

test('the teacher’s own choice outranks the rule, both ways', () => {
  assert.equal(shouldCollapsePaperHeader({ form: complete, savedOnce: true, override: true }), false)
  assert.equal(shouldCollapsePaperHeader({ form: complete, savedOnce: false, override: false }), true)
})

test('called with nothing at all, it does not collapse', () => {
  assert.equal(shouldCollapsePaperHeader(), false)
})

console.log('\nassessmentHeaderSummary — the one line')

test('reads as the header does', () => {
  assert.equal(
    paperHeaderSummaryLine(complete),
    'Jemareen Academy · Grade 4 · Integrated Science · End of Term 1 · 2026 · 60 min · A4 portrait · MCQ A–D vertical',
  )
})

test('names the sheet and the MCQ shape the paper will actually print', () => {
  assert.equal(pageSetupLabel({ pageSize: 'a5', orientation: 'landscape' }), 'A5 landscape')
  assert.equal(pageSetupLabel({}), 'A4 portrait')
  assert.equal(mcqSummaryLabel({ mcqAnswerChoiceCount: 3 }), 'MCQ A–C vertical')
  assert.equal(mcqSummaryLabel({ mcqAnswerChoiceCount: 5, mcqOptionLayout: 'horizontal' }), 'MCQ A–E horizontal')
  assert.equal(mcqSummaryLabel({}), 'MCQ A–D vertical')
})

test('a missing fact is left out rather than printed as a gap', () => {
  const segments = paperHeaderSummarySegments({ ...complete, schoolName: '', duration: '' })
  assert.ok(!segments.some((s) => s === '' || s === 'min'))
  assert.ok(!paperHeaderSummaryLine({ ...complete, schoolName: '' }).startsWith(' ·'))
})

test('the term shown is the paper’s own', () => {
  assert.match(paperHeaderSummaryLine({ ...complete, term: '3' }), /End of Term 3/)
})

console.log(`\n${passed} assertions passed.\n`)
