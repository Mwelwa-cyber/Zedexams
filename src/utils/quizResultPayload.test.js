/**
 * src/utils/quizResultPayload.test.js
 *
 * Plain-node test for the extracted `results` payload builder.
 *
 * What it is FOR: this payload is one of the writes the Assessment Engine's
 * byte-compatibility harness must reproduce exactly (`docs/phase3-plan.md` §3).
 * So the assertions here are about the *shape and identity* of the written
 * document, not only about whether the arithmetic looks right — a test that
 * checks `percentage === 100` keeps passing when a thirteenth field appears in
 * the document, and a new field in `results` is a schema change.
 */
import assert from 'node:assert/strict'
import {
  buildQuizResultPayload,
  QUIZ_RESULT_PAYLOAD_KEYS,
} from './quizResultPayload.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const quiz = { title: 'Addition Basics', subject: 'Mathematics', grade: '4' }

const mcq = (id, correctAnswer = 1, marks = 1, topic = 'Addition') => ({
  id, type: 'mcq', correctAnswer, marks, topic,
})

const base = {
  quiz,
  quizId: 'quiz-1',
  mode: 'practice',
  userId: 'learner-1',
  startTime: 1_000_000,
  nowMs: 1_000_000 + 42_000,
}

console.log('quizResultPayload')

// ── The field set ────────────────────────────────────────────────────────────

test('produces exactly the declared key set, in order', () => {
  const payload = buildQuizResultPayload({
    ...base,
    questions: [mcq('q1')],
    answers: { q1: 1 },
  })
  assert.deepEqual(
    Object.keys(payload),
    [...QUIZ_RESULT_PAYLOAD_KEYS],
    'a key added, removed or reordered here changes the written document',
  )
})

test('the declared key set has no duplicates', () => {
  assert.equal(
    new Set(QUIZ_RESULT_PAYLOAD_KEYS).size,
    QUIZ_RESULT_PAYLOAD_KEYS.length,
  )
})

// ── Identity, not just equality ──────────────────────────────────────────────

test('answers is passed through by identity — never copied or rebuilt', () => {
  const answers = { q1: 1, q2: { text: 'four', correct: true } }
  const payload = buildQuizResultPayload({
    ...base,
    questions: [mcq('q1'), { id: 'q2', type: 'short_answer', marks: 1 }],
    answers,
  })
  // === matters: a copy would silently drop non-enumerable or future keys, and
  // the harness diffs the written object, not a reconstruction of it.
  assert.equal(payload.answers, answers, 'answers must be the same object')
})

// ── Scoring passthrough ──────────────────────────────────────────────────────

test('scores from the persisted key, not from a stored correct flag', () => {
  const payload = buildQuizResultPayload({
    ...base,
    questions: [mcq('q1', 1), mcq('q2', 0)],
    // q2 claims to be correct; the key says the answer is 0, so it is not.
    answers: { q1: 1, q2: 1 },
  })
  assert.equal(payload.score, 1)
  assert.equal(payload.totalMarks, 2)
  assert.equal(payload.percentage, 50)
})

test('topicScores rolls up per topic', () => {
  const payload = buildQuizResultPayload({
    ...base,
    questions: [mcq('q1', 1, 1, 'Addition'), mcq('q2', 1, 1, 'Subtraction')],
    answers: { q1: 1, q2: 0 },
  })
  assert.deepEqual(payload.topicScores, {
    Addition: { correct: 1, total: 1 },
    Subtraction: { correct: 0, total: 1 },
  })
})

// ── timeSpent ────────────────────────────────────────────────────────────────

test('timeSpent is whole seconds between startTime and nowMs', () => {
  const payload = buildQuizResultPayload({
    ...base,
    startTime: 1_000_000,
    nowMs: 1_000_000 + 42_400, // rounds down
    questions: [mcq('q1')],
    answers: { q1: 1 },
  })
  assert.equal(payload.timeSpent, 42)
})

