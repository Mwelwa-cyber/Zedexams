// Regression tests for how an assessment paper is NAMED
// (src/components/teacher/assessmentTitle.js).
//
// The bug: the generated title was level + type + year — "GRADE 4 END OF TERM 1
// TEST - 2026" — with no subject, and with a term that came from the studio's
// default rather than the paper. Seven Grade 4 papers spanning Integrated
// Science, Technology Studies and Home Economics across Terms 1 and 2 all
// carried that one name in the teacher's library.
//
// Two strings now, deliberately: the DOCUMENT title (the library name, carries
// the subject) and the printed HEADER title (no subject — the paper's header
// prints the subject on its own line right below it).

import assert from 'node:assert/strict'
import {
  buildAssessmentDocumentTitle,
  buildAssessmentHeaderTitle,
  assessmentTypePhrase,
  readPaperTerm,
  isGeneratedAssessmentTitle,
  generatedAssessmentTitleVariants,
  normalizeTitleForCompare,
} from '../src/components/teacher/assessmentTitle.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('buildAssessmentDocumentTitle — the library name')

test('THE BUG: the title carries grade, subject, type, term AND year', () => {
  const title = buildAssessmentDocumentTitle({
    grade: '4',
    subject: 'Integrated Science',
    assessmentType: 'end_of_term',
    term: '2',
    year: 2026,
  })
  assert.equal(title, 'GRADE 4 INTEGRATED SCIENCE - END OF TERM 2 TEST - 2026')
  // Spelled out as five separate claims, because the failure being guarded
  // against is a title that drops ONE of them and still looks plausible.
  assert.match(title, /GRADE 4/)
  assert.match(title, /INTEGRATED SCIENCE/)
  assert.match(title, /END OF TERM/)
  assert.match(title, /\b2\b/)
  assert.match(title, /2026/)
})

test('THE BUG: the seven duplicate papers now have seven distinguishable names', () => {
  // The reported collision, reproduced: three subjects across two terms, all
  // Grade 4 end-of-term 2026 papers.
  const reported = [
    { subject: 'Integrated Science', term: '1' },
    { subject: 'Integrated Science', term: '2' },
    { subject: 'Technology Studies', term: '1' },
    { subject: 'Technology Studies', term: '2' },
    { subject: 'Home Economics', term: '1' },
    { subject: 'Home Economics', term: '2' },
    { subject: 'Home Economics', term: '3' },
  ].map(paper => buildAssessmentDocumentTitle({
    grade: '4', assessmentType: 'end_of_term', year: 2026, ...paper,
  }))
  assert.equal(new Set(reported).size, 7, `titles collided: ${JSON.stringify(reported)}`)
})

test('the term comes from the paper, and a paper that states none is not given one', () => {
  // No term on the paper → the type's plain label, NOT "TERM 1". A default term
  // in the title is how a Term 2 paper came to be called a Term 1 paper.
  const titled = buildAssessmentDocumentTitle({
    grade: '4', subject: 'Home Economics', assessmentType: 'end_of_term', year: 2026,
  })
  assert.equal(titled, 'GRADE 4 HOME ECONOMICS - END-OF-TERM TEST - 2026')
  assert.doesNotMatch(titled, /TERM 1/)
})

test('reads every shape a term arrives in — 2, "2", "Term 2"', () => {
  assert.equal(readPaperTerm({ term: 2 }), '2')
  assert.equal(readPaperTerm({ term: ' 2 ' }), '2')
  assert.equal(readPaperTerm({ term: 'Term 2' }), '2')
  assert.equal(readPaperTerm({ term: 'TERM 3' }), '3')
  assert.equal(readPaperTerm({}), '')
  assert.equal(readPaperTerm({ term: '' }), '')
})

test('a Form paper is a FORM paper, and an ECE paper is not "GRADE ECE_N"', () => {
  assert.equal(
    buildAssessmentDocumentTitle({ grade: 'G9', subject: 'Mathematics', assessmentType: 'mid_term', term: '1', year: 2026 }),
    'FORM 2 MATHEMATICS - MID-TERM 1 TEST - 2026',
  )
  assert.match(
    buildAssessmentDocumentTitle({ grade: 'ECE_N', subject: 'Numeracy', assessmentType: 'topic_test', term: '1', year: 2026 }),
    /^NURSERY NUMERACY - TERM 1 /,
  )
})

test('a paper with no subject keeps the header shape it always had', () => {
  assert.equal(
    buildAssessmentDocumentTitle({ grade: '4', assessmentType: 'end_of_term', term: '1', year: 2026 }),
    'GRADE 4 END OF TERM 1 TEST - 2026',
  )
})

