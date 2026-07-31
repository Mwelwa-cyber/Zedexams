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
  AUTH_REMEDIES,
  PAPER_QUIZ_STATES,
  classifyAuthFailure,
  classifyPaperQuizLink,
  isAuthFailure,
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

console.log('credential failures')

t('no credentials at all classifies as missing', () => {
  // Verbatim from a run with no credentials — the whole reason this exists is
  // that initializeApp() succeeds and the FIRST QUERY is what fails.
  assert.equal(classifyAuthFailure(new Error('Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.')), 'missing')
})

t('an expired grant classifies as expired, not missing', () => {
  // Verbatim from a real run against production: credentials WERE configured,
  // Google just wanted them re-authorised. Reporting this as "missing" sends
  // the operator to set up something they already have.
  const err = new Error('2 UNKNOWN: Getting metadata from plugin failed with error: {"error":"invalid_grant","error_description":"reauth related error (rapt_required)","error_uri":"https://support.google.com/a/answer/9368756","error_subtype":"rapt_required"}')
  err.code = 2
  assert.equal(classifyAuthFailure(err), 'expired')
})

t('the kind is read from `details` too, not only `message`', () => {
  // gRPC puts the payload on `details`; a wrapper that loses the message must
  // not turn a known failure into an unclassified one.
  assert.equal(classifyAuthFailure({ code: 2, details: 'invalid_grant ... rapt_required' }), 'expired')
})

t('a gRPC UNAUTHENTICATED status classifies as missing', () => {
  assert.equal(classifyAuthFailure({ code: 16, message: 'UNAUTHENTICATED' }), 'missing')
})

t('PERMISSION_DENIED is NOT an auth failure', () => {
  // A signed-in principal without the right role. Sending that operator to a
  // login command is the wrong path — they already are signed in.
  assert.equal(classifyAuthFailure({ code: 7, message: 'Missing or insufficient permissions.' }), null)
  assert.equal(isAuthFailure({ code: 7, message: 'Missing or insufficient permissions.' }), false)
})

t('an ordinary Firestore failure is left to surface as itself', () => {
  assert.equal(classifyAuthFailure(new Error('The query requires an index.')), null)
  assert.equal(classifyAuthFailure({ code: 14, message: 'UNAVAILABLE' }), null)
  assert.equal(classifyAuthFailure(null), null)
})

t('each kind has a remedy, and none of them says `firebase login`', () => {
  // firebase-admin authenticates with Google APPLICATION-DEFAULT credentials,
  // not the ones `firebase login` stores for the firebase CLI. Naming the
  // wrong command costs the operator a round trip.
  for (const kind of ['expired', 'missing']) {
    const lines = AUTH_REMEDIES[kind]
    assert.ok(Array.isArray(lines) && lines.length > 0, `no remedy for ${kind}`)
    const text = lines.join('\n')
    assert.ok(/gcloud auth application-default login/.test(text), `${kind} does not name the working command`)
    assert.ok(!/^\s*firebase login\s*$/m.test(text), `${kind} still suggests firebase login`)
  }
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
