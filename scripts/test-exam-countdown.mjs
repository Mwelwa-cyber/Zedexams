/**
 * The countdown arithmetic and the auto-submit latch.
 *
 * These are the two rules a timed assessment cannot get wrong: the clock must
 * be derived from the deadline (so backgrounding the tab or refreshing cannot
 * hand the learner extra time), and the submit must fire exactly once (so an
 * expiry racing a manual submit cannot write the attempt twice).
 */
import assert from 'node:assert/strict'
import { remainingSeconds, createOneShot } from '../src/shared/utils/examCountdownCore.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`) }

// ── remainingSeconds ─────────────────────────────────────────────────────────

test('counts whole seconds down to a deadline', () => {
  const end = 1_000_000
  assert.equal(remainingSeconds(end, end - 30_000), 30)
  assert.equal(remainingSeconds(end, end - 1_000), 1)
})

test('floors at zero rather than going negative', () => {
  const end = 1_000_000
  assert.equal(remainingSeconds(end, end), 0)
  assert.equal(remainingSeconds(end, end + 60_000), 0)
})

test('rounds to the nearest second, so the display never lags a full beat', () => {
  const end = 1_000_000
  assert.equal(remainingSeconds(end, end - 30_400), 30) // 30.4s → 30
  assert.equal(remainingSeconds(end, end - 30_600), 31) // 30.6s → 31
})

test('an absent or non-numeric deadline reads as expired, never as infinite time', () => {
  assert.equal(remainingSeconds(null, Date.now()), 0)
  assert.equal(remainingSeconds(undefined, Date.now()), 0)
  assert.equal(remainingSeconds(NaN, Date.now()), 0)
  assert.equal(remainingSeconds('soon', Date.now()), 0)
})

test('time is re-derived, never decremented — a paused clock cannot gain time', () => {
  // Simulates a tab backgrounded for 20 minutes: a decrementing counter would
  // still show the seconds it had when it was suspended.
  const end = Date.now() + 60_000
  const before = remainingSeconds(end, Date.now())
  const afterSleep = remainingSeconds(end, Date.now() + 20 * 60_000)
  assert.equal(before, 60)
  assert.equal(afterSleep, 0)
})

// ── createOneShot ────────────────────────────────────────────────────────────

test('the latch runs its action exactly once', () => {
  const latch = createOneShot()
  let calls = 0
  assert.equal(latch.claim(() => { calls++ }), true)
  assert.equal(latch.claim(() => { calls++ }), false)
  assert.equal(latch.claim(() => { calls++ }), false)
  assert.equal(calls, 1)
})

test('a timer expiry and a manual submit racing each other submit once', () => {
  const latch = createOneShot()
  const submits = []
  latch.claim(() => submits.push('manual'))
  latch.claim(() => submits.push('timer-expiry'))
  assert.deepEqual(submits, ['manual'])
})

test('claimed() reports the latch state without consuming it', () => {
  const latch = createOneShot()
  assert.equal(latch.claimed(), false)
  latch.claim(() => {})
  assert.equal(latch.claimed(), true)
})

test('claiming with no action still latches', () => {
  const latch = createOneShot()
  assert.equal(latch.claim(), true)
  let ran = false
  assert.equal(latch.claim(() => { ran = true }), false)
  assert.equal(ran, false)
})

console.log(`\nexam countdown: ${n} checks passed`)
