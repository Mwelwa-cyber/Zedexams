/**
 * The paper's own facts — how long it runs and how many questions it holds.
 *
 * The failure this file is written against is the reported one: a Grade 7
 * Expressive Arts paper whose cover prints "There are 50 questions … EXACTLY
 * 60 MINUTES" offered the learner a 90-minute exam, because the number came
 * from a default rather than from the paper. So the cases below are the paper
 * in the bug report, and every rung of the ladder that stands behind it.
 *
 * Run: node functions/shared/paperQuiz/examSpec.test.js   (test:paper-exam-spec)
 */
import assert from 'node:assert/strict'

import {
  DEFAULT_DURATION_MIN,
  EXAM_SPEC_SOURCE,
  MAX_DURATION_MIN,
  MIN_DURATION_MIN,
  clampDuration,
  estimateDurationMinutes,
  officialDurationMinutes,
  parsePrintedDuration,
  resolveDurationMinutes,
  resolveExamSpec,
} from './examSpec.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

const mcqs = (n) => Array.from({ length: n }, () => ({ type: 'mcq', options: ['a', 'b', 'c', 'd'] }))

// ── reading the cover ────────────────────────────────────────────────────
console.log('\nthe time a paper prints on its own cover')

test('the sentence ECZ actually prints', () => {
  assert.equal(parsePrintedDuration('You will be given EXACTLY 60 MINUTES to answer the questions.'), 60)
  assert.equal(parsePrintedDuration('60 MINUTES'), 60)
  assert.equal(parsePrintedDuration('Time: 90 mins'), 90)
})

test('hours, with and without a half', () => {
  assert.equal(parsePrintedDuration('2 hours'), 120)
  assert.equal(parsePrintedDuration('1 hour 30 minutes'), 90)
  assert.equal(parsePrintedDuration('1 hr 15 min'), 75)
  assert.equal(parsePrintedDuration('1½ hours'), 90)
  assert.equal(parsePrintedDuration('1 1/2 hours'), 90)
})

test('a number that is not a time is never read as one', () => {
  // The single most damaging false positive: the count sentence sits three
  // lines above the time sentence on every ECZ cover.
  assert.equal(parsePrintedDuration('There are 50 questions in this EXPRESSIVE ARTS PAPER.'), null)
  assert.equal(parsePrintedDuration('SUBJECT 84/1'), null)
  assert.equal(parsePrintedDuration('Total marks: 50'), null)
  assert.equal(parsePrintedDuration(''), null)
  assert.equal(parsePrintedDuration(null), null)
})

test('a printed time is still clamped', () => {
  assert.equal(parsePrintedDuration('600 minutes'), MAX_DURATION_MIN)
  assert.equal(parsePrintedDuration('1 minute'), MIN_DURATION_MIN)
  assert.equal(clampDuration('nonsense'), null)
  assert.equal(clampDuration(0), null)
})

// ── the ladder ───────────────────────────────────────────────────────────
console.log('\nthe ladder')

test('the reported paper, once its cover has been read', () => {
  const spec = resolveExamSpec({
    paper: {
      grade: '7',
      subject: 'expressive-arts',
      printedSpec: { durationMinutes: 60, questionCount: 50, statedTime: 'EXACTLY 60 MINUTES' },
    },
    questions: mcqs(50),
  })
  assert.equal(spec.durationMinutes, 60, 'the paper says 60, so the exam runs 60')
  assert.equal(spec.durationSource, EXAM_SPEC_SOURCE.PRINTED)
  assert.equal(spec.exact, true)
  assert.equal(spec.questionCount, 50)
  assert.equal(spec.declaredQuestionCount, 50)
  assert.equal(spec.countMatchesPaper, true)
  assert.equal(spec.statedTime, 'EXACTLY 60 MINUTES')
})

test('an admin who typed a duration outranks every reading of the paper', () => {
  const spec = resolveExamSpec({
    paper: { durationMinutes: 45, grade: '7', subject: 'mathematics', printedSpec: { durationMinutes: 60 } },
    questions: mcqs(50),
  })
  assert.equal(spec.durationMinutes, 45)
  assert.equal(spec.durationSource, EXAM_SPEC_SOURCE.RECORDED)
  assert.equal(spec.exact, true)
})

