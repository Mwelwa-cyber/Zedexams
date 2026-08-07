// src/components/teacher/paperDisplayTitle.js — the names a teacher READS.
//
// What is actually at stake here, and therefore what these assert:
//   • the card title always carries the SUBJECT and the paper's OWN term, so
//     seven different Grade 4 papers cannot share one name;
//   • a stored title that misreports the term is ignored, but a title a human
//     typed is never rewritten;
//   • the document title degrades by PRIORITY — at 360px every distinguishing
//     fact (subject, grade, type, term, year, status) is still on screen.

import assert from 'node:assert/strict'
import {
  titleCasePhrase, paperTypePhrase, paperTypeAbbrev, paperCardTitle,
  paperDisplayFacts, paperCustomName, composeDocTitle,
} from '../src/components/teacher/paperDisplayTitle.js'
import { assessmentTypePhrase } from '../src/components/teacher/assessmentTitle.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const g4science = {
  grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term',
  term: '1', year: 2026,
}

console.log('\npaperDisplayTitle — casing')

test('title-cases a phrase, keeping "of" lowercase and hyphens capitalised', () => {
  assert.equal(titleCasePhrase('END OF TERM 2 TEST'), 'End of Term 2 Test')
  assert.equal(titleCasePhrase('MID-TERM 1 TEST'), 'Mid-Term 1 Test')
  assert.equal(titleCasePhrase('MOCK EXAMINATION'), 'Mock Examination')
  assert.equal(titleCasePhrase(''), '')
})

test('a leading minor word is still capitalised', () => {
  assert.equal(titleCasePhrase('OF COURSE'), 'Of Course')
})

console.log('\npaperDisplayTitle — the type phrase never becomes a second opinion')

test('the read phrase is the filed phrase, differing only in case', () => {
  // If this ever fails, the library card and the filed document title have
  // started disagreeing about what kind of paper this is.
  const papers = [
    { assessmentType: 'end_of_term', term: '2' },
    { assessmentType: 'mid_term', term: '1' },
    { assessmentType: 'topic_test', term: '3' },
    { assessmentType: 'weekly_test', term: '' },
    { assessmentType: 'mock_exam', term: '2' },
    { assessmentType: 'examination', term: '1' },
    { assessmentType: 'final_exam' },
    { assessmentType: 'mock' },           // legacy stored value
    { assessmentType: undefined },        // a paper that states no type
  ]
  for (const p of papers) {
    const upper = assessmentTypePhrase({ assessmentType: p.assessmentType, term: p.term ?? '' })
    assert.equal(paperTypePhrase(p).toUpperCase(), upper, JSON.stringify(p))
  }
})

test('an examination never carries a term, whatever the paper stores', () => {
  assert.equal(paperTypePhrase({ assessmentType: 'examination', term: '2' }), 'Examination')
  assert.equal(paperTypePhrase({ assessmentType: 'mock_exam', term: '3' }), 'Mock Examination')
})

test('abbreviations are declared, not truncated', () => {
  assert.equal(paperTypeAbbrev({ assessmentType: 'end_of_term', term: '1' }), 'EOT 1')
  assert.equal(paperTypeAbbrev({ assessmentType: 'end_of_term' }), 'EOT')
  assert.equal(paperTypeAbbrev({ assessmentType: 'mid_term', term: '2' }), 'Mid-Term 2')
  assert.equal(paperTypeAbbrev({ assessmentType: 'examination' }), 'Exam')
  assert.equal(paperTypeAbbrev({ assessmentType: 'topic_test', term: '3' }), 'Topic T3')
})

console.log('\npaperDisplayTitle — the card title')

test('always carries the subject', () => {
  assert.equal(
    paperCardTitle(g4science),
    'Grade 4 Integrated Science — End of Term 1 Test',
  )
})

test('two papers differing only in subject read as two papers', () => {
  const a = paperCardTitle(g4science)
  const b = paperCardTitle({ ...g4science, subject: 'Technology Studies' })
  assert.notEqual(a, b)
  assert.match(b, /Technology Studies/)
})

test('two papers differing only in term read as two papers', () => {
  const a = paperCardTitle(g4science)
  const b = paperCardTitle({ ...g4science, term: '2' })
  assert.notEqual(a, b)
  assert.match(b, /End of Term 2 Test$/)
})

