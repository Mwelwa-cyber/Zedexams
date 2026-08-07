/**
 * The marking seam's own rules — the projection, the two strategies, and the
 * refusal to guess.
 *
 * The replay comparison already proves `clientKey` reaches the same numbers as
 * the old path across every recorded attempt. That is the strongest evidence
 * there is, and it is not enough on its own: it only covers the shapes the
 * fixtures contain, and it says nothing about `none`, which by design writes
 * nothing anywhere for the comparison to see.
 *
 * So this covers what the comparison structurally cannot — and deliberately
 * does NOT re-assert what it can, because a second copy of "these questions
 * score 9/9" is a second thing to update when a fixture changes.
 */
import assert from 'node:assert/strict'
import { markAttempt, markWithNothing, MARKING_STRATEGIES } from './index.js'
import { markWithClientKey, projectForScoring } from './clientKey.js'
import { fromQuiz } from '../normalise/fromQuiz.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const mcq = (over = {}) => ({
  id: 'q1', type: 'mcq', text: 'What is 1 + 1?',
  options: ['1', '2', '3', '4'], correctAnswer: 1, marks: 1, topic: 'Addition', ...over,
})
const assess = (questions) => fromQuiz({ quiz: { id: 'quiz-1', title: 'T', subject: 'S', grade: '4' }, questions, source: 'quiz' })

console.log('engine — marking')

// ── The projection ───────────────────────────────────────────────────────────

test('the answer key is spread first, so a canonical field can never be overwritten', () => {
  // The two lists do not overlap today (`answerKeyCoverage.test.js` asserts
  // it), which makes the ordering easy to get wrong without noticing. This
  // makes the guarantee structural rather than incidental.
  const projected = projectForScoring({
    id: 'real-id', type: 'mcq', marks: 5, topicIds: ['Real'],
    answerKey: { id: 'spoofed', type: 'spoofed', marks: 999, topic: 'spoofed', correctAnswer: 1 },
  })
  assert.equal(projected.id, 'real-id')
  assert.equal(projected.type, 'mcq')
  assert.equal(projected.marks, 5)
  assert.equal(projected.topic, 'Real')
  assert.equal(projected.correctAnswer, 1, 'and the key itself still comes through')
})

test('topicIds collapses to the FIRST topic, and to undefined when there is none', () => {
  assert.equal(projectForScoring({ topicIds: ['Addition', 'Ignored'], answerKey: {} }).topic, 'Addition')
  assert.equal(projectForScoring({ topicIds: [], answerKey: {} }).topic, undefined)
  assert.equal(projectForScoring({ answerKey: {} }).topic, undefined)
})

test("an absent topic is left for the scorer to default, not defaulted here", () => {
  // `computeQuizScore` rolls an absent topic under 'General'. Writing 'General'
  // in the projection would put the same decision in two places, and the two
  // would eventually disagree.
  const verdict = markWithClientKey({ assessment: assess([mcq({ topic: undefined })]), answers: { q1: 1 } })
  assert.deepEqual(Object.keys(verdict.topicScores), ['General'])
})

// ── clientKey ────────────────────────────────────────────────────────────────

test('a correct answer scores and a wrong one does not', () => {
  const assessment = assess([mcq()])
  assert.equal(markWithClientKey({ assessment, answers: { q1: 1 } }).score, 1)
  assert.equal(markWithClientKey({ assessment, answers: { q1: 0 } }).score, 0)
})

test('the verdict is marked graded', () => {
  assert.equal(markWithClientKey({ assessment: assess([mcq()]), answers: {} }).graded, true)
})

test('an assessment with no questions is 0/0/0%, not a crash', () => {
  const verdict = markWithClientKey({ assessment: assess([]), answers: {} })
  assert.equal(verdict.total, 0)
  assert.equal(verdict.percentage, 0)
  assert.equal(verdict.graded, true, 'nothing to mark is still a completed marking')
})

test('a pending AI answer is excluded from the denominator, not marked wrong', () => {
  // The rule that stops a provider timeout lowering a learner's percentage.
  // It lives in `computeQuizScore`; this asserts the seam carries it through
  // rather than flattening `pending` into the verdict's numbers.
  const assessment = assess([
    mcq(),
    { id: 'q2', type: 'short_answer', text: 'Why?', options: [], marks: 1, topic: 'Addition' },
  ])
  const verdict = markWithClientKey({
    assessment,
    answers: { q1: 1, q2: { text: 'because', pending: true } },
  })
  assert.equal(verdict.total, 1, 'the pending item is out of the denominator')
  assert.equal(verdict.percentage, 100)
  assert.equal(verdict.pending, 1)
  assert.deepEqual(verdict.pendingIds, ['q2'])
})

// ── none ─────────────────────────────────────────────────────────────────────

test('the `none` strategy reports that it did not grade', () => {
  const verdict = markWithNothing()
  assert.equal(verdict.graded, false)
})

test("its zeroes are not marks — every consumer must read `graded`", () => {
  // Recorded because the numbers alone are indistinguishable from a learner who
  // scored nothing, and the protection is `persist/`'s refusal to write them.
  const verdict = markWithNothing()
  assert.equal(verdict.score, 0)
  assert.equal(verdict.percentage, 0)
  assert.deepEqual(verdict.topicScores, {})
})

test('both strategies return the same field set', () => {
  // A consumer that reads one verdict must be able to read the other. A
  // strategy quietly omitting `pendingIds` would crash the consumer that
  // spreads it.
  const a = Object.keys(markWithClientKey({ assessment: assess([mcq()]), answers: {} })).sort()
  const b = Object.keys(markWithNothing()).sort()
  assert.deepEqual(a, b)
})

// ── The dispatcher ───────────────────────────────────────────────────────────

test('markAttempt routes to each declared strategy', () => {
  const assessment = assess([mcq()])
  assert.equal(markAttempt({ assessment, answers: { q1: 1 }, strategy: 'clientKey' }).score, 1)
  assert.equal(markAttempt({ assessment, answers: { q1: 1 }, strategy: 'none' }).graded, false)
})

test('an unknown strategy is REFUSED, never defaulted', () => {
  // Both defaults are wrong in a way nobody would see: defaulting to clientKey
  // marks an attempt the caller asked not to have marked, and defaulting to
  // none silently drops every learner's score.
  assert.throws(
    () => markAttempt({ assessment: assess([mcq()]), answers: {}, strategy: 'server' }),
    /unknown marking strategy "server"/,
  )
  assert.throws(() => markAttempt({ assessment: assess([mcq()]), answers: {} }), /unknown marking strategy/)
})

test('every declared strategy is implemented', () => {
  // The list is what a caller reads; an entry with nothing behind it is a
  // documented strategy that throws.
  for (const strategy of MARKING_STRATEGIES) {
    assert.doesNotThrow(() => markAttempt({ assessment: assess([mcq()]), answers: {}, strategy }), strategy)
  }
  assert.deepEqual([...MARKING_STRATEGIES].sort(), ['clientKey', 'none'])
})

console.log(`\nengine marking: ${passed} passed`)