test('the year is read from the paper, not from today', () => {
  assert.match(
    buildAssessmentDocumentTitle({ grade: '4', subject: 'English', assessmentType: 'end_of_term', term: '1', year: 2024 }),
    /- 2024$/,
  )
  assert.match(
    buildAssessmentDocumentTitle(
      { grade: '4', subject: 'English', assessmentType: 'end_of_term', term: '1' },
      { fallbackYear: 2019 },
    ),
    /- 2019$/,
  )
})

console.log('assessmentTypePhrase')

test('examination-category papers carry no term and keep their own wording', () => {
  // An Examination is never titled "Mock Examination", and a whole-syllabus
  // paper is never labelled with one term.
  const mock = assessmentTypePhrase({ assessmentType: 'mock_exam', term: '2' })
  const exam = assessmentTypePhrase({ assessmentType: 'examination', term: '2' })
  const final = assessmentTypePhrase({ assessmentType: 'final_exam', term: '2' })
  for (const phrase of [mock, exam, final]) assert.doesNotMatch(phrase, /TERM/)
  assert.equal(new Set([mock, exam, final]).size, 3)
})

test('legacy stored types still title correctly', () => {
  assert.match(assessmentTypePhrase({ assessmentType: 'topic', term: '3' }), /TERM 3/)
  assert.doesNotMatch(assessmentTypePhrase({ assessmentType: 'mock', term: '3' }), /TERM/)
})

console.log('buildAssessmentHeaderTitle — the printed header')

test('the printed header omits the subject (the header prints it on its own line)', () => {
  const paper = {
    grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term', term: '2', year: 2026,
  }
  assert.equal(buildAssessmentHeaderTitle(paper), 'GRADE 4 END OF TERM 2 TEST - 2026')
  assert.doesNotMatch(buildAssessmentHeaderTitle(paper), /INTEGRATED SCIENCE/)
})

console.log('isGeneratedAssessmentTitle — what a migration may rewrite')

test('recognises the current document title', () => {
  const paper = { grade: '4', subject: 'Home Economics', assessmentType: 'end_of_term', term: '2', year: 2026 }
  assert.equal(isGeneratedAssessmentTitle(buildAssessmentDocumentTitle(paper), paper), true)
})

test('recognises the old subject-less title', () => {
  const paper = { grade: '4', subject: 'Home Economics', assessmentType: 'end_of_term', term: '2', year: 2026 }
  assert.equal(isGeneratedAssessmentTitle('GRADE 4 END OF TERM 2 TEST - 2026', paper), true)
})

test('THE BUG: recognises a title stamped with the WRONG term', () => {
  // A Term 2 paper whose stored title says TERM 1 — the exact state the seven
  // reported papers are in. A migration that only matched the paper's own term
  // would read this as a teacher's own wording and leave the collision in place.
  const paper = { grade: '4', subject: 'Home Economics', assessmentType: 'end_of_term', term: '2', year: 2026 }
  assert.equal(isGeneratedAssessmentTitle('GRADE 4 END OF TERM 1 TEST - 2026', paper), true)
})

test('dash flavour and casing are not what makes a title different', () => {
  const paper = { grade: '4', subject: 'English', assessmentType: 'end_of_term', term: '1', year: 2026 }
  assert.equal(isGeneratedAssessmentTitle('GRADE 4 END OF TERM 1 TEST – 2026', paper), true)
  assert.equal(isGeneratedAssessmentTitle('grade 4  end of term 1 test — 2026', paper), true)
  assert.equal(normalizeTitleForCompare(' a – b ' ), 'A - B')
})

test("a teacher's own wording is never claimed as generated", () => {
  const paper = { grade: '4', subject: 'English', assessmentType: 'end_of_term', term: '1', year: 2026 }
  assert.equal(isGeneratedAssessmentTitle('Revision paper for Mrs Banda\'s class', paper), false)
  assert.equal(isGeneratedAssessmentTitle('GRADE 4 END OF TERM 1 TEST - 2025', paper), false)
  assert.equal(isGeneratedAssessmentTitle('GRADE 5 END OF TERM 1 TEST - 2026', paper), false)
})

test('a blank title counts as generated (the studio fills one in)', () => {
  assert.equal(isGeneratedAssessmentTitle('', { grade: '4' }), true)
  assert.equal(isGeneratedAssessmentTitle(null, { grade: '4' }), true)
})

test('the variant set covers both shapes for every term', () => {
  const variants = generatedAssessmentTitleVariants({
    grade: '4', subject: 'English', assessmentType: 'end_of_term', term: '2', year: 2026,
  })
  assert.ok(variants.includes('GRADE 4 END OF TERM 1 TEST - 2026'))
  assert.ok(variants.includes('GRADE 4 ENGLISH - END OF TERM 3 TEST - 2026'))
  // …and the termless shape, for papers saved before the term reached the title.
  assert.ok(variants.includes('GRADE 4 END-OF-TERM TEST - 2026'))
})

console.log(`\n${passed} assertions passed.`)
