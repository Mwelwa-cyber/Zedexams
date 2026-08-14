/**
 * Tests for the Number Target game core (src/features/games/lib/numberTargetCore.js).
 *
 * Run: node scripts/test-number-target.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  DIFFICULTY_CONFIGS,
  applyOp,
  configForGame,
  formatStep,
  generateRound,
  invalidMoveHint,
} from '../src/features/games/lib/numberTargetCore.js'

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

/* ── applyOp: the rules the player plays under ───────────────── */

assert(applyOp(3, 4, '+') === 7, '3 + 4 = 7')
assert(applyOp(9, 4, '−') === 5, '9 − 4 = 5')
assert(applyOp(4, 9, '−') === null, '4 − 9 is rejected (no negatives)')
assert(applyOp(5, 5, '−') === null, '5 − 5 is rejected (no zero tiles)')
assert(applyOp(6, 7, '×') === 42, '6 × 7 = 42')
assert(applyOp(8, 4, '÷') === 2, '8 ÷ 4 = 2')
assert(applyOp(8, 3, '÷') === null, '8 ÷ 3 is rejected (remainder)')
assert(applyOp(8, 0, '÷') === null, '8 ÷ 0 is rejected')
assert(applyOp(8, 4, '%') === null, 'unknown operator is rejected')
assert(applyOp(NaN, 4, '+') === null, 'NaN operand is rejected')

assert(invalidMoveHint('−').includes('bigger than zero'), 'subtraction hint mentions staying positive')
assert(invalidMoveHint('÷').includes('exactly'), 'division hint mentions exactness')

/* ── configForGame: difficulty + grade fallback ──────────────── */

assert(configForGame({ difficulty: 'easy' }) === DIFFICULTY_CONFIGS.easy, 'explicit easy wins')
assert(configForGame({ difficulty: 'HARD' }) === DIFFICULTY_CONFIGS.hard, 'difficulty is case-insensitive')
assert(configForGame({ grade: 2 }) === DIFFICULTY_CONFIGS.easy, 'grade 2 falls back to easy')
assert(configForGame({ grade: 5 }) === DIFFICULTY_CONFIGS.medium, 'grade 5 falls back to medium')
assert(configForGame({ grade: 7 }) === DIFFICULTY_CONFIGS.hard, 'grade 7 falls back to hard')
assert(configForGame({}) === DIFFICULTY_CONFIGS.easy, 'no info falls back to easy')

/* ── generateRound: every round must be solvable by its recipe ── */

function multisetRemove(arr, value) {
  const idx = arr.indexOf(value)
  if (idx === -1) return null
  const next = arr.slice()
  next.splice(idx, 1)
  return next
}

function validateRound(round, cfg, label) {
  assert(Array.isArray(round.tiles) && round.tiles.length === cfg.tileCount,
    `${label}: ${cfg.tileCount} tiles (got ${round.tiles?.length})`)
  assert(Number.isInteger(round.target), `${label}: integer target`)
  assert(round.target >= cfg.minTarget && round.target <= cfg.maxTarget,
    `${label}: target ${round.target} within [${cfg.minTarget}, ${cfg.maxTarget}]`)
  assert(!round.tiles.includes(round.target), `${label}: target is not a free tile`)
  assert(round.recipe.length >= 1 && round.recipe.length <= cfg.steps,
    `${label}: recipe has 1..${cfg.steps} steps`)

  // Replay the recipe against the tile multiset under the player's rules.
  let pool = round.tiles.slice()
  let last = null
  for (const step of round.recipe) {
    assert(cfg.ops.includes(step.op), `${label}: op ${step.op} is allowed for this difficulty`)
    let next = multisetRemove(pool, step.a)
    assert(next !== null, `${label}: operand ${step.a} available (${formatStep(step)})`)
    next = multisetRemove(next, step.b)
    assert(next !== null, `${label}: operand ${step.b} available (${formatStep(step)})`)
    const result = applyOp(step.a, step.b, step.op)
    assert(result === step.result, `${label}: ${formatStep(step)} replays correctly (got ${result})`)
    assert(Number.isInteger(result) && result > 0, `${label}: intermediate ${result} is a positive integer`)
    next.push(result)
    pool = next
    last = result
  }
  assert(last === round.target, `${label}: recipe ends on the target (${last} vs ${round.target})`)
}

for (const [name, cfg] of Object.entries(DIFFICULTY_CONFIGS)) {
  const rand = mulberry32(42)
  for (let i = 0; i < 300; i++) {
    validateRound(generateRound(cfg, rand), cfg, `${name} #${i}`)
  }
  // And with the real Math.random for good measure.
  for (let i = 0; i < 100; i++) {
    validateRound(generateRound(cfg), cfg, `${name} (Math.random) #${i}`)
  }
}

/* ── degenerate RNG: must terminate and fall back, never hang ── */

for (const [name, cfg] of Object.entries(DIFFICULTY_CONFIGS)) {
  const zero = () => 0
  const round = generateRound(cfg, zero)
  validateRound(round, cfg, `${name} (degenerate rng)`)
}

console.log(`number-target core: ${passed} assertions passed ✓`)
