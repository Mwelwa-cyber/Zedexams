/**
 * Fraction arithmetic and the WORDS for a fraction — the layer below every
 * surface that draws one.
 *
 * These functions were in `features/games/lib/fractionLadderCore.js`, which is
 * where they were first needed. They moved down for one reason: the canonical
 * `<Frac>` renderer lives in `shared/components`, and a shared component may
 * not import a feature (`app → features → engines/curriculum →
 * shared/services/config`, enforced by `test:import-boundaries`). The renderer
 * needs the words — they are its accessible name — so the words have to be
 * reachable from below. `fractionLadderCore` re-exports them, so every existing
 * caller and every existing test still reads the same functions.
 *
 * THE WORDS ARE NOT DECORATION. A stacked fraction is two numbers in a column;
 * a screen reader handed that markup says "three four", which is not a
 * quantity. `fracWords(3, 4)` is the string that makes it "three quarters",
 * and it is generated from the same two numbers the digits are drawn from, so
 * the spoken form and the printed form cannot disagree.
 *
 * No React, no DOM.
 */

/* ── arithmetic ────────────────────────────────────────────────────── */

export function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) { const t = x % y; x = y; y = t }
  return x || 1
}

export function simplify(n, d) { const g = gcd(n, d); return [n / g, d / g] }

export function improperOf(whole, n, d) { return [whole * d + n, d] }

export function isLowest(n, d) { return gcd(n, d) === 1 }

/** `[whole, n, d]` — 11/4 becomes 2 and 3/4. A proper fraction keeps whole 0. */
export function mixedOf(n, d) {
  if (!d) return [0, n, d]
  return [Math.floor(n / d), n % d, d]
}

/** True when the two fractions are the same amount, however each is written. */
export function sameValue(a, b) {
  return Number(a?.n) * Number(b?.d) === Number(b?.n) * Number(a?.d)
}

/* ── the words ─────────────────────────────────────────────────────── */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// The irregular unit names. Everything not listed falls back to "<number>th",
// which is right for the denominators a learner meets after these.
const UNIT = {
  2: 'half', 3: 'third', 4: 'quarter', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth',
  10: 'tenth', 11: 'eleventh', 12: 'twelfth', 16: 'sixteenth', 20: 'twentieth', 25: 'twenty-fifth',
  50: 'fiftieth', 100: 'hundredth', 1000: 'thousandth',
}

export function numWord(n) {
  const value = Math.abs(Math.trunc(n))
  if (value < 20) return ONES[value]
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)]
    const rest = value % 10
    return rest ? `${tens}-${ONES[rest]}` : tens
  }
  if (value === 100) return 'one hundred'
  return String(value)
}

export function unitWord(d) { return UNIT[d] || `${numWord(d)}th` }

export function pluralUnit(d) { const u = unitWord(d); return u === 'half' ? 'halves' : `${u}s` }

/** "three quarters" — the string a screen reader gets instead of "3 4". */
export function fracWords(n, d) {
  if (d === 1) return numWord(n)
  return n === 1 ? `one ${unitWord(d)}` : `${numWord(n)} ${pluralUnit(d)}`
}

export function mixedWords(whole, n, d) {
  if (!whole) return fracWords(n, d)
  if (!n) return numWord(whole)
  return `${numWord(whole)} and ${fracWords(n, d)}`
}
