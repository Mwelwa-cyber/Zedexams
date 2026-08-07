/**
 * The `results` document the engine writes when a learner finishes an attempt.
 *
 * This is the engine's half of the byte-compatibility comparison in
 * `docs/phase3-plan.md` §3.3. `src/utils/quizResultPayload.js` is the other
 * half — the old path's builder, extracted in #2114 for exactly this moment —
 * and `scripts/replay/replayEngineComparison.test.js` replays every recorded
 * attempt through both and diffs the journals.
 *
 * It is a pure function. No Firebase, no clock, no React: `nowMs` is a
 * parameter for the same reason it is one in the old builder — a function that
 * reads the clock cannot be replayed, and replay is the guarantee.
 *
 * ## The written contract
 *
 * | field | type | note |
 * |---|---|---|
 * | `userId` | string | |
 * | `quizId` | string | |
 * | `quizTitle` | string | |
 * | `subject` | string | |
 * | `grade` | **string** | the `scores` collection stores a Number by deliberate divergence; these must not converge |
 * | `score` | number | marks earned |
 * | `totalMarks` | number | marks available, excluding items awaiting marking |
 * | `percentage` | number | |
 * | `mode` | 'practice' \| 'exam' | |
 * | `answers` | object | questionId → the learner's answer, as given |
 * | `topicScores` | object | topic → `{correct, total}` |
 * | **`timeSpent`** | **number \| null** | **seconds, or null when the attempt's start is unknown — see below** |
 * | `gradingStatus` | 'complete' \| 'pending' | |
 * | `scoreStatus` | 'final' \| 'provisional' | |
 * | `pendingQuestionIds` | string[] | |
 * | `finalScore` | number \| null | null while provisional |
 *
 * ## `timeSpent: null` — the one approved deviation from the old path
 *
 * Recorded in the session contract's "Approved deviations" section and ratified
 * by the owner. **This module is the first thing that can write it, so this is
 * where the type is declared.**
 *
 * The old path does `Math.round((nowMs - startTime) / 1000)` when a start is
 * known and writes `0` when it is not — and `0` is indistinguishable from an
 * attempt that genuinely took under half a second. A duration that reads as
 * measured but was never measured is worse than an honest absence, so the
 * engine writes `null`.
 *
 * The two conditions the owner attached, both discharged in this PR:
 *
 *   1. **Every reader was checked before the field went nullable.** Three
 *      already treated absence as unknown — `AdminLearnerProfile`'s CSV writes
 *      an empty cell, and both admin `fmtTime`s return '—'. The fourth,
 *      `QuizResultsV2`, read `result.timeSpent ? … : 0` and would have shown a
 *      learner a confident **"0m 0s"**; it is fixed in this PR and has a spec.
 *      Nothing aggregates the field — `classAnalytics` does not read it — so
 *      there is no average to poison.
 *   2. **The nullability is declared here** because there is nothing else to
 *      declare it in. `src/schemas/result.js` is a read-side coercer that says
 *      in its own docblock why no write schema exists, and does not touch
 *      `timeSpent` at all — it passes through as an undocumented extra. The
 *      table above and `RESULT_DOCUMENT_KEYS` below are that declaration, and
 *      `resultDocument.test.js` holds them to it.
 *
 * The old runner is NOT changed. It retires with the quirk; the deviation is
 * declared to the differ so the comparison reports it as expected rather than
 * discovering it at cutover.
 */

/**
 * The exact key set this module produces, in order.
 *
 * The same list, in the same order, as the old path's
 * `QUIZ_RESULT_PAYLOAD_KEYS`. Kept as its own constant rather than imported
 * from there because the whole point of the comparison is that two independent
 * writers agree — importing the answer would make the field-set assertion a
 * tautology.
 */
export const RESULT_DOCUMENT_KEYS = Object.freeze([
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

/**
 * Seconds elapsed, or null when the attempt's start is unknown.
 *
 * `startedAtMs` of 0 is treated as unknown, deliberately: the Unix epoch is not
 * a time any attempt started, and `0` is what a corrupt or partially-written
 * draft leaves behind. The old path's `startTime ? … : 0` reaches the same
 * conclusion about the value and records it as a measurement.
 */
export function elapsedSeconds({ startedAtMs, nowMs }) {
  if (!startedAtMs) return null
  return Math.round((nowMs - startedAtMs) / 1000)
}

/**
 * Build the `results` document for a finished attempt.
 *
 * @param {object} args
 * @param {object} args.assessment  canonical assessment (`schemas/index.js`)
 * @param {object} args.attempt     `{ userId, answers, mode, startedAtMs }`
 * @param {import('../marking/index.js').Verdict} args.verdict
 * @param {number} args.nowMs       injected, never read from the clock here
 * @returns {object} the document to write to `results`
 */
export function buildResultDocument({ assessment, attempt, verdict, nowMs }) {
  // An ungraded verdict must never become a stored result. The `none` strategy
  // returns zeroes because a verdict has to carry numbers, and writing them
  // would file 0% for every past-paper learner — a mark nobody assigned,
  // indistinguishable from one somebody did. Refusing is the protection that
  // makes `none` safe to have at all.
  if (!verdict?.graded) {
    throw new Error('refusing to write a result for an unmarked attempt (verdict.graded is false)')
  }

  const hasPending = (verdict.pending > 0) || (verdict.pendingIds?.length > 0)

  return {
    userId: attempt.userId,
    quizId: assessment.id,
    quizTitle: assessment.title,
    subject: assessment.subject,
    grade: assessment.grade,
    score: verdict.score,
    totalMarks: verdict.total,
    percentage: verdict.percentage,
    mode: attempt.mode,
    answers: attempt.answers,
    topicScores: verdict.topicScores,
    timeSpent: elapsedSeconds({ startedAtMs: attempt.startedAtMs, nowMs }),
    // The provisional-grading rules are the old path's, reached the same way:
    // a partial mark is recorded but `finalScore` stays null until every
    // question is graded, so nothing downstream treats an inflated partial as
    // settled. `buildResultGrading` is not called directly because it takes a
    // scorer result rather than a verdict, and the verdict is the seam.
    gradingStatus: hasPending ? 'pending' : 'complete',
    scoreStatus: hasPending ? 'provisional' : 'final',
    pendingQuestionIds: hasPending ? [...verdict.pendingIds] : [],
    finalScore: hasPending ? null : (Number(verdict.percentage) || 0),
  }
}
