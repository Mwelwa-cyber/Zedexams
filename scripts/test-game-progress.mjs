#!/usr/bin/env node
/**
 * Tests for the player progression curve (levels + ranks).
 * Run: npm run test:game-progress
 */

const {
  RANKS,
  levelInfo,
  levelUpInfo,
  pointsForLevel,
  rankForLevel,
  nextRankAfter,
} = await import('../src/utils/gameProgress.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('\npointsForLevel — cumulative curve')

test('level 1 starts at 0 points', () => {
  assert(pointsForLevel(1) === 0, `expected 0, got ${pointsForLevel(1)}`)
})

test('level 2 needs 100, level 3 needs 250', () => {
  // costToNext(1)=100, costToNext(2)=150 → cumulative 100, 250
  assert(pointsForLevel(2) === 100, `expected 100, got ${pointsForLevel(2)}`)
  assert(pointsForLevel(3) === 250, `expected 250, got ${pointsForLevel(3)}`)
})

test('curve is strictly increasing', () => {
  for (let L = 1; L < 40; L++) {
    assert(pointsForLevel(L + 1) > pointsForLevel(L), `not increasing at ${L}`)
  }
})

console.log('\nlevelInfo — snapshot at a points total')

test('0 points is level 1, Rookie, 0% progress', () => {
  const info = levelInfo(0)
  assert(info.level === 1, `expected level 1, got ${info.level}`)
  assert(info.rank.title === 'Rookie', `expected Rookie, got ${info.rank.title}`)
  assert(info.progress === 0, `expected 0%, got ${info.progress}`)
  assert(info.pointsToNext === 100, `expected 100 to next, got ${info.pointsToNext}`)
})

test('exactly at a threshold lands on the new level with 0% progress', () => {
  const info = levelInfo(100)
  assert(info.level === 2, `expected level 2, got ${info.level}`)
  assert(info.xpIntoLevel === 0, `expected 0 into level, got ${info.xpIntoLevel}`)
  assert(info.progress === 0, `expected 0%, got ${info.progress}`)
})

test('halfway through a level reports ~50%', () => {
  // level 1 spans 0..100; 50 points is halfway
  const info = levelInfo(50)
  assert(info.level === 1, `expected level 1, got ${info.level}`)
  assert(info.progress === 50, `expected 50%, got ${info.progress}`)
  assert(info.pointsToNext === 50, `expected 50 to next, got ${info.pointsToNext}`)
})

test('progress is always clamped 0..100', () => {
  for (const p of [0, 1, 99, 100, 101, 999, 25000]) {
    const { progress } = levelInfo(p)
    assert(progress >= 0 && progress <= 100, `progress ${progress} out of range at ${p}`)
  }
})

test('level rises monotonically with points', () => {
  let prev = 0
  for (let p = 0; p <= 30000; p += 137) {
    const lvl = levelInfo(p).level
    assert(lvl >= prev, `level dropped to ${lvl} at ${p}`)
    prev = lvl
  }
})

test('garbage input is treated as 0', () => {
  for (const bad of [-100, NaN, undefined, null, 'x']) {
    const info = levelInfo(bad)
    assert(info.level === 1, `expected level 1 for ${String(bad)}, got ${info.level}`)
  }
})

console.log('\nranks')

test('ranks unlock at their thresholds', () => {
  assert(rankForLevel(1).title === 'Rookie')
  assert(rankForLevel(2).title === 'Rookie')
  assert(rankForLevel(3).title === 'Learner')
  assert(rankForLevel(5).title === 'Scholar')
  assert(rankForLevel(20).title === 'Legend')
  assert(rankForLevel(99).title === 'Legend')
})

test('nextRankAfter points to the upcoming rank, null at the top', () => {
  assert(nextRankAfter(1).title === 'Learner', `got ${nextRankAfter(1)?.title}`)
  assert(nextRankAfter(4).title === 'Scholar', `got ${nextRankAfter(4)?.title}`)
  assert(nextRankAfter(25) === null, 'expected null past the last rank')
})

test('RANKS thresholds ascend', () => {
  for (let i = 1; i < RANKS.length; i++) {
    assert(RANKS[i].min > RANKS[i - 1].min, `RANKS not ascending at ${i}`)
  }
})

console.log('\nlevelUpInfo — before/after comparison')

test('no change when points stay in the same level', () => {
  const r = levelUpInfo(10, 40)
  assert(r.leveledUp === false, 'should not level up')
  assert(r.levelsGained === 0)
})

test('detects a level-up across one boundary', () => {
  const r = levelUpInfo(90, 120) // level 1 → 2 (boundary at 100)
  assert(r.leveledUp === true, 'should level up')
  assert(r.fromLevel === 1 && r.toLevel === 2, `got ${r.fromLevel}→${r.toLevel}`)
  assert(r.levelsGained === 1)
})

test('flags a new rank when the level-up crosses a rank band', () => {
  // level 2 → 3 unlocks Learner (rank min 3). Boundary to level 3 is 250 pts.
  const r = levelUpInfo(240, 260)
  assert(r.leveledUp === true)
  assert(r.newRank && r.newRank.title === 'Learner', `expected Learner, got ${r.newRank?.title}`)
})

test('level-up without a rank change leaves newRank null', () => {
  // level 1 → 2 stays within Rookie (Rookie covers levels 1–2).
  const r = levelUpInfo(90, 120)
  assert(r.leveledUp === true)
  assert(r.newRank === null, `expected null newRank, got ${r.newRank?.title}`)
})

// ── Report ────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
