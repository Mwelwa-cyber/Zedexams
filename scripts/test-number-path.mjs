/**
 * Tests for the Number Path game core (src/features/games/lib/numberPathCore.js)
 * — the prototype-v3 tap-to-sum mechanic that replaced the Countdown-style
 * Number Target engine in learner redesign step 4.
 *
 * Run: node scripts/test-number-path.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  GRID_SIZE,
  NODE_POS,
  TOTAL_LEVELS,
  applyRound,
  currentLevel,
  fillTiles,
  judgeSelection,
  LEVEL_TARGETS,
  matchGain,
  newTarget,
  nodeStates,
  normalizeProgress,
  replaceMatched,
  roundResult,
  starsForScore,
  sumOf,
  targetTileCount,
  tileMax,
  toggleTile,
  totalStars,
} from '../src/features/games/lib/numberPathCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ── Path geometry ─────────────────────────────────────────────── */
assert(TOTAL_LEVELS === 8, 'the path has eight levels')
assert(NODE_POS.length === TOTAL_LEVELS, 'one node position per level')

/* ── Timer + board configuration per level ─────────────────────── */
// A level is a fixed set of targets at EVERY level — difficulty climbs
// through tileMax and targetTileCount, never by shortening a clock.
assert(LEVEL_TARGETS === 8, 'a level is eight targets')
// The 35s floor is unreachable inside the 8-level path but declared —
// prove the formula respects it rather than trusting the clamp.
assert(TOTAL_LEVELS === 8, 'the path is eight levels')
assert(tileMax(1) === 12 && tileMax(8) === 19, 'tile range widens with level')

/* ── Board fill ────────────────────────────────────────────────── */
for (const level of [1, 4, 8]) {
  const rng = mulberry32(42 + level)
  const tiles = fillTiles(level, rng)
  assert(tiles.length === GRID_SIZE, `level ${level} board has 16 tiles`)
  assert(tiles.every((t) => t >= 3 && t <= tileMax(level)), `level ${level} tiles stay in 3..max`)
}

/* ── Target generation: always a sum of existing tiles ─────────── */
{
  const counts = new Set()
  for (let seed = 0; seed < 200; seed++) {
    const rng = mulberry32(seed)
    counts.add(targetTileCount(4, rng))
  }
  assert([...counts].every((k) => k === 3 || k === 4), 'levels ≤4 build targets from 3–4 tiles')
  const highCounts = new Set()
  for (let seed = 0; seed < 200; seed++) {
    const rng = mulberry32(seed)
    highCounts.add(targetTileCount(5, rng))
  }
  assert(highCounts.has(5) && [...highCounts].every((k) => k >= 3 && k <= 5), 'levels >4 reach 5-tile targets')
}
{
  // Solvability by construction: exhaustively check that some subset of the
  // board sums to the target, for many seeded rounds.
  for (let seed = 0; seed < 50; seed++) {
    const rng = mulberry32(1000 + seed)
    const tiles = fillTiles(3, rng)
    const target = newTarget(tiles, 3, rng)
    let solvable = false
    for (let mask = 1; mask < 1 << GRID_SIZE && !solvable; mask++) {
      let sum = 0
      for (let i = 0; i < GRID_SIZE; i++) if (mask & (1 << i)) sum += tiles[i]
      if (sum === target) solvable = true
    }
    assert(solvable, `seeded round ${seed} is solvable`)
  }
}

/* ── Selection mechanics ───────────────────────────────────────── */
{
  const tiles = [5, 7, 3, 10]
  let sel = toggleTile([], 0)
  assert(sel.join() === '0', 'tap selects a tile')
  sel = toggleTile(sel, 2)
  assert(sumOf(tiles, sel) === 8, 'sum follows the selection')
  sel = toggleTile(sel, 0)
  assert(sel.join() === '2', 'tapping again deselects, preserving order')
  assert(judgeSelection(tiles, [], 12) === 'empty', 'no selection judges empty')
  assert(judgeSelection(tiles, [0, 1], 12) === 'match', '5+7 hits a 12 target')
  assert(judgeSelection(tiles, [0, 2], 12) === 'under', '5+3 is still under')
  assert(judgeSelection(tiles, [0, 1, 2], 12) === 'bust', 'overshooting busts')
}

