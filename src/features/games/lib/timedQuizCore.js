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

/**
 * Resolve the per-game tunables: points-per-correct (default 10) and the
 * round duration in seconds (default 60).
 */
export function resolveGameConfig(game) {
  return {
    points: Number(game?.points) || 10,
    duration: Number(game?.timer) || 60,
  }
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
 * start timestamp was never captured.
 */
export function timeSpentSeconds(startedAt, now, duration) {
  return startedAt ? Math.round((now - startedAt) / 1000) : duration
}

/** Remaining time as a 0–100 percentage for the timer bar. */
export function timerPct(timeLeft, duration) {
  return Math.max(0, Math.round((timeLeft / duration) * 100))
}

/** The timer bar turns urgent in the final 10 seconds. */
export function isTimerDanger(timeLeft) {
  return timeLeft <= 10
}

/** Star rating from accuracy: 90+ → 5, 70+ → 4, 50+ → 3, otherwise 2. */
export function ratingStars(accuracy) {
  return accuracy >= 90 ? 5 : accuracy >= 70 ? 4 : accuracy >= 50 ? 3 : 2
}

/** Option letter for index i: 0 → "A", 1 → "B", … */
export function optionLetter(i) {
  return String.fromCharCode(65 + i)
}
