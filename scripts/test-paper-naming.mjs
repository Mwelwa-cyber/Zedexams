// src/components/teacher/paperNaming.js — the name a teacher READS.
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
  titleCasePhrase, paperTypePhrase, paperTypeAbbrev, readableSubject,
  paperDisplayFacts, paperCustomName, paperCardTitle, composeDocTitle,
} from '../src/components/teacher/paperNaming.js'
import {
  assessmentTypePhrase, isTeacherAuthoredTitle,
} from '../src/components/teacher/assessmentTitle.js'
import { planTitleBackfill } from './backfill-assessment-titles.mjs'

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

console.log('\npaperNaming — casing')

test('title-cases a phrase, keeping "of" lowercase and hyphens capitalised', () => {
  assert.equal(titleCasePhrase('END OF TERM 2 TEST'), 'End of Term 2 Test')
  assert.equal(titleCasePhrase('MID-TERM 1 TEST'), 'Mid-Term 1 Test')
  assert.equal(titleCasePhrase('MOCK EXAMINATION'), 'Mock Examination')
  assert.equal(titleCasePhrase(''), '')
})

test('a leading minor word is still capitalised', () => {
  assert.equal(titleCasePhrase('OF COURSE'), 'Of Course')
})

console.log('\npaperNaming — the type phrase never becomes a second opinion')

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

console.log('\npaperNaming — whose name is on the paper')

// The decision the library card, the builder's title bar and the title
// BACKFILL all now share. It matters most in the backfill, which writes: a
// wrong answer there renames a teacher's paper in Firestore, unattended.

test('an explicit manual flag is the teacher’s name, and wins', () => {
  const paper = { title: 'Mrs Zulu Friday Revision Special', titleSource: 'manual', grade: '5', subject: 'Mathematics', assessmentType: 'topic_test' }
  assert.equal(isTeacherAuthoredTitle(paper), true)
  assert.equal(paperCardTitle(paper), 'Mrs Zulu Friday Revision Special')
})

test('a title our own generator could have written is ours, flag or no flag', () => {
  for (const extra of [{}, { titleSource: 'auto' }]) {
    const paper = {
      title: 'GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026',
      grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term', term: '2', year: 2026,
      ...extra,
    }
    assert.equal(isTeacherAuthoredTitle(paper), false, JSON.stringify(extra))
    // …and rebuilding it corrects the term the stored string got wrong.
    assert.equal(paperCardTitle(paper), 'Grade 4 Integrated Science — End of Term 2 Test')
  }
})

test('a name predating the titleSource flag is still the teacher’s', () => {
  // The card used to ask ONLY for the flag, so a paper named before the flag
  // existed had its name rebuilt — a rename the backfill would have refused.
  const paper = { title: 'Grade 5 Maths Test', grade: '5', subject: 'Mathematics', assessmentType: 'topic_test' }
  assert.equal(isTeacherAuthoredTitle(paper), true)
  assert.equal(paperCardTitle(paper), 'Grade 5 Maths Test')
})

test('a blank title is nobody’s name', () => {
  assert.equal(isTeacherAuthoredTitle({ title: '   ', titleSource: 'manual' }), false)
  assert.equal(paperCustomName({ title: '' }), '')
})

test('the three surfaces cannot disagree — the backfill skips exactly what the card keeps', () => {
  // If this fails, a paper is being shown one name and written another.
  const papers = [
    { title: 'Mrs Zulu Friday Revision Special', titleSource: 'manual', grade: '5', subject: 'Mathematics', assessmentType: 'topic_test' },
    { title: 'Grade 5 Maths Test', grade: '5', subject: 'Mathematics', assessmentType: 'topic_test' },
    { title: 'GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026', grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term', term: '2', year: 2026 },
    { title: '', grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term', term: '1', year: 2026 },
  ]
  for (const paper of papers) {
    const plan = planTitleBackfill({ assessment: paper })
    const keptOnScreen = paperCardTitle(paper) === String(paper.title || '').trim() && Boolean(paper.title)
    assert.equal(
      plan.action === 'skip' && plan.reason !== 'already up to date',
      keptOnScreen,
      `disagreement on ${JSON.stringify(paper.title)}`,
    )
  }
})

console.log('\npaperNaming — how a subject reads')

test('a subject the author cased is left exactly as stored', () => {
  for (const s of ['Integrated Science', 'iGCSE Mathematics', 'Home Economics']) {
    assert.equal(readableSubject(s), s)
  }
})

test('a shouted subject is calmed down', () => {
  assert.equal(readableSubject('INTEGRATED SCIENCE'), 'Integrated Science')
  assert.equal(readableSubject('HOME ECONOMICS'), 'Home Economics')
})

test('an acronym survives — the bug blanket title-casing had', () => {
  // "ICT" became "Ict" and "R.E" became "R.e" on the library card.
  assert.equal(readableSubject('ICT'), 'ICT')
  assert.equal(readableSubject('PE'), 'PE')
  assert.equal(readableSubject('R.E'), 'R.E')
})

test('an empty subject is empty, not "undefined"', () => {
  assert.equal(readableSubject(undefined), '')
  assert.equal(readableSubject('  '), '')
})

test('the card and the bar read the same subject', () => {
  const paper = { grade: '4', subject: 'INTEGRATED SCIENCE', assessmentType: 'end_of_term', term: '1', year: 2026 }
  assert.match(paperCardTitle(paper), /Integrated Science/)
  assert.match(composeDocTitle(paper, { width: 1200 }).line1, /Integrated Science/)
})

console.log('\npaperNaming — the card title')

test('always carries the subject and the paper’s own term', () => {
  assert.equal(
    paperCardTitle({ grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term', term: '2', year: 2026 }),
    'Grade 4 Integrated Science — End of Term 2 Test',
  )
})

test('two papers differing only in subject, or only in term, are two names', () => {
  const base = { grade: '4', subject: 'Integrated Science', assessmentType: 'end_of_term', term: '1', year: 2026 }
  assert.notEqual(paperCardTitle(base), paperCardTitle({ ...base, subject: 'Technology Studies' }))
  assert.notEqual(paperCardTitle(base), paperCardTitle({ ...base, term: '2' }))
})

test('a paper with nothing to build from is named, not blank', () => {
  assert.equal(paperCardTitle({}), 'Untitled assessment paper')
  assert.equal(paperCardTitle({}, { fallbackLabel: 'Assessment paper' }), 'Untitled assessment paper')
})

console.log('\npaperNaming — the document title degrades by priority')

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
