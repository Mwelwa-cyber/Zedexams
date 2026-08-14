#!/usr/bin/env node
/**
 * Tests for the pure "game feel" helpers (combo heat + score-pop labels).
 * These drive the moment-to-moment juice shared by the game engines, so a
 * regression here would silently flatten the in-play feedback.
 * Run: npm run test:game-feel
 */

const { comboHeat, scorePopLabel } = await import('../src/features/games/lib/gameFeel.js')

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

console.log('\ncomboHeat — tiers escalate with the streak')

test('streak 0 and 1 are cold / inactive', () => {
  for (const n of [0, 1]) {
    const h = comboHeat(n)
    assert(h.tier === 'cold', `expected cold at ${n}, got ${h.tier}`)
    assert(h.level === 0, `expected level 0 at ${n}`)
    assert(h.active === false, `expected inactive at ${n}`)
    assert(h.flames === '', `expected no flames at ${n}`)
  }
})

test('streak 2-3 is warm', () => {
  for (const n of [2, 3]) {
    const h = comboHeat(n)
    assert(h.tier === 'warm', `expected warm at ${n}, got ${h.tier}`)
    assert(h.level === 1, `expected level 1 at ${n}`)
    assert(h.active === true, `expected active at ${n}`)
    assert(h.flames.length >= 1, `expected flames at ${n}`)
  }
})

test('streak 4-6 is hot', () => {
  for (const n of [4, 5, 6]) {
    const h = comboHeat(n)
    assert(h.tier === 'hot', `expected hot at ${n}, got ${h.tier}`)
    assert(h.level === 2, `expected level 2 at ${n}`)
  }
})

test('streak 7+ is blaze and caps at level 3', () => {
  for (const n of [7, 10, 99]) {
    const h = comboHeat(n)
    assert(h.tier === 'blaze', `expected blaze at ${n}, got ${h.tier}`)
    assert(h.level === 3, `expected level 3 at ${n}`)
  }
})

test('level rises monotonically with streak', () => {
  let prev = -1
  for (let n = 0; n <= 12; n++) {
    const lvl = comboHeat(n).level
    assert(lvl >= prev, `level dropped from ${prev} to ${lvl} at streak ${n}`)
    prev = lvl
  }
})

test('garbage / negative input is treated as cold', () => {
  for (const bad of [-5, NaN, undefined, null, 'x', 1.9]) {
    const h = comboHeat(bad)
    assert(h.tier === 'cold', `expected cold for ${String(bad)}, got ${h.tier}`)
  }
})

console.log('\nscorePopLabel — signed deltas')

test('positive delta formats as +N gain', () => {
  const r = scorePopLabel(12)
  assert(r.text === '+12', `expected +12, got ${r.text}`)
  assert(r.tone === 'gain', `expected gain, got ${r.tone}`)
})

test('negative delta keeps its minus and is a loss', () => {
  const r = scorePopLabel(-3)
  assert(r.text === '-3', `expected -3, got ${r.text}`)
  assert(r.tone === 'loss', `expected loss, got ${r.tone}`)
})

test('zero delta is suppressed', () => {
  const r = scorePopLabel(0)
  assert(r.text === '', `expected empty, got "${r.text}"`)
  assert(r.tone === 'none', `expected none, got ${r.tone}`)
})

test('fractional deltas round to whole points', () => {
  assert(scorePopLabel(12.4).text === '+12')
  assert(scorePopLabel(-2.6).text === '-3')
})

// ── Report ────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
