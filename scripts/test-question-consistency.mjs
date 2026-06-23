#!/usr/bin/env node
/* global console, process */
/**
 * Cross-surface question TYPE + MARKS consistency net (Phase 2, tests-first).
 *
 * A characterization suite: it pins the CURRENT behavior of how a question's
 * TYPE and MARKS flow through every surface — import → save → read → score —
 * plus the parallel assessment/export namespace. It exists to be the safety net
 * for the upcoming shared question-type normalizer + marks-policy refactor: the
 * refactor is meant to UNIFY the divergent surfaces without changing observable
 * behavior, and this suite is what proves nothing drifted.
 *
 * It deliberately asserts behavior AS IT IS TODAY, including the known quirks
 * and divergences the normalizer will address (each is flagged "LOCKS:" so a
 * future intentional change updates the assertion knowingly rather than by
 * accident). The surfaces, today:
 *
 *   • Editor/schema namespace  (src/editor/schema/question.js): canonical types
 *     are mcq/tf/short_answer/fill_blanks/numeric/matching/sequence/essay/…,
 *     with canonicalizeQuestionType() folding aliases (truefalse→tf, …) and
 *     coerceQuestion() clamping marks 1..20 on read.
 *   • CSV importer            (src/utils/csvQuizImport.js): its OWN type
 *     aliases (multiple-choice→mcq, true/false→tf, short→short_answer) and a
 *     1..20 marks gate.
 *   • Scorer                  (src/utils/quizScoring.js): type-string-sensitive
 *     grading — only canonical strings get special handling.
 *   • Assessment/export       (functions/teacherTools/assessmentSchema.js +
 *     src/utils/assessmentPaperLayout.js): a SEPARATE namespace
 *     (multiple_choice/true_false/…) with a different marks policy (no 20 cap).
 *
 * Plain `node` (no browser, no emulator) so it runs inside `npm run test:all`.
 * Run: npm run test:question-consistency
 */
import { createRequire } from 'node:module'
import {
  questionWriteSchema,
  coerceQuestion,
  canonicalizeQuestionType,
  questionTypeLabel,
  QUESTION_TYPES_LIST,
} from '../src/editor/schema/question.js'
import { isQuestionCorrect, computeQuizScore } from '../src/utils/quizScoring.js'
import { rowToQuestion, CSV_HEADERS } from '../src/utils/csvQuizImport.js'
import { buildPaperLayout } from '../src/utils/assessmentPaperLayout.js'

