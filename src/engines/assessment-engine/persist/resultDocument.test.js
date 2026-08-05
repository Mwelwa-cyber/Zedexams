/**
 * The written contract — the field set, the types, and the two refusals.
 *
 * The replay comparison proves this builder agrees with the old path on every
 * recorded attempt. What it cannot prove is anything the old path never does:
 * the engine writing `null`, and the engine refusing to write at all. Both are
 * new, and both are here.
 */
import assert from 'node:assert/strict'
import { buildResultDocument, elapsedSeconds, RESULT_DOCUMENT_KEYS } from './index.js'
import { QUIZ_RESULT_PAYLOAD_KEYS } from '../../../utils/quizResultPayload.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const assessment = {
  id: 'quiz-1', title: 'Addition Basics', subject: 'Mathematics', grade: '4',
}
const attempt = (over = {}) => ({
  userId: 'learner-1', answers: { q1: 1 }, mode: 'practice', startedAtMs: 1_000_000, ...over,
})
const verdict = (over = {}) => ({
  graded: true, score: 2, total: 2, percentage: 100,
  topicScores: { Addition: { correct: 2, total: 2 } }, pending: 0, pendingIds: [], ...over,
})
const build = (over = {}) => buildResultDocument({
  assessment, attempt: attempt(), verdict: verdict(), nowMs: 1_042_000, ...over,
})

console.log('engine — the results document')

// ── The field set ────────────────────────────────────────────────────────────

test('the document is exactly the declared field set', () => {
  assert.deepEqual(Object.keys(build()).sort(), [...RESULT_DOCUMENT_KEYS].sort())
})

test('the declared field set matches the OLD path, field for field', () => {
  // Byte-compatibility's first rule. Kept as two independent constants on
  // purpose — importing the old one into the builder would make this a
  // tautology, and it is the only assertion that catches a field added to one
  // side and not the other.
  assert.deepEqual([...RESULT_DOCUMENT_KEYS], [...QUIZ_RESULT_PAYLOAD_KEYS])
})

test('grade is written as a STRING', () => {
  // The `scores` collection stores a Number by documented, deliberate
  // divergence. An engine that converged the two would break every games
  // leaderboard query.
  assert.equal(typeof build().grade, 'string')
})

test('identity comes from the assessment, and the learner from the attempt', () => {
  const doc = build()
  assert.equal(doc.quizId, 'quiz-1')
  assert.equal(doc.quizTitle, 'Addition Basics')
  assert.equal(doc.userId, 'learner-1')
  assert.equal(doc.mode, 'practice')
})

test('the answers map is written as given, not re-derived', () => {
  const answers = { q1: 1, q2: ['a', 'b'] }
  assert.deepEqual(build({ attempt: attempt({ answers }) }).answers, answers)
})

// ── timeSpent: the approved deviation ────────────────────────────────────────

test('a measured attempt writes the elapsed seconds', () => {
  assert.equal(build().timeSpent, 42)
})

test('rounding is to the NEAREST second, as the old path rounds', () => {
  // A different rounding rule is a real difference the comparison would catch,
  // but only on a fixture whose elapsed time is not a whole number of seconds.
  // Pinning it here does not depend on a fixture having that property.
  assert.equal(elapsedSeconds({ startedAtMs: 0 + 1, nowMs: 1 + 1499 }), 1)
  assert.equal(elapsedSeconds({ startedAtMs: 0 + 1, nowMs: 1 + 1500 }), 2)
})

test('an attempt whose start is UNKNOWN writes null, not zero', () => {
  // The approved deviation. The old path writes 0, which is indistinguishable
  // from an attempt that genuinely took under half a second.
  assert.equal(build({ attempt: attempt({ startedAtMs: null }) }).timeSpent, null)
  assert.equal(build({ attempt: attempt({ startedAtMs: undefined }) }).timeSpent, null)
  assert.equal(build({ attempt: attempt({ startedAtMs: 0 }) }).timeSpent, null,
    'the Unix epoch is not a time an attempt started')
})

test('null is the ONLY value that means unknown — a real zero stays a zero', () => {
  // Submitting in under half a second is possible (an empty quiz, a fast tap),
  // and it must remain distinguishable from an unmeasured attempt.
  assert.equal(build({ nowMs: 1_000_200 }).timeSpent, 0)
})

// ── The refusal ──────────────────────────────────────────────────────────────

test('an UNMARKED verdict is refused rather than written as zero', () => {
  // What makes the `none` strategy safe to have. Its zeroes are not marks, and
  // writing them would file 0% for every past-paper learner.
  assert.throws(
    () => build({ verdict: verdict({ graded: false, score: 0, total: 0, percentage: 0 }) }),
    /refusing to write a result for an unmarked attempt/,
  )
})

test('a missing verdict is refused too, not treated as ungraded-but-fine', () => {
  assert.throws(() => build({ verdict: undefined }), /refusing to write/)
  assert.throws(() => build({ verdict: null }), /refusing to write/)
})

// ── Provisional grading ──────────────────────────────────────────────────────

test('a settled attempt records a final score', () => {
  const doc = build()
  assert.equal(doc.gradingStatus, 'complete')
  assert.equal(doc.scoreStatus, 'final')
  assert.deepEqual(doc.pendingQuestionIds, [])
  assert.equal(doc.finalScore, 100)
})

test('a pending attempt is provisional, and its partial mark is NOT final', () => {
  // The rule that stops an inflated partial percentage being treated as
  // settled by pass/fail, badges, leaderboards or class analytics.
  const doc = build({ verdict: verdict({ pending: 1, pendingIds: ['q2'], percentage: 50 }) })
  assert.equal(doc.gradingStatus, 'pending')
  assert.equal(doc.scoreStatus, 'provisional')
  assert.deepEqual(doc.pendingQuestionIds, ['q2'])
  assert.equal(doc.finalScore, null)
  assert.equal(doc.percentage, 50, 'the partial IS recorded — it is just not settled')
})

test('pendingIds alone makes an attempt provisional, without a pending count', () => {
  // The two are written by the same scorer and should agree, but a verdict is
  // a boundary and either alone is enough to mean "not finished".
  assert.equal(build({ verdict: verdict({ pending: 0, pendingIds: ['q2'] }) }).scoreStatus, 'provisional')
  assert.equal(build({ verdict: verdict({ pending: 1, pendingIds: [] }) }).scoreStatus, 'provisional')
})

test('pendingQuestionIds is a COPY — the document cannot alias the verdict', () => {
  const v = verdict({ pending: 1, pendingIds: ['q2'] })
  const doc = build({ verdict: v })
  doc.pendingQuestionIds.push('q3')
  assert.deepEqual(v.pendingIds, ['q2'])
})

console.log(`\nengine results document: ${passed} passed`)
