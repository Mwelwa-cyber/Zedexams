/**
 * Node test for the canonical quiz-subject integrity validator.
 * Run: node scripts/test-quiz-subject-integrity.mjs
 *
 * Covers the full matrix the launch-blocker acceptance criteria list:
 * subject / grade / curriculum mismatch, wrong featured quiz id (wrong-quiz
 * back-link), mixed-subject question collection, unpublished quiz, and missing
 * classification metadata — plus the OK case and the label-vs-slug normalisation
 * that the real data relies on.
 */

import assert from 'node:assert'
import {
  validateQuizSubjectIntegrity,
  paperQuizSubjectMatches,
  INTEGRITY_CODES,
} from '../src/utils/quizSubjectIntegrity.js'
import {
  buildIntegrityReport,
  planQuarantine,
} from './repair-quiz-subject-integrity.mjs'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}
const hasCode = (res, code) => res.violations.some((v) => v.code === code)

console.log('quizSubjectIntegrity')

const publishedQuiz = { isPublished: true, publicAccess: true }

// ── Happy path ─────────────────────────────────────────────────────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p1', subject: 'social-studies', grade: '7' },
    quiz: { ...publishedQuiz, subject: 'social_studies', grade: '7', linkedPaperId: 'p1' },
    questions: [{ subject: 'social_studies' }, {}],
  })
  ok('matching paper+quiz+questions is ok', res.ok === true)
  ok('happy path has no violations', res.violations.length === 0)
  ok('happy path reports canonical subject', res.canonical.subjectId === 'social_studies')
}

// ── Label vs slug normalisation (the real-data footgun) ─────────────────────
{
  // paperToQuizConverter stamps a DISPLAY LABEL as quiz.subject; the paper
  // carries a slug. These must be treated as equal after normalisation.
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p2', subject: 'social-studies' },
    quiz: { ...publishedQuiz, subject: 'Social Studies', linkedPaperId: 'p2' },
  })
  ok('label "Social Studies" == slug "social-studies"', res.ok === true)
}

// ── THE BUG: Social Studies paper, Maths quiz ───────────────────────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p3', subject: 'social-studies' },
    quiz: { ...publishedQuiz, subject: 'mathematics', linkedPaperId: 'p3' },
    questions: [{ subject: 'mathematics' }],
  })
  // The quiz is internally consistent (maths quiz, maths questions) — the
  // defect is that it does not belong to this Social Studies paper, so the
  // paper↔quiz subject_mismatch is what fails it closed and refuses the render.
  ok('social-studies paper + maths quiz fails closed', res.ok === false)
  ok('reports subject_mismatch', hasCode(res, INTEGRITY_CODES.SUBJECT_MISMATCH))
}

// ── Mixed-subject question collection (quiz subject fine, one bad question) ──
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p4', subject: 'science' },
    quiz: { ...publishedQuiz, subject: 'science', linkedPaperId: 'p4' },
    questions: [{ subject: 'science' }, { subject: 'mathematics' }],
  })
  ok('mixed-subject questions fail closed', res.ok === false)
  ok('mixed-subject reports question_subject_mismatch', hasCode(res, INTEGRITY_CODES.QUESTION_SUBJECT_MISMATCH))
}

// ── Grade mismatch ──────────────────────────────────────────────────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p5', subject: 'english', grade: '5' },
    quiz: { ...publishedQuiz, subject: 'english', grade: '7', linkedPaperId: 'p5' },
  })
  ok('grade mismatch fails closed', res.ok === false)
  ok('reports grade_mismatch', hasCode(res, INTEGRITY_CODES.GRADE_MISMATCH))
}

// ── Grade absent on quiz side is NOT a violation (past-paper G12 case) ───────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p6', subject: 'biology', grade: '12' },
    quiz: { ...publishedQuiz, subject: 'biology', linkedPaperId: 'p6' }, // no grade
  })
  ok('absent quiz grade is not a violation', res.ok === true)
}

// ── Curriculum mismatch ─────────────────────────────────────────────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p7', subject: 'mathematics', curriculum: 'cbc' },
    quiz: { ...publishedQuiz, subject: 'mathematics', curriculum: 'obc', linkedPaperId: 'p7' },
  })
  ok('curriculum mismatch fails closed', res.ok === false)
  ok('reports curriculum_mismatch', hasCode(res, INTEGRITY_CODES.CURRICULUM_MISMATCH))
}

