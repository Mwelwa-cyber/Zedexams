/**
 * Pure logic for the `market_challenge` game engine (Zed Market Challenge).
 *
 * Plain .js module (no React) so it can be unit-tested from plain Node
 * scripts — same pattern as the other game cores.
 *
 * The game: customers come to a Zambian market stall, ask for a few items,
 * and hand over money. The player works out the total and gives the right
 * CHANGE by tapping Kwacha notes and coins from a tray. The arithmetic is
 * hidden inside the transaction — no questions, no answer options.
 *
 * All money is held in NGWEE integers (K1 = 100n) so there is never any
 * floating-point drift. Customers are generated procedurally and by
 * construction: payment > total, change > 0, and the change is always
 * payable from the tray denominations.
 */

/** Stall catalogue. Prices are picked per-difficulty at generation time. */
export const CATALOG = [
  { name: 'Bread', emoji: '🍞' },
  { name: 'Milk', emoji: '🥛' },
  { name: 'Tomatoes', emoji: '🍅' },
  { name: 'Bananas', emoji: '🍌' },
  { name: 'Apples', emoji: '🍎' },
  { name: 'Eggs', emoji: '🥚' },
  { name: 'A drink', emoji: '🧃' },
  { name: 'Sugar', emoji: '🥄' },
  { name: 'Soap', emoji: '🧼' },
  { name: 'A pencil', emoji: '✏️' },
  { name: 'An exercise book', emoji: '📓' },
  { name: 'Biscuits', emoji: '🍪' },
  { name: 'Sweets', emoji: '🍬' },
  { name: 'Rice', emoji: '🍚' },
]

const K = 100 // ngwee per Kwacha

export const DIFFICULTY_CONFIGS = {
  easy: {
    customers: 6,
    itemsMin: 1,
    itemsMax: 2,
    priceMin: 1 * K,
    priceMax: 9 * K,
    priceStep: 1 * K,           // whole-Kwacha prices
    paymentNotes: [20 * K, 10 * K, 5 * K],
    tray: [10 * K, 5 * K, 2 * K, 1 * K],
    hints: 3,
  },
  medium: {
    customers: 8,
    itemsMin: 2,
    itemsMax: 2,
    priceMin: 2 * K,
    priceMax: 18 * K,
    priceStep: 1 * K,
    paymentNotes: [50 * K, 20 * K, 10 * K],
    tray: [20 * K, 10 * K, 5 * K, 2 * K, 1 * K],
    hints: 2,
  },
  hard: {
    customers: 8,
    itemsMin: 2,
    itemsMax: 3,
    priceMin: 2 * K + 50,
    priceMax: 30 * K,
    priceStep: 50,              // prices in 50n steps → ngwee change
    paymentNotes: [100 * K, 50 * K, 20 * K],
    tray: [50 * K, 20 * K, 10 * K, 5 * K, 2 * K, 1 * K, 50],
    hints: 2,
  },
}

export function configForGame(game) {
  const byDifficulty = DIFFICULTY_CONFIGS[String(game?.difficulty || '').toLowerCase()]
  if (byDifficulty) return byDifficulty
  const grade = Number(game?.grade) || 0
  if (grade <= 3) return DIFFICULTY_CONFIGS.easy
  if (grade <= 5) return DIFFICULTY_CONFIGS.medium
  return DIFFICULTY_CONFIGS.hard
}

/** "K22", "K7.50", "50n" — Kwacha display for an ngwee amount. */
export function formatKwacha(ngwee) {
  const n = Math.round(Number(ngwee) || 0)
  if (n < K) return `${n}n`
  const kw = Math.floor(n / K)
  const rest = n % K
  return rest === 0 ? `K${kw}` : `K${kw}.${String(rest).padStart(2, '0')}`
}

/**
 * Greedy change-maker. Zambian denominations are canonical, so greedy is
 * exact whenever the amount is a multiple of the smallest tray value.
 * Returns the denomination list (largest first) or null if not makeable.
 */
export function makeChange(amount, tray) {
  let left = amount
  const out = []
  const denoms = [...tray].sort((a, b) => b - a)
  for (const d of denoms) {
    while (left >= d) {
      left -= d
      out.push(d)
    }
  }
  return left === 0 ? out : null
}

function defaultRandom() {
  return Math.random()
}

function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1))
}

function pickPrice(cfg, rand) {
  const steps = Math.floor((cfg.priceMax - cfg.priceMin) / cfg.priceStep)
  return cfg.priceMin + randInt(rand, 0, steps) * cfg.priceStep
}

/**
 * Build one solvable customer. By construction: payment > total (so change
 * is never zero), and change is a multiple of the smallest tray value.
 */
export function generateCustomer(cfg, rand = defaultRandom) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const count = randInt(rand, cfg.itemsMin, cfg.itemsMax)
    const picks = []
    const used = new Set()
    for (let guard = 0; picks.length < count && guard < 100; guard++) {
      const idx = randInt(rand, 0, CATALOG.length - 1)
      if (used.has(idx)) continue
      used.add(idx)
      picks.push({ ...CATALOG[idx], price: pickPrice(cfg, rand) })
    }
    // Top up sequentially if the RNG was degenerate — keeps the function
    // total for any injected `rand`.
    for (let idx = 0; picks.length < count; idx++) {
      if (used.has(idx)) continue
      used.add(idx)
      picks.push({ ...CATALOG[idx], price: pickPrice(cfg, rand) })
    }
    const total = picks.reduce((sum, item) => sum + item.price, 0)

    // Payment: the smallest single note (or pair of the biggest note plus
    // one more) that strictly covers the total.
    const notes = [...cfg.paymentNotes].sort((a, b) => a - b)
    let payment = notes.find((n) => n > total) ?? null
    if (payment === null) {
      const big = notes[notes.length - 1]
      const extra = notes.find((n) => big + n > total)
      payment = extra != null ? big + extra : null
    }
    if (payment === null) continue

    const change = payment - total
    const smallest = Math.min(...cfg.tray)
    if (change <= 0 || change % smallest !== 0) continue
    if (!makeChange(change, cfg.tray)) continue

    return { items: picks, total, payment, change }
  }

  // Hand-checked fallback — generation failing 60 times should not happen,
  // but the game must never fail to start.
  const bread = { ...CATALOG[0], price: 4 * K }
  const milk = { ...CATALOG[1], price: 3 * K }
  return { items: [bread, milk], total: 7 * K, payment: 10 * K, change: 3 * K }
}

/** What the customer says, e.g. "I want bread and milk. Here is K30." */
export function customerLine(customer) {
  const names = customer.items.map((i) => i.name.toLowerCase().replace(/^(a|an)\s+/, ''))
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `I want ${list}. Here is ${formatKwacha(customer.payment)}.`
}
