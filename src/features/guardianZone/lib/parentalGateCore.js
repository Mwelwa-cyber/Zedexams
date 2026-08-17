/**
 * The parental gate's arithmetic — pure, so the question and the answer can be
 * tested without a DOM and without a clock.
 *
 * ── What this gate is, and what it is emphatically not ───────────────────
 *
 * It asks "what is 7 × 8" before the Guardian Zone opens. A twelve year old
 * can multiply, so this is FRICTION, not authentication: it stops a child
 * wandering into a parent's area by accident or idly, and it stops nothing
 * else. Everything that actually matters — every control a guardian sets — is
 * verified server-side against a PIN whose setup code goes to the guardian's
 * own inbox (functions/guardianZone/).
 *
 * Saying that plainly here matters, because the failure mode of an
 * industry-standard parental gate is that the next person to read the code
 * assumes it is a lock and puts something behind it that needs one.
 *
 * ── Why two-digit multiplication and not "type 1993" ─────────────────────
 *
 * A year-of-birth prompt is answerable by any child who knows their parent's
 * age, and by every child who has watched one typed. Multiplication in the
 * 6–12 range is above the Grade 7 mental-arithmetic band this app teaches but
 * trivial for an adult — the widest gap available without making the gate
 * annoying for the parent, who is the person we actually want through it.
 */

// Deliberately excludes 1, 2, 5 and 10 on both sides: those products are the
// ones a Grade 7 learner has memorised.
const FACTORS = Object.freeze([3, 4, 6, 7, 8, 9, 11, 12])

/**
 * Draw a challenge.
 *
 * @param {() => number} [rng]  injected in tests; defaults to crypto-backed.
 * @return {{a: number, b: number, answer: number, prompt: string}}
 */
export function makeGateChallenge(rng = defaultRng) {
  const a = FACTORS[Math.floor(rng() * FACTORS.length)]
  const b = FACTORS[Math.floor(rng() * FACTORS.length)]
  return { a, b, answer: a * b, prompt: `What is ${a} × ${b}?` }
}

/**
 * Check a typed answer.
 *
 * Tolerant of whitespace and of a stray comma, because a wrong-looking
 * rejection of a right answer is how a parent concludes the app is broken.
 * Not tolerant of an empty string, which would otherwise parse to NaN and
 * compare false by accident rather than by decision.
 */
export function checkGateAnswer(input, challenge) {
  const raw = String(input ?? '').trim().replace(/[\s,]/g, '')
  if (!/^\d{1,4}$/.test(raw)) return false
  return Number(raw) === Number(challenge?.answer)
}

/**
 * The default random source: crypto-backed uniform [0, 1).
 *
 * Same choice as the duel's rng and for the same reason — the draw is not a
 * secret, but writing `Math.random` next to the word "gate" teaches the wrong
 * habit, and `crypto.getRandomValues` costs nothing here.
 */
function defaultRng() {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0] / 4294967296
}

/**
 * Format a daily time limit for display.
 *
 * `null` is "no limit" and must read as a sentence rather than as a blank —
 * a row showing nothing next to "Daily time limit" reads as a value that
 * failed to load.
 */
export function formatDailyLimit(minutes) {
  if (minutes === null || minutes === undefined) return 'No limit'
  const n = Number(minutes)
  if (!Number.isFinite(n) || n <= 0) return 'No limit'
  const h = Math.floor(n / 60)
  const m = n % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}
