/**
 * The words that identify a paper.
 *
 * The case that matters most is the one that changed: a studio showing "Grade 4"
 * everywhere produced a download whose header said "GRADE FOUR", because a word
 * lookup ran unconditionally. Nobody chose that, and a teacher searching their
 * downloads for "Grade 4 Mathematics" did not find the file.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  DEFAULT_GRADE_NUMBER_STYLE, LEARNER_NAME_LABELS,
  buildPaperMetadata, formatGradeToken, normalizeGradeNumberStyle,
  resolveLearnerFields, resolveNameFieldLabel,
} from './paperMetadata.js'

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

console.log('\n— the grade —')

test('numerals are the default, and that is the whole point', () => {
  assert.equal(DEFAULT_GRADE_NUMBER_STYLE, 'numeral')
  assert.equal(formatGradeToken(4), '4')
  assert.equal(formatGradeToken('7'), '7')
})

test('the written-number style is still available to a school that wants it', () => {
  assert.equal(formatGradeToken(4, 'word'), 'FOUR')
  assert.equal(formatGradeToken(12, 'word'), 'TWELVE')
})

test('a level that is not a number is never invented a word form', () => {
  // The 2013 syllabus says "Form 4"; a nursery band is not a number at all.
  assert.equal(formatGradeToken('Form 4', 'word'), 'FORM 4')
  assert.equal(formatGradeToken('Nursery', 'word'), 'NURSERY')
  assert.equal(formatGradeToken(13, 'word'), '13', 'beyond the word list, the numeral stands')
})

test('no grade produces no token rather than the string "undefined"', () => {
  assert.equal(formatGradeToken(undefined), '')
  assert.equal(formatGradeToken(''), '')
})

test('an unknown style is numerals', () => {
  assert.equal(normalizeGradeNumberStyle('roman'), 'numeral')
  assert.equal(normalizeGradeNumberStyle('WORD'), 'word')
})

console.log('\n— learner fields —')

test('the default name label is "Name"', () => {
  assert.equal(resolveNameFieldLabel({}), 'Name')
})

test('a mock examination can say Candidate and a Grade 3 test can say Pupil', () => {
  assert.equal(resolveNameFieldLabel({ nameFieldStyle: 'candidate' }), "Candidate's Name")
  assert.equal(resolveNameFieldLabel({ nameFieldStyle: 'pupil' }), "Pupil's Name")
  assert.equal(resolveNameFieldLabel({ nameFieldStyle: 'learner' }), "Learner's Name")
})

test('a custom label is used, trimmed, and capped', () => {
  assert.equal(resolveNameFieldLabel({ nameFieldStyle: 'custom', nameFieldLabel: '  Examinee  ' }), 'Examinee')
  const long = resolveNameFieldLabel({ nameFieldStyle: 'custom', nameFieldLabel: 'x'.repeat(200) })
  assert.equal(long.length, 40, 'an unbounded label pushes the ruled line off the page')
})

test('an empty custom label falls back rather than printing a bare rule', () => {
  assert.equal(resolveNameFieldLabel({ nameFieldStyle: 'custom', nameFieldLabel: '   ' }), 'Name')
})

test('the preset list offers the four real ones plus custom', () => {
  assert.deepEqual(
    LEARNER_NAME_LABELS.map((o) => o.id),
    ['name', 'learner', 'pupil', 'candidate', 'custom'],
  )
})

test('field visibility keeps its existing defaults so no saved paper changes shape', () => {
  const fields = resolveLearnerFields({})
  assert.equal(fields.name.show, true)
  assert.equal(fields.date.show, true)
  assert.equal(fields.marks.show, true)
  assert.equal(fields.classField.show, false)
})

test('a paper that turned a field off keeps it off', () => {
  assert.equal(resolveLearnerFields({ showNameField: false }).name.show, false)
  assert.equal(resolveLearnerFields({ showClassField: true }).classField.show, true)
})

console.log('\n— the metadata block —')

test('everything a renderer prints is resolved once, here', () => {
  const meta = buildPaperMetadata({
    schoolName: '  Kabulonga Primary  ',
    subject: ' Mathematics ',
    grade: 4,
    term: 2,
    year: 2026,
    assessmentType: 'end_of_term',
  })
  assert.equal(meta.schoolName, 'Kabulonga Primary')
  assert.equal(meta.subject, 'Mathematics')
  assert.equal(meta.gradeToken, '4')
  assert.equal(meta.year, 2026)
})

test('the year comes from the date when nothing else says', () => {
  assert.equal(buildPaperMetadata({ assessmentDate: '2024-03-15' }).year, 2024)
})

test('a paper with nothing on it still produces a complete block', () => {
  const meta = buildPaperMetadata({})
  assert.equal(meta.schoolName, '')
  assert.equal(typeof meta.year, 'number')
  assert.ok(meta.learnerFields.name)
})

console.log(`\n✓ paper metadata — ${passed} tests passed`)
