/**
 * Pure logic for the `number_target` engine — the prototype-v3 "Number
 * Path" tap-to-sum game (learner redesign step 4).
 *
 * The mechanic is the prototype's, byte for byte where it matters: a
 * 4×4 board of number tiles, a target that is BY CONSTRUCTION the sum
 * of 3–5 tiles already on the board (so every round is solvable), tap
 * tiles to build the sum — hit the target for 20 × combo points and the
 * matched tiles are replaced, bust past it and the selection clears and
 * the combo resets. A round is `LEVEL_TARGETS` targets hit, on an 8-level
 * path that widens the tile range and the target's span as it climbs.
 *
 * The prototype ran each level on a 55-minus-2-per-level countdown, and
 * that was how difficulty climbed. PROMPT 7b deleted it: a maths game
 * that gets harder by giving you LESS TIME to think tests arithmetic
 * speed, which is not what the CBC teaches or examines. Difficulty now
 * climbs the honest way — `tileMax` and `targetTileCount` already did
 * this and are what remains — and a level ends when the work is done.
 *
 * No React, no imports, no Date/randomness of its own — every function
 * that draws numbers takes an `rng` (defaulting to Math.random) so the
 * node test (scripts/test-number-path.mjs) can drive it deterministically.
 * The React engine in NumberTargetGame.jsx consumes these helpers; level
 * progress persists per game id via the (de)serialisers at the bottom.
 */

export const TOTAL_LEVELS = 8
export const GRID_SIZE = 16

/** Targets to hit in one level — the fixed set that replaced the countdown. */
export const LEVEL_TARGETS = 8

/** Node coordinates on the level path — prototype NODE_POS, in a
 * 0–100 × 0–760 space (x is a percentage, y maps via PATH_VIEW_HEIGHT). */
export const NODE_POS = [
  [50, 60], [24, 150], [50, 240], [76, 330],
  [50, 420], [24, 510], [50, 600], [76, 690],
]
export const PATH_VIEW_HEIGHT = 760

const clampLevel = (level) => Math.min(TOTAL_LEVELS, Math.max(1, Math.floor(Number(level) || 1)))

/** Largest tile value at a level (prototype ntFill: 3..11+level). */
export function tileMax(level) {
  return 11 + clampLevel(level)
}

/** A fresh 16-tile board for a level. */
export function fillTiles(level, rng = Math.random) {
  const max = tileMax(level)
  const tiles = []
  for (let i = 0; i < GRID_SIZE; i += 1) tiles.push(3 + Math.floor(rng() * (max - 2)))
  return tiles
}

/** How many board tiles a target is built from: 3–4, or 3–5 above level 4. */
export function targetTileCount(level, rng = Math.random) {
  return 3 + Math.floor(rng() * (clampLevel(level) > 4 ? 3 : 2))
}

/**
 * Draw a new target as the sum of `k` DISTINCT tiles already on the
 * board — the guarantee that a round can always be finished.
 */
export function newTarget(tiles, level, rng = Math.random) {
  const k = targetTileCount(level, rng)
  const idx = tiles.map((_, i) => i)
  // Fisher–Yates over the index list, driven by the injected rng.
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, k).reduce((sum, i) => sum + tiles[i], 0)
}

export function sumOf(tiles, sel) {
  return sel.reduce((sum, i) => sum + (tiles[i] || 0), 0)
}

/** Toggle a tile in/out of the selection (returns a new array). */
export function toggleTile(sel, index) {
  const pos = sel.indexOf(index)
  if (pos >= 0) return sel.slice(0, pos).concat(sel.slice(pos + 1))
  return [...sel, index]
}

/** Where the current selection stands against the target. */
export function judgeSelection(tiles, sel, target) {
  if (!sel.length) return 'empty'
  const s = sumOf(tiles, sel)
  if (s === target) return 'match'
  if (s > target) return 'bust'
  return 'under'
}

/** Points for a match — 20 × the current combo multiplier. */
export function matchGain(combo) {
  return 20 * Math.max(1, Math.floor(Number(combo) || 1))
}

/** Replace the matched tiles with small fresh numbers (prototype: 1–9). */
export function replaceMatched(tiles, sel, rng = Math.random) {
  const next = tiles.slice()
  for (const i of sel) next[i] = 1 + Math.floor(rng() * 9)
  return next
}

/** Stars for a finished round — prototype showWin thresholds. */
export function starsForScore(score) {
  const s = Number(score) || 0
  return s >= 120 ? 3 : s >= 80 ? 2 : 1
}

/* ── Level-path progress (persisted per game id by the engine) ────── */

/**
 * Coerce anything (bad JSON, older shapes, missing doc) into a valid
 * progress object: { completed, best, stars: { [level]: 1..3 } }.
 */
export function normalizeProgress(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const completed = Math.min(TOTAL_LEVELS, Math.max(0, Math.floor(Number(src.completed) || 0)))
  const best = Math.max(0, Math.floor(Number(src.best) || 0))
  const stars = {}
  if (src.stars && typeof src.stars === 'object') {
    for (const [key, value] of Object.entries(src.stars)) {
      const level = Math.floor(Number(key))
      const s = Math.floor(Number(value))
      if (level >= 1 && level <= TOTAL_LEVELS && s >= 1) stars[level] = Math.min(3, s)
    }
  }
  return { completed, best, stars }
}

/** The level the player would enter from the path — the first uncleared one. */
export function currentLevel(progress) {
  const p = normalizeProgress(progress)
  return Math.min(TOTAL_LEVELS, p.completed + 1)
}

/**
 * Fold a finished round into the saved progress. Completing the current
 * level unlocks the next; a replayed level can only improve its stars.
 */
export function applyRound(progress, { level, score }) {
  const p = normalizeProgress(progress)
  const lvl = clampLevel(level)
  const stars = { ...p.stars, [lvl]: Math.max(p.stars[lvl] || 0, starsForScore(score)) }
  return {
    completed: lvl === p.completed + 1 ? lvl : p.completed,
    best: Math.max(p.best, Math.max(0, Math.floor(Number(score) || 0))),
    stars,
  }
}

export function totalStars(progress) {
  const p = normalizeProgress(progress)
  return Object.values(p.stars).reduce((sum, s) => sum + s, 0)
}

/** One entry per path node: { level, state: 'done' | 'current' | 'locked' }. */
export function nodeStates(progress) {
  const p = normalizeProgress(progress)
  const current = currentLevel(progress)
  return NODE_POS.map((_, i) => {
    const level = i + 1
    const state = level <= p.completed ? 'done' : level === current ? 'current' : 'locked'
    return { level, state }
  })
}

/**
 * Map a finished round onto the shared `useGameFinish` result shape —
 * matches count as correct answers, busts as wrong ones, and the peak
 * combo is the round's best streak. `timeSpent` is the learner's actual
 * elapsed seconds — a record, never a score.
 */
export function roundResult({ game, score, matches, busts, peakCombo, timeSpent }) {
  const correct = Math.max(0, Math.floor(Number(matches) || 0))
  const wrong = Math.max(0, Math.floor(Number(busts) || 0))
  const attempts = correct + wrong
  return {
    game,
    score: Math.max(0, Math.floor(Number(score) || 0)),
    correct,
    wrong,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
    bestStreak: Math.max(0, Math.floor(Number(peakCombo) || 0)),
    // MEASURED elapsed seconds, where this used to be the level's countdown
    // length. Still recorded (My Progress reads it); never scored or ranked.
    timeSpent: Math.max(0, Math.floor(Number(timeSpent) || 0)),
  }
}
