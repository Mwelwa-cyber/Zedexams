/**
 * src/utils/quizResultPayload.js
 *
 * The `results` document a finished learner quiz is saved as — built as a pure
 * function of the attempt, with no React, no Firebase and no clock of its own.
 *
 * Extracted verbatim from `QuizRunnerV2.handleSubmit` (Phase 3 preparation, see
 * `docs/phase3-plan.md` §10.1). It was a closure inside a 1,985-line component,
 * which meant the only way to observe the payload the app writes was to render
 * the whole runner under jsdom. The Assessment Engine's byte-compatibility
 * harness has to diff this exact object against the engine's version of it, so
 * the old path has to be callable on its own — while it is still the only path.
 *
 * **This is a move, not a rewrite.** The field set, the field order, the
 * scoring call, the rounding and the provisional-grading spread are unchanged
 * from the component. Anything that would alter the written document belongs in
 * its own PR, where a reviewer can see the write change on purpose.
 *
 * `nowMs` is a parameter rather than a `Date.now()` call for the same reason:
 * a function that reads the clock cannot be replayed, and replay is the whole
 * point of the harness.
 */
// Explicit `.js` — this module is imported by a plain-node test as well as by
// Vite, and node's ESM resolver does not guess extensions. `quizScoring.js`
// carries its own imports the same way for the same reason.
import { computeQuizScore, buildResultGrading } from './quizScoring.js'

/**
 * Build the `results` document for a submitted attempt.
 *
 * @param {object}   args
 * @param {object}   args.quiz       the quiz doc (title/subject/grade are read)
 * @param {string}   args.quizId
 * @param {Array}    args.questions  the graded questions, each with its key
 * @param {object}   args.answers    map of questionId → learner answer
 * @param {string}   args.mode       'practice' | 'exam'
 * @param {string}   args.userId
 * @param {number|null} args.startTime  Unix ms the attempt started, or null
 * @param {number}   args.nowMs      Unix ms at submit — injected, never read here
 * @returns {object} the exact object passed to `useFirestore.saveResult`
 */
export function buildQuizResultPayload({
  quiz,
  quizId,
  questions,
  answers,
  mode,
  userId,
  startTime,
  nowMs,
}) {
  const timeSpent = startTime ? Math.round((nowMs - startTime) / 1000) : 0
  // Server-authoritative scoring: computeQuizScore re-grades each question
  // from its persisted answer key (correctAnswer / tolerance / correctRegion)
  // rather than trusting any client-stored `correct` flag.
  const scoreResult = computeQuizScore(questions, answers)
  const { score, total, percentage, topicScores } = scoreResult
  // Gate 1: if any text answer is still awaiting AI marking (a burst
  // throttle / provider timeout / budget rejection at submit), persist the
  // attempt as PROVISIONAL — the partial percentage is recorded but
  // finalScore is null and gradingStatus is 'pending', so nothing
  // downstream (pass/fail, badges, leaderboards, class analytics) treats
  // an inflated partial mark as settled. This state lives in the durable
  // Firestore doc (not just React memory), and a later re-grade settles it.
  const grading = buildResultGrading(scoreResult)
  return {
    userId,
    quizId,
    quizTitle: quiz.title,
    subject: quiz.subject,
    grade: quiz.grade,
    score,
    totalMarks: total,
    percentage,
    mode,
    answers,
    topicScores,
    timeSpent,
    ...grading,
  }
}

/**
 * The exact key set `buildQuizResultPayload` produces, in order.
 *
 * Exported so a test can assert the field set rather than spot-check a few
 * properties: `toEqual`-style checks on a handful of fields pass just as
 * happily when a thirteenth field appears, and a new field in a `results`
 * document is a schema change with rules, index and consumer consequences.
 * The byte-compatibility harness reads this too.
 */
export const QUIZ_RESULT_PAYLOAD_KEYS = Object.freeze([
  'userId',
  'quizId',
  'quizTitle',
  'subject',
  'grade',
  'score',
  'totalMarks',
  'percentage',
  'mode',
  'answers',
  'topicScores',
  'timeSpent',
  'gradingStatus',
  'scoreStatus',
  'pendingQuestionIds',
  'finalScore',
])
