/**
 * Pure logic for the `province_shapes` game engine.
 *
 * Plain .js module (no React, no DOM) so it can be unit-tested from plain
 * Node scripts — same pattern as numberTargetCore.js / sortingFactoryCore.js.
 * The React engine in ProvinceShapesGame.jsx consumes these helpers.
 *
 * Randomness note: the only random step in this game is the deck shuffle,
 * which uses the seed-injectable `shuffle(pool, seed)` from gamesService
 * (kept in the component because gamesService pulls in Firebase). Everything
 * here is deterministic.
 *
 * Province reference data is re-exported so tests can exercise the map-spec
 * builder against the real polygons.
 */

import { getProvince } from '../../../data/zambiaProvinces.js'

export { ZAMBIA_PROVINCES, PROVINCE_SLUGS, getProvince } from '../../../data/zambiaProvinces.js'

export const DEFAULT_POINTS = 15
export const DEFAULT_DURATION = 90

/** Points per correct answer for a game doc (falsy/NaN falls back to 15). */
export function resolvePoints(game) {
  return Number(game?.points) || DEFAULT_POINTS
}

/** Round duration in seconds for a game doc (falsy/NaN falls back to 90). */
export function resolveDuration(game) {
  return Number(game?.timer) || DEFAULT_DURATION
}

/** Shape returned when the deck position is out of range — render-safe. */
export const EMPTY_QUESTION = Object.freeze({
  question: '',
  options: [],
  answer: '',
  provinceId: '',
})

/** Current question, or a render-safe empty question when out of range. */
export function questionAt(deck, pos) {
  return (deck || [])[pos] || EMPTY_QUESTION
}

/**
 * Index of the correct option. String-coerced comparison so a numeric
 * answer still matches its string option (authoring tools mix the two).
 * Returns -1 when the answer is not among the options.
 */
export function correctIndexFor(question) {
  const options = question?.options || []
  return options.findIndex((o) => String(o) === String(question?.answer))
}

/**
 * Outcome of a correct pick: streak grows by one, and a streak bonus
 * (+1 per 3-in-a-row, capped at +5) rides on top of the base points.
 */
export function correctAnswerOutcome(streak, points) {
  const newStreak = streak + 1
  const bonus = Math.min(5, Math.floor(newStreak / 3))
  return { newStreak, bonus, gained: points + bonus }
}

/** Penalty for a wrong pick: a quarter of the base points, never below 2. */
export function wrongAnswerPenalty(points) {
  return Math.max(2, Math.floor(points / 4))
}

/** Scores never go negative. */
export function clampScore(score) {
  return Math.max(0, score)
}

/** Whole-percent accuracy; an unanswered round reads as 0, not NaN. */
export function accuracyPct(correct, wrong) {
  const total = correct + wrong
  return total ? Math.round((correct / total) * 100) : 0
}

/** Confetti + win sound fire on a strong round. */
export function shouldCelebrate(score, accuracy) {
  return score >= 50 || accuracy >= 80
}

/** Timer bar fill percentage, clamped so overrun never renders negative. */
export function timerPct(timeLeft, duration) {
  return Math.max(0, Math.round((timeLeft / duration) * 100))
}

/**
 * Advance from `pos`: the round is done once every question in the deck
 * has been answered.
 */
export function advanceOutcome(pos, totalQuestions) {
  const nextPos = pos + 1
  return { nextPos, done: nextPos >= totalQuestions }
}

/** Star rating on the done card, from whole-percent accuracy. */
export function ratingStarsFor(accuracy) {
  return accuracy >= 90 ? 5 : accuracy >= 70 ? 4 : accuracy >= 50 ? 3 : 2
}

/**
 * Maps Static API spec for a question's province silhouette, or null when
 * the province is unknown. URL assembly (API key from import.meta.env)
 * stays in the component via buildStaticMapUrl(spec).
 */
export function silhouetteMapSpec(question) {
  const province = getProvince(question?.provinceId)
  if (!province) return null
  return {
    lat: province.center.lat,
    lng: province.center.lng,
    zoom: province.zoom,
    size: [600, 380],
    mapType: 'terrain',
    paths: [{
      color: '0xff5722ff',
      weight: 4,
      fillcolor: '0xff572277',
      points: province.polygon,
    }],
  }
}
