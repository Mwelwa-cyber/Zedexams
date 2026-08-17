// src/features/learnerHome/lib/guardianGateCore.js
//
// The Guardian Zone's adult check — the prototype's "What is 7 × 8?".
// Pure: no React, no DOM, tested under plain node by
// scripts/test-guardian-gate.mjs.
//
// This is a FRICTION gate and nothing more. It keeps a nine-year-old out
// of their parent's dashboard; it is not authentication, and no security
// property in the product rests on it (the controls behind it are
// enforced server-side and audited — see functions/guardianControls/).
// Saying that plainly here matters, because the one way a gate like this
// causes harm is by being mistaken for a real one later.
//
// Two deliberate choices:
//   • The question is generated, not the mockup's fixed 7 × 8. A constant
//     answer is learned once and then the gate is decoration.
//   • Both operands are ≥ 6 and the product is two digits, so it stays
//     out of the range a Grade-4 learner has memorised while remaining
//     something any adult does in their head.

/** Operand range: below 6 the tables are early-primary homework. */
const MIN = 6
const MAX = 12

/**
 * Build a question. `rng` returns [0,1) and is injectable so tests are
 * deterministic; the default is crypto-backed where available, because
 * Math.random in a loop is the kind of thing a scanner flags and there is
 * no reason to make it argue.
 */
export function buildGateQuestion(rng = defaultRng) {
  const pick = () => MIN + Math.floor(rng() * (MAX - MIN + 1))
  const a = pick()
  const b = pick()
  return { a, b, prompt: `What is ${a} × ${b}?`, answer: a * b }
}

function defaultRng() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {}
  const c = g.crypto
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    c.getRandomValues(buf)
    return buf[0] / 2 ** 32
  }
  return Math.random()
}

/**
 * Check a typed answer against a question.
 *
 * Accepts surrounding whitespace and nothing else: an empty box, a word,
 * a decimal or a half-typed number is wrong rather than an error, so the
 * gate never throws in front of a parent.
 */
export function checkGateAnswer(question, input) {
  if (!question || typeof question.answer !== 'number') return false
  const raw = String(input == null ? '' : input).trim()
  if (!/^\d+$/.test(raw)) return false
  return Number(raw) === question.answer
}

/**
 * How long a passed gate lasts, in ms. Short on purpose: the zone sits on
 * the child's own device, and a session that outlived the parent putting
 * the phone down would be a gate that only ever stopped them once.
 */
export const GATE_TTL_MS = 10 * 60 * 1000

/** Is a pass from `passedAt` still valid at `now`? */
export function gateStillValid(passedAt, now = Date.now()) {
  const at = Number(passedAt)
  if (!Number.isFinite(at) || at <= 0) return false
  // A clock that jumped backwards must not extend a pass indefinitely.
  if (at > now) return false
  return now - at < GATE_TTL_MS
}
