/**
 * Tests for the Zed Market Challenge game core
 * (src/features/games/lib/marketChallengeCore.js).
 *
 * Run: node scripts/test-market-challenge.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  CATALOG,
  DIFFICULTY_CONFIGS,
  configForGame,
  customerLine,
  formatKwacha,
  generateCustomer,
  makeChange,
} from '../src/features/games/lib/marketChallengeCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

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

/* ── formatKwacha (amounts in ngwee) ─────────────────────────── */

assert(formatKwacha(2200) === 'K22', 'K22 formats without decimals')
assert(formatKwacha(750) === 'K7.50', 'K7.50 keeps the ngwee part')
assert(formatKwacha(105) === 'K1.05', 'K1.05 pads ngwee to two digits')
assert(formatKwacha(50) === '50n', 'sub-Kwacha amounts show as ngwee')
assert(formatKwacha(100) === 'K1', 'exactly one Kwacha')
assert(formatKwacha(0) === '0n', 'zero is harmless')

/* ── makeChange (greedy over canonical ZMW denominations) ────── */

const tray = DIFFICULTY_CONFIGS.hard.tray
assert(makeChange(800, tray).join(',') === '500,200,100', 'K8 = K5+K2+K1')
assert(makeChange(50, tray).join(',') === '50', '50n = one coin')
assert(makeChange(2850, tray).join(',') === '2000,500,200,100,50', 'K28.50 greedy breakdown')
assert(makeChange(0, tray).length === 0, 'zero change = empty')
assert(makeChange(75, tray) === null, 'unmakeable amount returns null')
assert(
  makeChange(300, DIFFICULTY_CONFIGS.easy.tray).reduce((a, b) => a + b, 0) === 300,
  'change always sums back to the amount',
)

/* ── configForGame ───────────────────────────────────────────── */

assert(configForGame({ difficulty: 'easy' }) === DIFFICULTY_CONFIGS.easy, 'explicit difficulty wins')
assert(configForGame({ grade: 3 }) === DIFFICULTY_CONFIGS.easy, 'grade 3 → easy')
assert(configForGame({ grade: 5 }) === DIFFICULTY_CONFIGS.medium, 'grade 5 → medium')
assert(configForGame({ grade: 7 }) === DIFFICULTY_CONFIGS.hard, 'grade 7 → hard')

/* ── generateCustomer: every customer must be solvable ───────── */

for (const [name, cfg] of Object.entries(DIFFICULTY_CONFIGS)) {
  const rand = mulberry32(99)
  for (let i = 0; i < 500; i++) {
    const c = generateCustomer(cfg, rand)
    const label = `${name} #${i}`
    assert(c.items.length >= cfg.itemsMin && c.items.length <= cfg.itemsMax, `${label}: item count in range`)
    const names = new Set(c.items.map((it) => it.name))
    assert(names.size === c.items.length, `${label}: no duplicate items`)
    for (const item of c.items) {
      assert(item.price >= cfg.priceMin && item.price <= cfg.priceMax, `${label}: price in range`)
      assert((item.price - cfg.priceMin) % cfg.priceStep === 0, `${label}: price on the step grid`)
      assert(CATALOG.some((cat) => cat.name === item.name), `${label}: item from the catalogue`)
    }
    assert(c.total === c.items.reduce((s, it) => s + it.price, 0), `${label}: total adds up`)
    assert(c.payment > c.total, `${label}: payment covers the total`)
    assert(c.change === c.payment - c.total, `${label}: change is payment minus total`)
    assert(c.change > 0, `${label}: change is never zero`)
    const breakdown = makeChange(c.change, cfg.tray)
    assert(breakdown !== null, `${label}: change ${c.change} payable from the tray`)
    assert(breakdown.reduce((a, b) => a + b, 0) === c.change, `${label}: breakdown sums to the change`)
  }
}

/* ── degenerate RNG falls back, never hangs ──────────────────── */

for (const cfg of Object.values(DIFFICULTY_CONFIGS)) {
  const c = generateCustomer(cfg, () => 0)
  assert(c.payment > c.total && c.change > 0, 'degenerate rng still yields a solvable customer')
}

/* ── customerLine ────────────────────────────────────────────── */

const line = customerLine({
  items: [{ name: 'Bread' }, { name: 'Milk' }],
  payment: 3000,
})
assert(line === 'I want bread and milk. Here is K30.', `two-item line reads naturally (got "${line}")`)
const single = customerLine({ items: [{ name: 'An exercise book' }], payment: 2000 })
assert(single === 'I want exercise book. Here is K20.', `article stripped from item name (got "${single}")`)
const triple = customerLine({
  items: [{ name: 'Bread' }, { name: 'Eggs' }, { name: 'Sugar' }],
  payment: 5000,
})
assert(triple === 'I want bread, eggs and sugar. Here is K50.', `three-item line uses commas (got "${triple}")`)

console.log(`market-challenge core: ${passed} assertions passed ✓`)