test('an unread paper falls to the official ECZ length for its subject', () => {
  const spec = resolveExamSpec({ paper: { grade: '7', subject: 'mathematics' }, questions: mcqs(50) })
  assert.equal(spec.durationMinutes, 90)
  assert.equal(spec.durationSource, EXAM_SPEC_SOURCE.OFFICIAL)
  assert.equal(spec.exact, false, 'the official length is this year\'s; the paper may be older')
})

test('a subject with no official length is estimated from its own questions', () => {
  const spec = resolveExamSpec({ paper: { grade: '9', subject: 'science' }, questions: mcqs(50) })
  assert.equal(spec.durationMinutes, 60, '50 four-option questions ≈ an hour')
  assert.equal(spec.durationSource, EXAM_SPEC_SOURCE.ESTIMATED)
  assert.equal(spec.exact, false)
})

test('written answers are slower than choices, and essays slower again', () => {
  assert.equal(estimateDurationMinutes({ questions: mcqs(50) }), 60)
  assert.equal(
    estimateDurationMinutes({ questions: Array.from({ length: 20 }, () => ({ type: 'short_answer' })) }),
    50,
  )
  assert.equal(
    estimateDurationMinutes({ questions: Array.from({ length: 5 }, () => ({ type: 'essay' })) }),
    60,
  )
  // A question of no stated type with options is a choice; with none it is not.
  assert.equal(estimateDurationMinutes({ questions: [{ options: ['a', 'b'] }] }), MIN_DURATION_MIN)
  assert.equal(estimateDurationMinutes({ questionCount: 0 }), null)
  assert.equal(estimateDurationMinutes({}), null)
})

test('a paper with nothing to read at all still gets a sittable clock', () => {
  const spec = resolveExamSpec({ paper: { grade: '12', subject: 'biology' } })
  assert.equal(spec.durationMinutes, DEFAULT_DURATION_MIN)
  assert.equal(spec.durationSource, EXAM_SPEC_SOURCE.DEFAULT)
  assert.equal(spec.exact, false)
  assert.equal(spec.questionCount, null)
  // Nothing was read, so nothing is claimed about agreement.
  assert.equal(spec.countMatchesPaper, null)
  assert.equal(resolveExamSpec({}).durationMinutes, DEFAULT_DURATION_MIN)
})

test('the quiz editor\'s 30-minute default can never become the clock', () => {
  // The one rung deliberately left out: `quizzes/{id}.duration` defaults to 30
  // on every quiz an admin has opened and saved.
  const spec = resolveExamSpec({
    paper: { grade: '7', subject: 'expressive-arts' },
    quiz: { duration: 30 },
    questions: mcqs(50),
  })
  assert.notEqual(spec.durationMinutes, 30)
})

test('a count the quiz does not match is reported, not hidden', () => {
  const spec = resolveExamSpec({
    paper: { grade: '7', subject: 'science', printedSpec: { questionCount: 50 } },
    questions: mcqs(47),
  })
  assert.equal(spec.declaredQuestionCount, 50)
  assert.equal(spec.questionCount, 47)
  assert.equal(spec.countMatchesPaper, false)
})

test('both spellings of the recorded field, and the server\'s shorthand', () => {
  assert.equal(resolveDurationMinutes({ durationMin: 45 }), 45)
  assert.equal(resolveDurationMinutes({ durationMinutes: 900 }), MAX_DURATION_MIN)
  assert.equal(resolveDurationMinutes({ durationMinutes: 1 }), MIN_DURATION_MIN)
})

test('the official table only answers for grades and subjects it holds', () => {
  assert.equal(officialDurationMinutes({ grade: '7', subject: 'english' }), 90)
  assert.equal(officialDurationMinutes({ grade: 7, subject: 'expressive-arts' }), 75)
  assert.equal(officialDurationMinutes({ grade: '9', subject: 'english' }), null)
  assert.equal(officialDurationMinutes({ grade: '7', subject: 'astrophysics' }), null)
  assert.equal(officialDurationMinutes({}), null)
})

if (process.exitCode) {
  console.error('\n✗ past-paper exam spec FAILED')
} else {
  console.log(`\n✓ past-paper exam spec — ${passed} checks`)
}