const require = createRequire(import.meta.url)
const { validateAssessment } = require('../functions/teacherTools/assessmentSchema.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
function eq(actual, expected, msg) {
  assert(
    actual === expected,
    `${msg || 'value'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

// Build a schema-valid question with sane defaults; override per case.
function buildQ(overrides = {}) {
  return { type: 'mcq', marks: 1, order: 0, contentVersion: 3, ...overrides }
}
// Build a CSV cells row aligned to CSV_HEADERS.
function csvRow(fields = {}) {
  return CSV_HEADERS.map((h) => (h in fields ? String(fields[h]) : ''))
}

// ── 1. Type canonicalization (editor/schema namespace) ───────────────────
console.log('\ncanonicalizeQuestionType folds aliases onto the schema enum')
const CANON = [
  ['truefalse', 'tf'],
  ['true_false', 'tf'],
  ['true/false', 'tf'],
  ['TRUEFALSE', 'tf'], // case-insensitive (alias lookup lowercases)
  ['  truefalse  ', 'tf'], // alias lookup trims before matching
  ['fill_in_blank', 'fill_blanks'],
  ['fill_in_the_blank', 'fill_blanks'],
  ['fill_blank', 'fill_blanks'],
  // already-canonical pass straight through
  ['mcq', 'mcq'],
  ['tf', 'tf'],
  ['short_answer', 'short_answer'],
  ['numeric', 'numeric'],
  ['matching', 'matching'],
  ['sequence', 'sequence'],
  ['essay', 'essay'],
  ['fill_blanks', 'fill_blanks'],
  // LOCKS: unknown values pass through UNCHANGED (so the strict write schema
  // still rejects a genuine typo loudly) — the editor namespace does NOT know
  // the assessment namespace, so these are intentionally not folded here.
  ['multiple_choice', 'multiple_choice'],
  ['number', 'number'],
  ['gibberish', 'gibberish'],
]
for (const [raw, want] of CANON) {
  test(`canonicalizeQuestionType(${JSON.stringify(raw)}) → ${want}`, () =>
    eq(canonicalizeQuestionType(raw), want))
}
// LOCKS: trim/lowercase only happen during ALIAS lookup. An already-canonical
// value with surrounding whitespace is returned UNCHANGED (it isn't an alias
// key), so callers must canonicalize trimmed input. A real quirk to preserve.
test('canonical-but-untrimmed value passes through unchanged', () =>
  eq(canonicalizeQuestionType('  tf  '), '  tf  '))
test('questionTypeLabel folds alias then labels (truefalse → "True / False")', () =>
  eq(questionTypeLabel('truefalse'), 'True / False'))
test('questionTypeLabel humanises an unknown type', () =>
  eq(questionTypeLabel('multiple_choice'), 'Multiple Choice'))

// ── 2. coerceQuestion (read-side) normalizes type + clamps marks ─────────
console.log('\ncoerceQuestion read-side normalization')
test('reads back an aliased truefalse doc as tf', () =>
  eq(coerceQuestion({ type: 'truefalse', marks: 1 }).type, 'tf'))
// LOCKS: an assessment-namespace type ('multiple_choice') is NOT in the editor
// enum and isn't aliased, so the read-side fallback collapses it to 'mcq'.
test('collapses unknown assessment-namespace type to mcq', () =>
  eq(coerceQuestion({ type: 'multiple_choice', marks: 1 }).type, 'mcq'))
test('marks above the cap clamp to 20 on read', () =>
  eq(coerceQuestion({ type: 'mcq', marks: 25 }).marks, 20))
test('marks of 0 / NaN / negative fall back to 1 on read', () => {
  eq(coerceQuestion({ type: 'mcq', marks: 0 }).marks, 1)
  eq(coerceQuestion({ type: 'mcq', marks: 'abc' }).marks, 1)
  eq(coerceQuestion({ type: 'mcq', marks: -3 }).marks, 1)
})
test('a 15- and 20-mark question survive read-back (the #1252 regression)', () => {
  eq(coerceQuestion({ type: 'essay', marks: 15 }).marks, 15)
  eq(coerceQuestion({ type: 'essay', marks: 20 }).marks, 20)
})

// ── 3. Write schema marks policy (1..20 integer) ─────────────────────────
console.log('\nquestionWriteSchema marks policy: integer 1..20')
for (const m of [1, 10, 15, 20]) {
  test(`accepts ${m} marks`, () =>
    assert(questionWriteSchema.safeParse(buildQ({ marks: m })).success, `marks ${m} rejected`))
}
for (const m of [0, 21, 1.5, -1]) {
  test(`rejects ${m} marks`, () =>
    assert(!questionWriteSchema.safeParse(buildQ({ marks: m })).success, `marks ${m} accepted`))
}

// ── 4. Per-type save → read round-trip ───────────────────────────────────
console.log('\nper-type save (write schema) → read (coerce) round-trip')
const SAVE_CASES = [
  ['tf', buildQ({ type: 'tf', options: ['True', 'False'], correctAnswer: 0 })],
  ['short_answer', buildQ({ type: 'short_answer', correctAnswer: 'Lusaka' })],
  ['essay', buildQ({ type: 'essay', marks: 20 })],
  ['numeric', buildQ({ type: 'numeric', correctAnswer: 3.14, tolerance: 0.01 })],
  ['matching', buildQ({
    type: 'matching',
    matchingLeft: ['A', 'B'],
    matchingRight: ['1', '2'],
    matchingAnswer: [0, 1],
  })],
  ['sequence', buildQ({
    type: 'sequence',
    sequenceItems: ['first', 'second', 'third'],
    sequenceAnswer: [1, 2, 3],
  })],
  ['fill_blanks', buildQ({
    type: 'fill_blanks',
    statements: [{ text: 'The sun is a ____.', answers: ['star'] }],
  })],
]
for (const [type, doc] of SAVE_CASES) {
  test(`${type}: write schema accepts, coerce preserves type`, () => {
    const parsed = questionWriteSchema.safeParse(doc)
    assert(parsed.success, `write schema rejected ${type}: ${parsed.error?.issues?.[0]?.message}`)
    eq(coerceQuestion(parsed.data).type, type, `${type} type after coerce`)
  })
}

// ── 5. Scoring behavior per type (quizScoring) ───────────────────────────
console.log('\nisQuestionCorrect / computeQuizScore per type')
test('tf scores by strict equality against correctAnswer (0=True/1=False)', () => {
  const q = { id: 'q', type: 'tf', marks: 2, correctAnswer: 0 }
  assert(isQuestionCorrect(q, 0) === true, 'tf 0 should be correct')
  assert(isQuestionCorrect(q, 1) === false, 'tf 1 should be wrong')
})
test('numeric scores within tolerance', () => {
  const q = { id: 'q', type: 'numeric', marks: 3, correctAnswer: 3.14, tolerance: 0.01 }
  assert(isQuestionCorrect(q, 3.145) === true, '3.145 within 0.01 of 3.14')
  assert(isQuestionCorrect(q, 3.2) === false, '3.2 outside tolerance')
})
test('short_answer trusts the upstream AI verdict (answer.correct)', () => {
  const q = { id: 'q', type: 'short_answer', marks: 5 }
  assert(isQuestionCorrect(q, { correct: true }) === true, 'AI-correct')
  assert(isQuestionCorrect(q, { correct: false }) === false, 'AI-wrong')
})
test('fill_blanks grades deterministically against the answer key', () => {
  const q = { id: 'q', type: 'fill_blanks', marks: 2, statements: [{ text: 'The sun is a ____.', answers: ['star'] }] }
  assert(isQuestionCorrect(q, ['star']) === true, 'matching blank')
  assert(isQuestionCorrect(q, ['moon']) === false, 'wrong blank')
})
// Essay is an AI-graded text type (like short_answer / diagram): it trusts the
// upstream marker's verdict carried on the answer object, not strict equality.
test('essay is AI-graded via the text-answer verdict', () => {
  const q = { id: 'q', type: 'essay', marks: 10, correctAnswer: 'model' }
  assert(isQuestionCorrect(q, { text: 'a long answer', correct: true }) === true, 'AI-correct')
  assert(isQuestionCorrect(q, { text: 'a long answer', correct: false }) === false, 'AI-wrong')
  assert(isQuestionCorrect(q, 'model') === false, 'a bare string carries no AI verdict')
})
// Matching/sequence grade deterministically in the learner runner against
// their dedicated answer keys (matchingAnswer / sequenceAnswer) — the runner
// stores the learner response as the chosen pairing / arrangement array.
test('matching/sequence are auto-graded against their answer keys', () => {
  const m = { id: 'm', type: 'matching', marks: 3, matchingLeft: ['A', 'B'], matchingRight: ['1', '2'], matchingAnswer: [0, 1] }
  assert(isQuestionCorrect(m, [0, 1]) === true, 'matching correct pairing')
  assert(isQuestionCorrect(m, [1, 0]) === false, 'matching wrong pairing')
  const s = { id: 's', type: 'sequence', marks: 3, sequenceItems: ['a', 'b', 'c'], sequenceAnswer: [1, 2, 3] }
  assert(isQuestionCorrect(s, [0, 1, 2]) === true, 'sequence correct order')
  assert(isQuestionCorrect(s, [2, 1, 0]) === false, 'sequence wrong order')
})
test('computeQuizScore sums marks across mixed types; missing marks count as 1', () => {
  const questions = [
    { id: 'a', type: 'tf', marks: 2, correctAnswer: 0 },
    { id: 'b', type: 'numeric', marks: 3, correctAnswer: 3.14, tolerance: 0.01 },
    { id: 'c', type: 'short_answer', marks: 5 },
    { id: 'd', type: 'mcq', correctAnswer: 1 }, // no marks → counts as 1
  ]
  const answers = { a: 0, b: 3.14, c: { correct: true }, d: 1 }
  const r = computeQuizScore(questions, answers)
  eq(r.total, 11, 'total marks (2+3+5+1)')
  eq(r.score, 11, 'all correct')
  eq(r.percentage, 100, 'percentage')
})

// ── 6. CSV importer: own type aliases + 1..20 marks gate ─────────────────
console.log('\nCSV importer type aliasing + marks gate')
const CSV_TYPE = [
  ['mcq', 'mcq'],
  ['multiple choice', 'mcq'],
  ['multiple-choice', 'mcq'],
  ['true/false', 'tf'],
  ['truefalse', 'tf'],
  ['short', 'short_answer'],
  ['numeric', 'numeric'],
]
for (const [raw, want] of CSV_TYPE) {
  test(`CSV type "${raw}" → ${want}`, () => {
    const row = csvRow({
      type: raw,
      text: 'Q?',
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
      correctAnswer: raw === 'numeric' ? '3' : 'A',
      marks: '1',
    })
    eq(rowToQuestion(row).question.type, want)
  })
}
test('CSV marks 20 imports cleanly; 0 / 21 error (the #1252 1..20 gate)', () => {
  const base = { type: 'mcq', text: 'Q?', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'A' }
  const ok = rowToQuestion(csvRow({ ...base, marks: '20' }))
  eq(ok.question.marks, 20, 'marks 20')
  assert(ok.status !== 'error', '20 marks should not error')
  assert(rowToQuestion(csvRow({ ...base, marks: '21' })).status === 'error', '21 should error')
  assert(rowToQuestion(csvRow({ ...base, marks: '0' })).status === 'error', '0 should error')
})

// ── 7. Assessment / export namespace (the divergence to unify later) ──────
console.log('\nassessment + export namespace divergence (LOCKS today’s split)')
// LOCKS: the assessment path uses a SEPARATE question-type vocabulary
// (multiple_choice / true_false / …) from the editor enum (mcq / tf / …).
// validateAssessment accepts and preserves its own namespace; the editor's
// coerceQuestion (section 2) collapses 'multiple_choice' to 'mcq'. This split
// is exactly what the normalizer will reconcile.
test('validateAssessment preserves its own type namespace (multiple_choice, not mcq)', () => {
  const { ok, value } = validateAssessment({
    header: { title: 'Quiz', grade: '7', subject: 'Integrated Science', topic: 'Energy' },
    sections: [{
      title: 'SECTION A',
      questions: [{
        number: 1,
        type: 'multiple_choice',
        prompt: 'Pick one',
        options: ['A. one', 'B. two'],
        answer: 'A. one',
        marks: 1,
      }],
    }],
  })
  assert(ok, 'assessment should validate')
  eq(value.sections[0].questions[0].type, 'multiple_choice', 'assessment kept its namespace type')
})
// LOCKS: the assessment marks policy has NO 20-cap (unlike the quiz path) — a
// 50-mark assessment question is preserved. This is the central marks-policy
// divergence the normalizer will reconcile.
test('validateAssessment preserves a 50-mark question (no 20 cap, unlike quizzes)', () => {
  const { ok, value } = validateAssessment({
    header: { title: 'End of Term', grade: '7', subject: 'Integrated Science', topic: 'Energy' },
    sections: [{
      title: 'SECTION A',
      questions: [{ number: 1, type: 'essay', prompt: 'Discuss energy conservation.', marks: 50 }],
    }],
  })
  assert(ok, 'assessment should validate')
  eq(value.sections[0].questions[0].marks, 50, 'assessment kept 50 marks')
})

// ── 8. Export surface (assessment paper layout) ──────────────────────────
console.log('\nexport surface (buildPaperLayout) reflects canonical type + marks')
{
  const questions = [
    // authored under the 'truefalse' ALIAS to prove the exporter canonicalizes
    { type: 'truefalse', marks: 2, text: 'Water boils at 100C', options: ['True', 'False'], correctAnswer: 0, order: 0 },
    { type: 'numeric', marks: 3, text: 'pi to 2dp', correctAnswer: 3.14, tolerance: 0.01, order: 1 },
    { type: 'matching', marks: 4, text: 'Match', matchingLeft: ['A'], matchingRight: ['1'], matchingAnswer: [0], order: 2 },
    { type: 'sequence', marks: 4, text: 'Order these', sequenceItems: ['a', 'b'], sequenceAnswer: [1, 2], order: 3 },
    { type: 'short_answer', marks: 5, text: 'Capital of Zambia', correctAnswer: 'Lusaka', order: 4 },
    { type: 'fill_blanks', marks: 2, text: 'The sun is a ____.', statements: [{ text: 'The sun is a ____.', answers: ['star'] }], order: 5 },
    { type: 'essay', marks: 20, text: 'Discuss energy conservation', order: 6 },
    { type: 'mcq', marks: 15, text: 'Pick one', options: ['A', 'B', 'C', 'D'], correctAnswer: 0, order: 7 },
  ]
  const blocks = buildPaperLayout({}, questions)
  const learner = blocks.find((b) => b.kind === 'learnerFields')
  const qBlocks = blocks.filter((b) => b.kind === 'question')

  test('export totals every question’s marks (incl. the 15- and 20-mark items)', () =>
    eq(learner?.totalMarks, 2 + 3 + 4 + 4 + 5 + 2 + 20 + 15, 'learnerFields.totalMarks'))
  test('export emits one question block per question', () =>
    eq(qBlocks.length, questions.length, 'question block count'))
  test('export canonicalizes an aliased truefalse → tf with True/False options', () => {
    const first = qBlocks[0]
    eq(first.type, 'tf', 'tf canonicalized in export')
    assert(
      (first.optionsPlain || []).join('/').toLowerCase().includes('true'),
      'True/False options present in export',
    )
  })
  test('export carries every canonical type', () => {
    const types = qBlocks.map((b) => b.type)
    for (const t of ['tf', 'numeric', 'matching', 'sequence', 'short_answer', 'fill_blanks', 'essay', 'mcq']) {
      assert(types.includes(t), `export missing canonical type ${t}`)
    }
  })
  test('export preserves a 20-mark essay block (no quiz 20-cap surprise)', () =>
    eq(qBlocks.find((b) => b.type === 'essay')?.marks, 20, 'essay block marks'))
}

// ── Report ───────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
