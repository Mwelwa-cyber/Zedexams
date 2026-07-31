/**
 * test-past-paper-quiz-access.mjs
 *
 * Covers the two halves of the "paper says it has a quiz, the quiz says no"
 * defect:
 *
 *   1. scripts/audit-past-paper-quiz-access.mjs — the classifier that decides
 *      whether a signed-OUT visitor can open a paper's linked quiz, and the
 *      repair plan built from it.
 *   2. src/utils/pastPaperQuiz.js — the load-outcome vocabulary, so a refused
 *      read can never again be reported with the same value as a missing one,
 *      and so no learner-facing string claims the paper has no quiz.
 *
 * Plain-node assertions (see CLAUDE.md — `*.test.js` / `test-*.mjs` run under
 * `node` directly).
 */

import assert from 'node:assert/strict'

import {
  PAPER_QUIZ_STATES,
  classifyPaperQuizLink,
  markPendingPatch,
  planQuizAccessRepair,
  restorePublicAccessPatch,
} from './audit-past-paper-quiz-access.mjs'

// The pure half of the loader — importing `pastPaperQuiz.js` here would drag
// the Firebase SDK into a plain-node test for three constants.
import { QUIZ_LOAD, QUIZ_LOAD_TEXT, isPermissionDenied } from '../src/utils/pastPaperQuizLoad.js'

