// src/components/teacher/docTitleModel.js — the builder's document title.
//
// What is actually at stake here, and therefore what these assert:
//   • the type phrase it reads out is the FILED phrase differing only in case,
//     so the title bar and the stored document title cannot start disagreeing
//     about what kind of paper this is;
//   • a stored title that misreports the term is ignored, but a title a human
//     typed is never rewritten;
//   • the title degrades by PRIORITY — at a phone-sized column every
//     distinguishing fact (subject, grade, type, term, year, status) survives.

import assert from 'node:assert/strict'
import {
  titleCasePhrase, paperTypePhrase, paperTypeAbbrev,
  paperDisplayFacts, paperCustomName, composeDocTitle,
} from '../src/components/teacher/docTitleModel.js'
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

console.log('\ndocTitleModel — casing')

test('title-cases a phrase, keeping "of" lowercase and hyphens capitalised', () => {
  assert.equal(titleCasePhrase('END OF TERM 2 TEST'), 'End of Term 2 Test')
  assert.equal(titleCasePhrase('MID-TERM 1 TEST'), 'Mid-Term 1 Test')
  assert.equal(titleCasePhrase('MOCK EXAMINATION'), 'Mock Examination')
  assert.equal(titleCasePhrase(''), '')
})

test('a leading minor word is still capitalised', () => {
  assert.equal(titleCasePhrase('OF COURSE'), 'Of Course')
})

console.log('\ndocTitleModel — the type phrase never becomes a second opinion')

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

console.log('\ndocTitleModel — the document title degrades by priority')

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
