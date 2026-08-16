/**
 * scripts/test-quiz-grading-status.mjs
 *
 * B3/OBS-005 Gate 1 — a quiz attempt with a text answer still awaiting AI
 * marking must be persisted as PROVISIONAL, never as a final score. These
 * checks pin the pure decision logic that guards that:
 *   - computeQuizScore surfaces pending questions (never scores them wrong),
 *   - buildResultGrading maps that into durable status fields with a null
 *     finalScore while anything is pending,
 *   - coerceResult normalises legacy docs (no status fields) to complete/final
 *     and never reports a provisional finalScore.
 *
 * Plain-node test (throws on failure). Run: npm run test:quiz-grading-status
 */

import assert from 'node:assert/strict'
import {
  computeQuizScore,
  buildResultGrading,
  isProvisionalResult,
} from '../src/utils/quizScoring.js'
import { coerceResult } from '../src/shared/schemas/result.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const QUESTIONS = [
  { id: 'q1', type: 'mcq', correctAnswer: 0, marks: 1, topic: 'Algebra' },
  { id: 'q2', type: 'mcq', correctAnswer: 1, marks: 1, topic: 'Algebra' },
  { id: 'q3', type: 'short_answer', marks: 1, topic: 'Essays' },
]

console.log('buildResultGrading — provisional vs final')

check('a pending text answer yields a provisional attempt with null finalScore', () => {
  const score = computeQuizScore(QUESTIONS, {
    q1: 0, // correct
    q2: 1, // correct
    q3: { text: 'answer', pending: true }, // could not be marked
  })
  // The two graded MCQs are both correct → partial percentage reads 100%.
  assert.equal(score.percentage, 100)
  assert.equal(score.pending, 1)
  assert.deepEqual(score.pendingIds, ['q3'])

  const grading = buildResultGrading(score)
  assert.equal(grading.gradingStatus, 'pending')
  assert.equal(grading.scoreStatus, 'provisional')
  assert.deepEqual(grading.pendingQuestionIds, ['q3'])
  // The inflated 100% partial mark must NOT become the authoritative score.
  assert.equal(grading.finalScore, null)
  assert.equal(isProvisionalResult(grading), true)
})

check('graded:false is treated the same as pending:true', () => {
  const score = computeQuizScore(QUESTIONS, {
    q1: 0,
    q2: 1,
    q3: { text: 'answer', graded: false },
  })
  const grading = buildResultGrading(score)
  assert.equal(grading.gradingStatus, 'pending')
  assert.equal(grading.finalScore, null)
})

check('a fully graded attempt is complete/final with an authoritative finalScore', () => {
  const score = computeQuizScore(QUESTIONS, {
    q1: 0,
    q2: 0, // wrong
    q3: { text: 'answer', correct: true },
  })
  // 2 of 3 marks → 67%.
  assert.equal(score.pending, 0)
  const grading = buildResultGrading(score)
  assert.equal(grading.gradingStatus, 'complete')
  assert.equal(grading.scoreStatus, 'final')
  assert.deepEqual(grading.pendingQuestionIds, [])
  assert.equal(grading.finalScore, score.percentage)
  assert.equal(isProvisionalResult(grading), false)
})

check('an attempt with no text questions is always final', () => {
  const score = computeQuizScore(
    [{ id: 'q1', type: 'mcq', correctAnswer: 0, marks: 1 }],
    { q1: 0 },
  )
  const grading = buildResultGrading(score)
  assert.equal(grading.scoreStatus, 'final')
  assert.equal(grading.finalScore, 100)
})

check('buildResultGrading tolerates a bare/empty score object', () => {
  const grading = buildResultGrading({})
  assert.equal(grading.gradingStatus, 'complete')
  assert.equal(grading.finalScore, 0)
  assert.deepEqual(grading.pendingQuestionIds, [])
})

console.log('isProvisionalResult — status predicate')

check('legacy docs (no status fields) are treated as final, not provisional', () => {
  assert.equal(isProvisionalResult({ percentage: 85 }), false)
  assert.equal(isProvisionalResult(null), false)
  assert.equal(isProvisionalResult(undefined), false)
})

check('either status field flips the predicate to provisional', () => {
  assert.equal(isProvisionalResult({ gradingStatus: 'pending' }), true)
  assert.equal(isProvisionalResult({ scoreStatus: 'provisional' }), true)
})

console.log('coerceResult — durable normalisation of persisted docs')

check('a persisted provisional doc round-trips with a null finalScore', () => {
  const doc = coerceResult({
    percentage: 100,
    score: 2,
    totalMarks: 2,
    gradingStatus: 'pending',
    scoreStatus: 'provisional',
    pendingQuestionIds: ['q3'],
    finalScore: null,
  })
  assert.equal(doc.gradingStatus, 'pending')
  assert.equal(doc.scoreStatus, 'provisional')
  assert.deepEqual(doc.pendingQuestionIds, ['q3'])
  assert.equal(doc.finalScore, null)
})

check('a stale finalScore on a provisional doc is forced back to null', () => {
  // Defensive: even if a bad write left a numeric finalScore on a pending doc,
  // the reader must never surface it as authoritative.
  const doc = coerceResult({
    percentage: 100,
    gradingStatus: 'pending',
    scoreStatus: 'provisional',
    finalScore: 100,
  })
  assert.equal(doc.finalScore, null)
})

check('a legacy doc normalises to complete/final with finalScore = percentage', () => {
  const doc = coerceResult({ percentage: 73, score: 8, totalMarks: 11 })
  assert.equal(doc.gradingStatus, 'complete')
  assert.equal(doc.scoreStatus, 'final')
  assert.deepEqual(doc.pendingQuestionIds, [])
  assert.equal(doc.finalScore, 73)
})

check('pendingQuestionIds is always a string array (bad shapes dropped)', () => {
  const doc = coerceResult({
    percentage: 50,
    gradingStatus: 'pending',
    pendingQuestionIds: ['ok', 5, null, { x: 1 }],
  })
  assert.deepEqual(doc.pendingQuestionIds, ['ok'])
})

console.log('durability — pending state survives serialization (localStorage / Firestore)')

check('a pending answer survives a JSON round-trip and still computes provisional', () => {
  // saveQuizSession (localStorage) and the Firestore write both persist the
  // answers map as plain JSON. A pending answer must survive that round-trip so
  // a refresh / another device re-derives the SAME provisional result — the
  // state is never trapped in React memory.
  const answers = { q1: 0, q3: { text: 'answer', pending: true } }
  const restored = JSON.parse(JSON.stringify(answers))
  const score = computeQuizScore(QUESTIONS, restored)
  const grading = buildResultGrading(score)
  assert.equal(grading.gradingStatus, 'pending')
  assert.deepEqual(grading.pendingQuestionIds, ['q3'])
  assert.equal(grading.finalScore, null)
})

console.log(`\nAll ${passed} quiz grading-status checks passed.`)