test('the term comes from the term field, not from a stale stored title', () => {
  // The live paper this was written for: its stored title says Term 1, its
  // term field says 2. Reporting the title would misreport the paper.
  const drifted = { ...g4science, term: '2', title: 'GRADE 4 END OF TERM 1 TEST - 2026' }
  assert.match(paperCardTitle(drifted), /End of Term 2 Test/)
  assert.doesNotMatch(paperCardTitle(drifted), /Term 1/)
})

test("a name the teacher typed is theirs, and wins", () => {
  const named = { ...g4science, title: 'Revision before the holidays' }
  assert.equal(paperCustomName(named), 'Revision before the holidays')
  assert.equal(paperCardTitle(named), 'Revision before the holidays')
})

test('a paper with no subject still gets a usable name', () => {
  assert.equal(
    paperCardTitle({ grade: '4', assessmentType: 'end_of_term', term: '1', year: 2026 }),
    'Grade 4 — End of Term 1 Test',
  )
})

test('a Paper 1 / Paper 2 split is part of the identity', () => {
  assert.equal(
    paperCardTitle({ ...g4science, paperName: 'Paper 2' }),
    'Grade 4 Integrated Science — End of Term 1 Test · Paper 2',
  )
})

test('an empty paper does not render an empty title', () => {
  assert.ok(paperCardTitle({}).length > 0)
})

console.log('\npaperDisplayTitle — the document title degrades by priority')

const DISTINGUISHING = [/Integrated Science/, /Grade 4|G4/, /2026/]

test('wide keeps everything on one line', () => {
  const t = composeDocTitle(g4science, { width: 1200 })
  assert.equal(t.mode, 'wide')
  assert.equal(t.line1, 'Grade 4 Integrated Science — End of Term 1 Test · 2026')
  assert.equal(t.line2, '')
})

test('medium drops "Test" and abbreviates — nothing distinguishing is lost', () => {
  const t = composeDocTitle(g4science, { width: 380 })
  assert.equal(t.mode, 'medium')
  assert.equal(t.line1, 'Grade 4 Integrated Science — EOT 1 · 2026')
  for (const re of DISTINGUISHING) assert.match(t.line1, re)
  // The term is the fact an ellipsis would have eaten first.
  assert.match(t.line1, /1/)
})

test('narrow stacks: subject leads, the rest rides on line 2 with the status', () => {
  const t = composeDocTitle(g4science, { width: 200, status: 'Draft' })
  assert.equal(t.mode, 'narrow')
  assert.equal(t.line1, 'Integrated Science')
  assert.equal(t.line2, 'Grade 4 · End of Term 1 · 2026 · Draft')
})

test('at a phone-sized container every distinguishing fact is still rendered somewhere', () => {
  const t = composeDocTitle(g4science, { width: 200, status: 'Draft' })
  const all = `${t.line1} ${t.line2}`
  for (const re of [/Integrated Science/, /Grade 4/, /End of Term/, /\b1\b/, /2026/, /Draft/]) {
    assert.match(all, re)
  }
})

test('a custom name leads on narrow, with the derived meta beneath it', () => {
  const t = composeDocTitle({ ...g4science, title: 'Holiday revision' }, { width: 200, status: 'Draft' })
  assert.equal(t.line1, 'Holiday revision')
  assert.equal(t.line2, 'Grade 4 Integrated Science · End of Term 1 · 2026 · Draft')
})

test('no status word means no trailing separator', () => {
  const t = composeDocTitle(g4science, { width: 200 })
  assert.equal(t.line2, 'Grade 4 · End of Term 1 · 2026')
})

test('facts ride along for callers that need the pieces', () => {
  const f = paperDisplayFacts(g4science)
  assert.equal(f.level, 'Grade 4')
  assert.equal(f.subject, 'Integrated Science')
  assert.equal(f.term, '1')
  assert.equal(f.year, '2026')
  assert.equal(f.typeNoTest, 'End of Term 1')
})

test('a Form paper says Form, not Grade', () => {
  const t = composeDocTitle({ grade: 'G8', subject: 'Biology', assessmentType: 'examination', year: 2026 }, { width: 1200 })
  assert.equal(t.line1, 'Form 1 Biology — Examination · 2026')
})

console.log(`\n${passed} assertions passed.\n`)
