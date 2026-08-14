/**
 * src/utils/gameScorePayload.js
 *
 * The `scores` document a finished `timed_quiz` round is saved as — built as a
 * pure function of the game and the round outcome, with no Firebase, no auth
 * lookup and no clock of its own.
 *
 * Extracted verbatim from `gamesService.saveScore` for the games cutover
 * (`docs/phase3-plan.md` §10.1 step 8), for the same reason
 * `quizResultPayload.js` was extracted from `QuizRunnerV2.handleSubmit`: the
 * byte-compatibility harness has to diff this exact object against the engine
 * path's version of it, and it cannot do that while the only way to produce one
 * is to be signed in to Firebase.
 *
 * **This is a move, not a rewrite.** Field set, field order, coercions and
 * defaults are unchanged. `saveScore` supplies `userId`, `displayName` and the
 * `playedAt` server timestamp — the three things that are not functions of the
 * round — and keeps every one of its behaviours.
 */

/**
 * Build the `scores` document for a completed round.
 *
 * @param {object} args
 * @param {object} args.game     the `games/{id}` document
 * @param {object} args.outcome  `{score, accuracy, timeSpent, correct, wrong, bestStreak}`
 *                               — `buildGameRoundOutcome`'s return value
 * @param {string} args.userId   the signed-in uid; the rules require it to equal
 *                               `request.auth.uid`, so it is never client-chosen
 * @param {string} args.displayName
 * @returns {object} every field of the written document except `playedAt`
 */
export function buildGameScorePayload({ game, outcome, userId, displayName }) {
  return {
    userId,
    gameId: game.id,
    // INTENTIONAL DIVERGENCE: game scores store grade as a Number and subject
    // lowercased. This is self-consistent — every games read query writes and
    // reads the same shape (and filters subject client-side). These fields are
    // NOT the canonical quiz/lesson wire values (string grade + display-label
    // subject via normalizeSubject). Do NOT cross-join scores with
    // quizzes/lessons on `grade`/`subject`, and do NOT "normalize" them here —
    // that would silently break the working leaderboard/score queries.
    //
    // The Assessment Engine reads a game through `normalise/fromGame.js`, which
    // carries subject and grade as STRINGS because the canonical model's fields
    // are strings. That conversion is one-way and stops at the model: this
    // document is built from the `games` doc directly, never from the canonical
    // assessment, so the engine path writes the same Number and the same
    // lowercased string the old path does. It is the single most load-bearing
    // sentence in the games path (`docs/phase3-plan.md` §1.5, D5), and the
    // replay comparison fails if either changes.
    grade: Number(game.grade),
    subject: String(game.subject || '').toLowerCase(),
    score: Number(outcome?.score) || 0,
    accuracy: Number(outcome?.accuracy) || 0,
    timeSpent: Number(outcome?.timeSpent) || 0,
    correct: Number(outcome?.correct) || 0,
    wrong: Number(outcome?.wrong) || 0,
    bestStreak: Number(outcome?.bestStreak) || 0,
    displayName: String(displayName || 'Anonymous').slice(0, 40),
  }
}

/**
 * The exact key set `buildGameScorePayload` produces, in order, plus the
 * `playedAt` the service stamps.
 *
 * Exported so a test can assert the field set rather than spot-check a few
 * properties. A new field in a `scores` document is a schema change with rules
 * (`firestore.rules` validates `userId`/`gameId`/`score`/`grade`/`subject`/
 * `playedAt` on create), index and leaderboard-query consequences.
 */
export const GAME_SCORE_PAYLOAD_KEYS = Object.freeze([
  'userId',
  'gameId',
  'grade',
  'subject',
  'score',
  'accuracy',
  'timeSpent',
  'correct',
  'wrong',
  'bestStreak',
  'displayName',
  'playedAt',
])