let passed = 0
function t(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const paper = { id: 'p1', quizId: 'q1', title: 'Grade 7 Social Studies 2019' }
const publicQuiz = { id: 'q1', isPublished: true, publicAccess: true, quizType: 'past_paper' }

console.log('classifyPaperQuizLink')

t('a published, public quiz with questions is ok', () => {
  const r = classifyPaperQuizLink({ paper, quiz: publicQuiz, questionCount: 40 })
  assert.equal(r.state, PAPER_QUIZ_STATES.OK)
  assert.equal(r.paperId, 'p1')
  assert.equal(r.quizId, 'q1')
})

t('publicAccess off is not_public even when isPublished is true', () => {
  // This is the exact production shape behind the reported bug: the paper
  // still advertises the quiz, the quiz still has its questions, and the
  // anonymous read is refused because ONE flag is off.
  const r = classifyPaperQuizLink({
    paper, quiz: { ...publicQuiz, publicAccess: false }, questionCount: 40,
  })
  assert.equal(r.state, PAPER_QUIZ_STATES.NOT_PUBLIC)
  assert.equal(r.publicAccess, false)
  assert.equal(r.isPublished, true)
})

t('isPublished off is not_public even when publicAccess is true', () => {
  const r = classifyPaperQuizLink({
    paper, quiz: { ...publicQuiz, isPublished: false }, questionCount: 40,
  })
  assert.equal(r.state, PAPER_QUIZ_STATES.NOT_PUBLIC)
})

t('a missing flag is treated as off, never as absent-therefore-fine', () => {
  const r = classifyPaperQuizLink({
    paper, quiz: { id: 'q1', quizType: 'past_paper' }, questionCount: 40,
  })
  assert.equal(r.state, PAPER_QUIZ_STATES.NOT_PUBLIC)
})

t('a truthy non-true flag does not count as public', () => {
  // The rule compares `== true`. A string "true" satisfies neither the rule
  // nor this check, and must not read as public here either.
  const r = classifyPaperQuizLink({
    paper, quiz: { ...publicQuiz, publicAccess: 'true' }, questionCount: 40,
  })
  assert.equal(r.state, PAPER_QUIZ_STATES.NOT_PUBLIC)
})

t('daily_exam wins over the flags — the questions rule blocks it regardless', () => {
  const r = classifyPaperQuizLink({
    paper, quiz: { ...publicQuiz, quizType: 'daily_exam' }, questionCount: 40,
  })
  assert.equal(r.state, PAPER_QUIZ_STATES.DAILY_EXAM)
})

t('a quiz with zero questions is empty, not ok', () => {
  const r = classifyPaperQuizLink({ paper, quiz: publicQuiz, questionCount: 0 })
  assert.equal(r.state, PAPER_QUIZ_STATES.EMPTY)
})

t('a deleted quiz doc is missing', () => {
  const r = classifyPaperQuizLink({ paper, quiz: null, questionCount: 0 })
  assert.equal(r.state, PAPER_QUIZ_STATES.MISSING)
})

console.log('planQuizAccessRepair')

const rows = [
  classifyPaperQuizLink({ paper: { id: 'a', quizId: 'qa' }, quiz: publicQuiz, questionCount: 10 }),
  classifyPaperQuizLink({ paper: { id: 'b', quizId: 'qb' }, quiz: { ...publicQuiz, publicAccess: false }, questionCount: 10 }),
  classifyPaperQuizLink({ paper: { id: 'c', quizId: 'qc' }, quiz: publicQuiz, questionCount: 0 }),
  classifyPaperQuizLink({ paper: { id: 'd', quizId: 'qd' }, quiz: null, questionCount: 0 }),
  classifyPaperQuizLink({ paper: { id: 'e', quizId: 'qe' }, quiz: { ...publicQuiz, quizType: 'daily_exam' }, questionCount: 10 }),
]

t('each broken state lands in exactly one bucket', () => {
  const plan = planQuizAccessRepair(rows)
  assert.equal(plan.scanned, 5)
  assert.equal(plan.ok, 1)
  assert.equal(plan.broken, 4)
  assert.deepEqual(plan.restore.map((r) => r.paperId), ['b'])
  assert.deepEqual(plan.markPending.map((r) => r.paperId), ['c', 'd'])
  assert.deepEqual(plan.review.map((r) => r.paperId), ['e'])
})

t('a daily-exam pick is never auto-repaired', () => {
  const plan = planQuizAccessRepair(rows)
  const autoTouched = [...plan.restore, ...plan.markPending].map((r) => r.paperId)
  assert.ok(!autoTouched.includes('e'))
})

t('an all-ok scan plans no writes at all (idempotence)', () => {
  const plan = planQuizAccessRepair([rows[0]])
  assert.equal(plan.broken, 0)
  assert.equal(plan.restore.length, 0)
  assert.equal(plan.markPending.length, 0)
})

console.log('repair patches')

t('restoring public access touches only the two flags', () => {
  assert.deepEqual(restorePublicAccessPatch(), { isPublished: true, publicAccess: true })
})

t('an empty quiz keeps its id in pendingQuizId so the Studio resumes it', () => {
  const patch = markPendingPatch(rows[2])
  assert.equal(patch.quizId, null)
  assert.equal(patch.quizStatus, 'pending')
  assert.equal(patch.pendingQuizId, 'qc')
})

t('a deleted quiz parks nothing — there is nothing to resume', () => {
  const patch = markPendingPatch(rows[3])
  assert.equal(patch.quizId, null)
  assert.equal(patch.quizStatus, 'pending')
  assert.equal(patch.pendingQuizId, null)
})

console.log('load outcomes')

t('permission-denied is recognised by code and by message', () => {
  assert.equal(isPermissionDenied({ code: 'permission-denied' }), true)
  assert.equal(isPermissionDenied({ code: 'firestore/permission-denied' }), true)
  assert.equal(isPermissionDenied({ message: 'Missing or insufficient permissions.' }), true)
})

t('a network failure is NOT reported as a refusal', () => {
  assert.equal(isPermissionDenied({ code: 'unavailable', message: 'Failed to get document because the client is offline.' }), false)
  assert.equal(isPermissionDenied(new Error('network error')), false)
  assert.equal(isPermissionDenied(null), false)
})

t('a refused read and a retryable failure are different outcomes', () => {
  // The whole point of the vocabulary: these three must never collapse.
  const outcomes = new Set([QUIZ_LOAD.UNAVAILABLE, QUIZ_LOAD.QUESTIONS_BLOCKED, QUIZ_LOAD.FAILED])
  assert.equal(outcomes.size, 3)
  assert.ok(!outcomes.has(QUIZ_LOAD.OK))
})

t('every failing outcome has learner-facing copy', () => {
  for (const outcome of [QUIZ_LOAD.UNAVAILABLE, QUIZ_LOAD.QUESTIONS_BLOCKED, QUIZ_LOAD.FAILED]) {
    const text = QUIZ_LOAD_TEXT[outcome]
    assert.equal(typeof text, 'string')
    assert.ok(text.trim().length > 0, `no copy for ${outcome}`)
  }
})

t('no failure message tells the visitor the paper has no quiz', () => {
  // The paper reached this route BECAUSE it advertises a quiz. Saying there
  // is none is the one thing these strings must not do.
  for (const text of Object.values(QUIZ_LOAD_TEXT)) {
    assert.ok(!/no quiz|doesn't have a quiz|does not have a quiz/i.test(text), `misleading copy: ${text}`)
  }
})

console.log(`\n${passed} assertions passed.`)