test('timeSpent is 0 when the attempt has no recorded start', () => {
  for (const startTime of [null, undefined, 0]) {
    const payload = buildQuizResultPayload({
      ...base, startTime, questions: [mcq('q1')], answers: { q1: 1 },
    })
    assert.equal(payload.timeSpent, 0, `startTime ${String(startTime)} → 0`)
  }
})

test('reads no clock of its own — same inputs, same payload', () => {
  const args = { ...base, questions: [mcq('q1')], answers: { q1: 1 } }
  assert.deepEqual(buildQuizResultPayload(args), buildQuizResultPayload(args))
})

// ── The correctness guarantee this extraction must not lose ──────────────────
//
// B3/OBS-005 Gate 1: a text answer the AI grader could not evaluate is PENDING,
// never wrong. The attempt is then persisted as provisional — the partial
// percentage is recorded, but finalScore is null so nothing downstream treats
// an inflated partial mark as settled.

test('a pending AI answer makes the attempt provisional', () => {
  const payload = buildQuizResultPayload({
    ...base,
    questions: [mcq('q1'), { id: 'q2', type: 'short_answer', marks: 1, topic: 'Words' }],
    answers: { q1: 1, q2: { text: 'four', pending: true } },
  })
  assert.equal(payload.gradingStatus, 'pending')
  assert.equal(payload.scoreStatus, 'provisional')
  assert.equal(payload.finalScore, null, 'a partial mark must never be final')
  assert.deepEqual(payload.pendingQuestionIds, ['q2'])
  // The partial percentage is still recorded so the results screen can say
  // "awaiting marking" rather than showing nothing.
  assert.equal(typeof payload.percentage, 'number')
})

test('a pending answer is not scored as wrong', () => {
  const questions = [mcq('q1'), { id: 'q2', type: 'short_answer', marks: 1 }]
  const pendingRun = buildQuizResultPayload({
    ...base, questions, answers: { q1: 1, q2: { text: 'four', pending: true } },
  })
  const wrongRun = buildQuizResultPayload({
    ...base, questions, answers: { q1: 1, q2: { text: 'four', correct: false } },
  })
  // Both leave q2 unearned, but the pending one must not be settled as final —
  // that difference is the entire guarantee.
  assert.equal(pendingRun.finalScore, null)
  assert.equal(wrongRun.scoreStatus, 'final')
})

test('a fully-marked attempt is complete and final', () => {
  const payload = buildQuizResultPayload({
    ...base,
    questions: [mcq('q1'), mcq('q2')],
    answers: { q1: 1, q2: 1 },
  })
  assert.equal(payload.gradingStatus, 'complete')
  assert.equal(payload.scoreStatus, 'final')
  assert.equal(payload.finalScore, 100)
  assert.deepEqual(payload.pendingQuestionIds, [])
})

// ── Edges the runner can actually reach ──────────────────────────────────────

test('an empty quiz scores 0/0/0% rather than NaN', () => {
  const payload = buildQuizResultPayload({ ...base, questions: [], answers: {} })
  assert.equal(payload.score, 0)
  assert.equal(payload.totalMarks, 0)
  assert.equal(payload.percentage, 0, 'NaN% is the bug src/schemas/result.js exists to absorb')
})

test('an unanswered submit is a real 0, still final', () => {
  const payload = buildQuizResultPayload({
    ...base, questions: [mcq('q1'), mcq('q2')], answers: {},
  })
  assert.equal(payload.score, 0)
  assert.equal(payload.percentage, 0)
  assert.equal(payload.scoreStatus, 'final', 'answering nothing is a settled result, not a pending one')
})

test('quiz identity fields are copied through unchanged', () => {
  const payload = buildQuizResultPayload({
    ...base, questions: [mcq('q1')], answers: { q1: 1 },
  })
  assert.equal(payload.quizTitle, 'Addition Basics')
  assert.equal(payload.subject, 'Mathematics')
  // grade stays the STRING it is on the quiz doc. The `scores` collection
  // stores a Number by documented, deliberate divergence (gamesService.js);
  // these two must not be normalised toward each other.
  assert.equal(payload.grade, '4')
  assert.equal(typeof payload.grade, 'string')
})

console.log(`\nquizResultPayload: ${passed} passed`)
