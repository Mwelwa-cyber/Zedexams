/**
 * Pure logic for the `timed_quiz` game engine.
 *
 * Plain .js module (no React, no DOM) so it can be unit-tested from plain
 * Node scripts — same pattern as numberTargetCore.js / sortingFactoryCore.js.
 * The React engine in TimedQuizGame.jsx consumes these helpers; rendering,
 * effects and timer wiring stay in the JSX.
 */

/** Fallback question so the engine never dereferences an empty deck slot. */
export const EMPTY_QUESTION = Object.freeze({ question: '', options: [], answer: '' })

/** Questions in one round when a game doc names no other length. */
export const DEFAULT_ROUND_QUESTIONS = 10

/**
 * Resolve the per-game tunables: points-per-correct (default 10) and the
 * round duration in seconds (default 60).
 *
 * `duration` NO LONGER RUNS A CLOCK. PROMPT 7b deleted the countdown from
 * every solo game; a round now ends after `resolveRoundLength` questions.
 * The field survives for one narrow job: `roundOutcome` falls back to it
 * for `timeSpent` when a round's start timestamp is missing, and that
 * fallback is pinned by the games byte-compatibility replay
 * (`scripts/replay/replayGameRound.test.js`), which reads `game.timer`
 * directly. Removing it would move a recorded number in a document the
 * replay diffs. Do not wire it to anything that counts.
 */
export function resolveGameConfig(game) {
  return {
    points: Number(game?.points) || 10,
    duration: Number(game?.timer) || 60,
  }
}

/**
 * How many questions one round is — the fixed set that replaced the clock.
 *
 * Capped by the pool so a round never recycles the deck back over words the
 * learner just answered: a "set" the learner can see the end of is the whole
 * point of the replacement. A game doc may name its own length via
 * `roundQuestions`; `timer` is deliberately NOT read here (see above).
 */
export function resolveRoundLength(game, pool) {
  const authored = Math.floor(Number(game?.roundQuestions) || 0)
  const wanted = authored > 0 ? authored : DEFAULT_ROUND_QUESTIONS
  const available = Array.isArray(pool) ? pool.length : 0
  return Math.max(1, available ? Math.min(wanted, available) : wanted)
}

/** Round progress as a 0–100 percentage for the progress bar. */
export function roundProgressPct(answered, total) {
  const steps = Math.max(1, Math.floor(Number(total) || 0))
  const at = Math.min(steps, Math.max(0, Math.floor(Number(answered) || 0)))
  return Math.round((at / steps) * 100)
}

/** The question at `pos`, or the safe empty question when out of range. */
export function questionAt(deck, pos) {
  return deck[pos] || EMPTY_QUESTION
}

/**
 * Index of the correct option. Compared as strings so `7` and `"7"` match —
 * game docs store answers loosely. Returns -1 when no option matches.
 */
export function correctIndexFor(question) {
  const options = question?.options || []
  return options.findIndex((o) => String(o) === String(question?.answer))
}

/**
 * Streak bonus points: +1 for every 3 consecutive correct answers,
 * capped at +5. `streak` is the count INCLUDING the current answer.
 */
export function streakBonus(streak) {
  return Math.min(5, Math.floor(streak / 3))
}

/** Points gained for a correct answer at the given (new) streak. */
export function correctGain(points, streak) {
  return points + streakBonus(streak)
}

/** Penalty for a wrong answer: a quarter of the points value, at least 2. */
export function wrongPenalty(points) {
  return Math.max(2, Math.floor(points / 4))
}

/** Deduct a penalty — the score never goes below zero. */
export function applyPenalty(score, penalty) {
  return Math.max(0, score - penalty)
}

/**
 * If a freshly shuffled deck happens to start with the question we just
 * answered, rotate the first two so nothing ever feels like an immediate
 * back-to-back repeat. Decks of 0–1 questions are returned unchanged.
 */
export function avoidImmediateRepeat(deck, justAskedQuestion) {
  if (deck.length > 1 && deck[0]?.question === justAskedQuestion) {
    return [deck[1], deck[0], ...deck.slice(2)]
  }
  return deck
}

/**
 * Advance the deck cursor. Mid-deck this just bumps `pos`; when the deck is
 * exhausted it reshuffles the pool (via the injected `shuffle(pool, seed)`,
 * so tests stay deterministic) and guards against an immediate repeat.
 * Returns the next `{ deck, pos }`.
 */
export function advanceDeck({ deck, pos, pool, shuffle, seed }) {
  const nextPos = pos + 1
  if (nextPos < deck.length) return { deck, pos: nextPos }
  const justAsked = deck[pos]?.question
  return { deck: avoidImmediateRepeat(shuffle(pool, seed), justAsked), pos: 0 }
}

/** Accuracy as a whole-number percentage; 0 when nothing was answered. */
export function accuracyPct(correct, wrong) {
  const total = correct + wrong
  return total ? Math.round((correct / total) * 100) : 0
}

/** A round worth celebrating: 50+ points or 80%+ accuracy. */
export function shouldCelebrate(score, accuracy) {
  return score >= 50 || accuracy >= 80
}

/**
 * Seconds spent in the round; falls back to the full duration when the
 * start timestamp was never captured. RECORDED ONLY — nothing scores or
 * ranks on it (PROMPT 7b), and no clock is derived from it.
 */
export function timeSpentSeconds(startedAt, now, duration) {
  return startedAt ? Math.round((now - startedAt) / 1000) : duration
}

/** Star rating from accuracy: 90+ → 5, 70+ → 4, 50+ → 3, otherwise 2. */
export function ratingStars(accuracy) {
  return accuracy >= 90 ? 5 : accuracy >= 70 ? 4 : accuracy >= 50 ? 3 : 2
}

/** Option letter for index i: 0 → "A", 1 → "B", … */
export function optionLetter(i) {
  return String.fromCharCode(65 + i)
}

/**
 * Seeded display order for a question's options: a permutation of
 * [0..count-1], deterministic per seed.
 *
 * The seed banks store the correct answer as the FIRST option on most
 * questions, so a runner that renders options in stored order teaches
 * learners to tap A without reading. The card renders in this order and
 * translates a tap back to the stored index, so scoring, `markAttempt`
 * and the recorded round stay in canonical index space — display order
 * is a render concern and never reaches a write.
 *
 * Same LCG as gamesService's `shuffle`, kept here so the module stays
 * dependency-free and node-testable.
 */
export function optionDisplayOrder(count, seed) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const order = Array.from({ length: n }, (_, i) => i)
  let s = (Number(seed) || 0) >>> 0
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