// ── Wrong featured quiz id (quiz back-links to a different paper) ────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p8', subject: 'mathematics' },
    quiz: { ...publishedQuiz, subject: 'mathematics', linkedPaperId: 'SOME_OTHER_PAPER' },
  })
  ok('quiz linked to another paper fails closed', res.ok === false)
  ok('reports wrong_quiz', hasCode(res, INTEGRITY_CODES.WRONG_QUIZ))
}

// ── Unpublished quiz in the public context ──────────────────────────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p9', subject: 'mathematics' },
    quiz: { subject: 'mathematics', linkedPaperId: 'p9', isPublished: false, publicAccess: false },
  })
  ok('unpublished quiz fails closed in public context', res.ok === false)
  ok('reports quiz_unpublished', hasCode(res, INTEGRITY_CODES.QUIZ_UNPUBLISHED))

  // admin repair pass audits drafts too — requirePublished:false drops that code.
  const audit = validateQuizSubjectIntegrity({
    paper: { id: 'p9', subject: 'mathematics' },
    quiz: { subject: 'mathematics', linkedPaperId: 'p9', isPublished: false, publicAccess: false },
  }, { requirePublished: false })
  ok('requirePublished:false ignores publication state', audit.ok === true)
}

// ── Missing classification metadata ─────────────────────────────────────────
{
  const res = validateQuizSubjectIntegrity({
    paper: { id: 'p10', subject: '' },
    quiz: { ...publishedQuiz, subject: '', linkedPaperId: 'p10' },
  })
  ok('missing subjects fail closed', res.ok === false)
  ok('reports missing_paper_subject', hasCode(res, INTEGRITY_CODES.MISSING_PAPER_SUBJECT))
  ok('reports missing_quiz_subject', hasCode(res, INTEGRITY_CODES.MISSING_QUIZ_SUBJECT))
}

// ── Missing input ───────────────────────────────────────────────────────────
{
  const res = validateQuizSubjectIntegrity({ paper: { id: 'x', subject: 'maths' }, quiz: null })
  ok('null quiz fails closed', res.ok === false)
  ok('reports missing_input', hasCode(res, INTEGRITY_CODES.MISSING_INPUT))
}

// ── paperQuizSubjectMatches (featured-list cheap filter) ─────────────────────
{
  ok('featured filter accepts matching subjects',
    paperQuizSubjectMatches({ subject: 'social-studies' }, { subject: 'Social Studies' }) === true)
  ok('featured filter rejects mismatched subjects',
    paperQuizSubjectMatches({ subject: 'social-studies' }, { subject: 'mathematics' }) === false)
  ok('featured filter fails closed on missing quiz subject',
    paperQuizSubjectMatches({ subject: 'social-studies' }, { subject: '' }) === false)
  ok('featured filter fails closed on null meta',
    paperQuizSubjectMatches({ subject: 'social-studies' }, null) === false)
}

// ── Repair-script pure core (buildIntegrityReport / planQuarantine) ─────────
{
  const rows = [
    // ok
    { paper: { id: 'g1', subject: 'science', grade: '7' }, quiz: { ...publishedQuiz, subject: 'science', grade: '7', linkedPaperId: 'g1' }, questions: [] },
    // subject mismatch (the bug)
    { paper: { id: 'g2', subject: 'social-studies' }, quiz: { ...publishedQuiz, subject: 'mathematics', linkedPaperId: 'g2' }, questions: [] },
    // wrong quiz link
    { paper: { id: 'g3', subject: 'english' }, quiz: { ...publishedQuiz, subject: 'english', linkedPaperId: 'OTHER' }, questions: [] },
    // missing quiz doc
    { paper: { id: 'g4', subject: 'english', quizId: 'gone' }, quiz: null, questions: [] },
  ]
  const report = buildIntegrityReport(rows)
  ok('report scans all rows', report.scanned === 4)
  ok('report counts the ok row', report.ok === 1)
  ok('report counts the missing quiz', report.missingQuiz === 1)
  ok('report counts two mismatches', report.mismatched === 2)
  ok('report byCode tallies subject_mismatch', report.byCode[INTEGRITY_CODES.SUBJECT_MISMATCH] === 1)
  ok('report byCode tallies wrong_quiz', report.byCode[INTEGRITY_CODES.WRONG_QUIZ] === 1)

  const plan = planQuarantine(report)
  ok('quarantine plan targets exactly the mismatched papers', plan.length === 2 && plan.includes('g2') && plan.includes('g3'))
  ok('quarantine plan excludes the ok + missing-quiz papers', !plan.includes('g1') && !plan.includes('g4'))
}

console.log(`\n${passed} assertions passed.`)
