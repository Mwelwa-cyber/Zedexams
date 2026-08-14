/**
 * The scoring state machine of a `timed_quiz` round, as a pure reducer.
 *
 * ## Why this exists
 *
 * `docs/phase3-plan.md` §5.1 requires a byte-compatibility comparison before the
 * games flag flips: the same round, replayed through the old verdict and through
 * the engine's, must produce the same `scores` document. `TimedQuizGame` scored
 * a round by mutating eight pieces of React state inside `pick()`, so the only
 * way to observe what a round produced was to drive the component under jsdom
 * with a fake clock — and a harness that cannot see the numbers cannot diff them.
 *
 * The extraction is deliberately the SMALLEST one that gives the harness the
 * shipped arithmetic rather than a copy of it. `applyPick` is one transition;
 * the component still owns its own state, its own timer and its own animations,
 * and calls this for the arithmetic. `buildGameRoundOutcome` folds the same
 * function over a recorded round. **If these two disagreed the comparison would
 * be measuring a re-implementation**, which is the fork Phase 3 exists to remove
 * — so there is exactly one of them, and the component's `pick()` is a caller.
 *
 * This is a MOVE. Every number below — the streak bonus, the quarter-value
 * penalty, the floor at zero, `bestStreak` tracked as the running maximum — is
 * lifted from `TimedQuizGame.pick()` and `finish()` unchanged. A change to any
 * of them changes a leaderboard, and belongs in its own diff where a reviewer
 * can see the score move on purpose.
 *
 * ## The verdict is injected, and that is the whole point
 *
 * `buildGameRoundOutcome` never asks whether an answer was right. It is handed
 * an `isCorrect` function, because the two paths the cutover compares differ in
 * exactly that one place: the old runner asks `timedQuizCore.correctIndexFor`,
 * the engine asks `markAttempt` against the canonical assessment. Everything
 * downstream of the verdict — the score, the streak, the four writes — is shared
 * code, so a divergence in the written document can only come from the verdict,
 * and the harness can isolate it.
 *
 * `nowMs` and `startedAtMs` are parameters rather than clock reads for the same
 * reason `quizResultPayload.js` takes them: a function that reads the clock
 * cannot be replayed.
 */
import { accuracyPct, applyPenalty, correctGain, timeSpentSeconds, wrongPenalty } from './timedQuizCore.js'

/** A round before the first answer. */
export const EMPTY_ROUND = Object.freeze({
  score: 0,
  correct: 0,
  wrong: 0,
  streak: 0,
  bestStreak: 0,
})

/**
 * Apply one answer to a round.
 *
 * @param {object} round   the round so far (`EMPTY_ROUND` shape)
 * @param {object} args
 * @param {boolean} args.correct  the verdict — decided by the caller, never here
 * @param {number}  args.points   the game's points-per-correct
 * @returns {{round: object, gained: number, penalty: number}}
 *   `gained` and `penalty` are what the score moved by, returned so the UI can
 *   draw its score pop and combo heat from the same arithmetic that scored the
 *   round rather than recomputing it a second time and drifting.
 */
export function applyPick(round, { correct, points }) {
  if (correct) {
    const streak = round.streak + 1
    const gained = correctGain(points, streak)
    return {
      round: {
        score: round.score + gained,
        correct: round.correct + 1,
        wrong: round.wrong,
        streak,
        // Tracked as a running maximum, exactly as the component did with
        // `if (newStreak > bestStreak)`. A round's best streak is not its last.
        bestStreak: streak > round.bestStreak ? streak : round.bestStreak,
      },
      gained,
      penalty: 0,
    }
  }
  const penalty = wrongPenalty(points)
  return {
    round: {
      // Never below zero — a learner cannot end a round in debt.
      score: applyPenalty(round.score, penalty),
      correct: round.correct,
      wrong: round.wrong + 1,
      streak: 0,
      bestStreak: round.bestStreak,
    },
    gained: 0,
    penalty,
  }
}

/**
 * Replay a whole round and produce the five numbers the four game writes are
 * derived from.
 *
 * `scores` takes all five; `badges` (`evaluateAndAwardGameBadges`), the daily
 * streak (`recordDailyPlay`) and the learner-intelligence profile
 * (`updateLearnerProfileAfterGame`) are each handed a subset of the same
 * object. So one identical outcome is the byte-compatibility argument for all
 * four writes, not only for the one this returns a payload for.
 *
 * @param {object} args
 * @param {number} args.points          points-per-correct (`resolveGameConfig`)
 * @param {number} args.duration        round length in seconds
 * @param {Array}  args.picks           the answers, in order. Opaque here — each
 *                                      is passed straight to `isCorrect`.
 * @param {(pick: any) => boolean} args.isCorrect  the verdict seam
 * @param {number|null} args.startedAtMs
 * @param {number} args.nowMs
 * @returns {{score:number, correct:number, wrong:number, bestStreak:number, accuracy:number, timeSpent:number}}
 */
export function buildGameRoundOutcome({ points, duration, picks, isCorrect, startedAtMs, nowMs }) {
  let round = EMPTY_ROUND
  for (const pick of picks ?? []) {
    round = applyPick(round, { correct: Boolean(isCorrect(pick)), points }).round
  }
  return roundOutcome({ round, duration, startedAtMs, nowMs })
}

/**
 * Close a round: the five accumulated numbers plus the two derived at the end.
 *
 * Split out of `buildGameRoundOutcome` so `TimedQuizGame.finish()` closes a
 * LIVE round through the same function the harness closes a REPLAYED one with.
 * The component accumulates as it goes and the harness folds at the end, so
 * this is the one place their two shapes meet — and if the accuracy or the
 * duration were derived twice, the comparison would be diffing two roads to the
 * same document rather than the document.
 *
 * @param {object} args
 * @param {object} args.round     the accumulated round (`EMPTY_ROUND` shape)
 * @param {number} args.duration  round length in seconds
 * @param {number|null} args.startedAtMs
 * @param {number} args.nowMs
 */
export function roundOutcome({ round, duration, startedAtMs, nowMs }) {
  return {
    score: round.score,
    correct: round.correct,
    wrong: round.wrong,
    bestStreak: round.bestStreak,
    accuracy: accuracyPct(round.correct, round.wrong),
    // An unstarted round falls back to the full duration, as `finish()` always
    // has — this is NOT the quiz path's approved `timeSpent: null` deviation,
    // and the games comparison declares no deviations at all.
    timeSpent: timeSpentSeconds(startedAtMs, nowMs, duration),
  }
}

/**
 * The exact key set an outcome carries.
 *
 * Exported so a test can assert the SET rather than spot-check members: a
 * sixth number appearing in an outcome is a new input to four writes, and
 * `toEqual` on three fields passes just as happily when one arrives.
 */
export const GAME_ROUND_OUTCOME_KEYS = Object.freeze([
  'score',
  'correct',
  'wrong',
  'bestStreak',
  'accuracy',
  'timeSpent',
])
