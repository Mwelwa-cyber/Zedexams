// The one-line summary the Paper Header collapses to
// (src/components/teacher/studio/paperHeaderSummary.js).
//
// The collapse only earns its place if the sentence it leaves behind is
// complete and honest. Two failure modes it must not have:
//
//   • collapsing a header that still needs answering, so the summary reads
//     "· · 2026 · 60 min" and HIDES the empty fields;
//   • printing a defaulted fact — a term the paper never stated, a page size
//     it never chose — which is a guess presented as a setting.

import assert from 'node:assert/strict'
import {
  headerIsComplete,
  missingHeaderFields,
  headerSummaryLine,
  headerSummarySegments,
  pageSetupPhrase,
  mcqPhrase,
} from '../src/components/teacher/studio/paperHeaderSummary.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const FULL = {
  schoolName: 'Jemareen Academy',
  grade: '4',
  subject: 'Integrated Science',
  assessmentType: 'end_of_term',
  term: '1',
  year: '2026',
  duration: 60,
  pageSize: 'a4',
  orientation: 'portrait',
  mcqOptionLayout: 'vertical',
  mcqAnswerChoiceCount: 4,
}

console.log('\npaperHeaderSummary — completeness\n')

test('a fully-answered header is complete', () => {
  assert.equal(headerIsComplete(FULL), true)
  assert.deepEqual(missingHeaderFields(FULL), [])
})

test('each required field is named when it is missing', () => {
  assert.deepEqual(missingHeaderFields({}), ['School name', 'Subject', 'Grade / level'])
  assert.deepEqual(missingHeaderFields({ ...FULL, subject: '' }), ['Subject'])
  assert.deepEqual(missingHeaderFields({ ...FULL, schoolName: '   ' }), ['School name'])
})

test('whitespace is not an answer', () => {
  assert.equal(headerIsComplete({ ...FULL, schoolName: '  ' }), false)
})

console.log('\nthe sentence\n')

test('states every decision the header holds', () => {
  assert.equal(
    headerSummaryLine(FULL),
    'Jemareen Academy · Grade 4 · Integrated Science · End of Term 1 · 2026 · 60 min · A4 portrait · MCQ A–D vertical',
  )
})

test('the class is included when the paper names one', () => {
  assert.match(headerSummaryLine({ ...FULL, className: '4A' }), /Class 4A/)
  assert.ok(!headerSummaryLine(FULL).includes('Class'))
})

test('an examination is never handed a term', () => {
  // Term is folded into the TYPE where the type takes one, so there is never a
  // separate Term segment — which is what stops a whole-syllabus examination
  // being labelled "Term 1".
  const line = headerSummaryLine({ ...FULL, assessmentType: 'examination', term: '1' })
  assert.match(line, /Examination/)
  assert.ok(!/Term/.test(line), line)
})

test('a fact the paper does not state is left out, never guessed', () => {
  const bare = { schoolName: 'X', grade: '4', subject: 'English', assessmentType: 'topic_test' }
  const segments = headerSummarySegments(bare)
  assert.ok(!segments.some(s => /min$/.test(s)), 'invented a duration')
  assert.ok(!segments.some(s => /portrait|landscape/.test(s)), 'invented a page setup')
  assert.ok(!segments.some(s => /^\d{4}$/.test(s)), 'invented a year')
})

test('a zero or nonsense duration is not printed as one', () => {
  for (const duration of [0, -5, '', 'soon', null]) {
    assert.ok(
      !headerSummarySegments({ ...FULL, duration }).some(s => /min$/.test(s)),
      `printed a duration for ${JSON.stringify(duration)}`,
    )
  }
})

console.log('\nthe two phrases that change every question\n')

test('page setup reads as a sheet, not as ids', () => {
  assert.equal(pageSetupPhrase({ pageSize: 'a4', orientation: 'portrait' }), 'A4 portrait')
  assert.equal(pageSetupPhrase({ pageSize: 'a5', orientation: 'landscape' }), 'A5 landscape')
  assert.equal(pageSetupPhrase({}), '')
})

test('the MCQ phrase names the choices and the layout', () => {
  assert.equal(mcqPhrase({ mcqAnswerChoiceCount: 4, mcqOptionLayout: 'vertical' }), 'MCQ A–D vertical')
  assert.equal(mcqPhrase({ mcqAnswerChoiceCount: 3, mcqOptionLayout: 'horizontal' }), 'MCQ A–C horizontal')
})

test('vertical is what an unstated layout reads as — the ECZ default', () => {
  assert.match(mcqPhrase({ mcqAnswerChoiceCount: 4 }), /vertical$/)
})

console.log(`\n${passed} assertions passed.`)