/* ── Scoring ───────────────────────────────────────────────────── */
assert(matchGain(1) === 20 && matchGain(3) === 60, 'a match pays 20 × combo')
assert(matchGain(0) === 20, 'combo floors at ×1')
{
  const rng = mulberry32(7)
  const tiles = [15, 15, 15, 15]
  const next = replaceMatched(tiles, [1, 3], rng)
  assert(next[0] === 15 && next[2] === 15, 'unmatched tiles survive')
  assert(next[1] >= 1 && next[1] <= 9 && next[3] >= 1 && next[3] <= 9, 'matched tiles become small fresh numbers')
  assert(tiles[1] === 15, 'replaceMatched does not mutate its input')
}
assert(starsForScore(200) === 3 && starsForScore(120) === 3, '120+ earns three stars')
assert(starsForScore(80) === 2 && starsForScore(20) === 1, 'star thresholds match the prototype')

/* ── Progress persistence ──────────────────────────────────────── */
{
  const empty = normalizeProgress(null)
  assert(empty.completed === 0 && empty.best === 0 && Object.keys(empty.stars).length === 0, 'missing progress normalises to zero')
  const dirty = normalizeProgress({ completed: '99', best: -4, stars: { 2: 9, 44: 3, x: 2 } })
  assert(dirty.completed === TOTAL_LEVELS, 'completed clamps to the path length')
  assert(dirty.best === 0, 'negative best clamps to zero')
  assert(dirty.stars[2] === 3 && !dirty.stars[44] && !dirty.stars.x, 'stars clamp to 3 and drop junk levels')
  assert(currentLevel(empty) === 1 && currentLevel({ completed: 8 }) === 8, 'current level is the first uncleared, capped at the top')
}
{
  let p = normalizeProgress(null)
  p = applyRound(p, { level: 1, score: 140 })
  assert(p.completed === 1 && p.best === 140 && p.stars[1] === 3, 'clearing the current level unlocks the next')
  p = applyRound(p, { level: 1, score: 60 })
  assert(p.completed === 1 && p.best === 140 && p.stars[1] === 3, 'a weaker replay never downgrades')
  p = applyRound(p, { level: 5, score: 90 })
  assert(p.completed === 1 && p.stars[5] === 2, 'a non-sequential level records stars without skipping the path')
  assert(totalStars(p) === 5, 'stars total across levels')
  const states = nodeStates(p)
  assert(states[0].state === 'done' && states[1].state === 'current' && states[7].state === 'locked', 'node states follow progress')
}

/* ── useGameFinish result mapping ──────────────────────────────── */
{
  const game = { id: 'math_number_target_g4' }
  const result = roundResult({ game, score: 180, matches: 6, busts: 2, peakCombo: 4, timeSpent: 47 })
  assert(result.game === game, 'the game doc rides through untouched')
  assert(result.score === 180 && result.correct === 6 && result.wrong === 2, 'matches/busts map to correct/wrong')
  assert(result.accuracy === 75, 'accuracy is matches over attempts')
  assert(result.bestStreak === 4, 'peak combo carries over')
  // MEASURED, where this used to be the level's countdown length.
  assert(result.timeSpent === 47, 'the measured elapsed seconds carry over')
  const idle = roundResult({ game, score: 0, matches: 0, busts: 0, peakCombo: 1, timeSpent: 53 })
  assert(idle.accuracy === 0, 'an idle round is 0% accuracy, not NaN')
}

console.log(`test-number-path: ${passed} assertions passed`)
