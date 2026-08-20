/**
 * The exam clock. Server-anchored, and the on-screen countdown is cosmetic.
 *
 * §1: "The clock neither pauses nor rewinds. Time while the app was shut is
 * time spent. Resume recomputes from `expiresAt`; it never trusts a client
 * counter that a reload reset."
 *
 * That sentence is the whole module. `remainingSeconds` takes the attempt's
 * `expiresAt` and the current wall clock and subtracts — there is no
 * decrementing counter anywhere in the design, because a decrementing counter
 * is exactly the thing a reload resets and a backgrounded tab stops. The
 * ticking on screen re-reads this function every second; it does not own the
 * number.
 *
 * ── Why a skew correction and not just Date.now() ───────────────────────
 *
 * `expiresAt` is the SERVER's clock; `Date.now()` is a Zambian phone's, which
 * may be minutes out and is occasionally years out. Subtracting one from the
 * other directly hands that error straight to the learner — a 90-minute paper
 * that opens showing 47 minutes, or one that never expires. So `startAttempt`
 * returns the server's `now` alongside `expiresAt`, and the offset between it
 * and the device's clock at that moment is applied to every later reading. The
 * offset is measured once per attempt load rather than continuously, because
 * the thing being corrected is a fixed device error, not drift.
 *
 * Pure: no Date.now() is called without being passed in, which is also what
 * makes every case here testable rather than a race.
 */

/** Amber at 10 minutes, red at 5 — §2. */
export const WARN_SECONDS = 10 * 60
export const DANGER_SECONDS = 5 * 60

/**
 * The submission grace window (§5.3). A submission arriving after
 * `expiresAt + GRACE` is stored `expired` and scored on what arrived; a slow
 * phone must not lose a paper. The client uses the same number so its own
 * "time is up" auto-submit fires INSIDE the window the server will still
 * accept, rather than at the boundary the server is about to close.
 */
export const SUBMIT_GRACE_SECONDS = 20

/**
 * The offset to add to a device timestamp to read the server's clock.
 *
 * @param {number} serverNowMs  the server's `now`, as returned by startAttempt
 * @param {number} deviceNowMs  Date.now() sampled as close to it as possible
 * @returns {number} milliseconds; 0 when either reading is unusable, which
 *   makes an unmeasurable skew a no-op rather than a fabricated correction.
 */
export function clockOffset(serverNowMs, deviceNowMs) {
  const s = Number(serverNowMs)
  const d = Number(deviceNowMs)
  if (!Number.isFinite(s) || !Number.isFinite(d) || s <= 0 || d <= 0) return 0
  return s - d
}

/**
 * Seconds left on an attempt. Never negative, never NaN.
 *
 * @param {object} args
 * @param {number} args.expiresAtMs  the attempt's server expiry
 * @param {number} args.nowMs        Date.now()
 * @param {number} [args.offsetMs]   clockOffset(), applied to nowMs
 * @returns {number} whole seconds, floored at 0
 */
export function remainingSeconds({ expiresAtMs, nowMs, offsetMs = 0 }) {
  const expires = Number(expiresAtMs)
  const now = Number(nowMs)
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return 0
  const ms = expires - (now + (Number(offsetMs) || 0))
  return ms <= 0 ? 0 : Math.floor(ms / 1000)
}

/**
 * How the timer pill reads. Grey → amber → red; never a full-screen alarm.
 * Separated from the number so the pill's tone and the number cannot describe
 * different amounts of time.
 */
export function timerTone(secondsLeft) {
  const s = Number(secondsLeft)
  if (!Number.isFinite(s) || s > WARN_SECONDS) return 'calm'
  if (s > DANGER_SECONDS) return 'warn'
  return 'danger'
}

/** M:SS — the runner's pill. */
export function formatClock(secondsLeft) {
  const s = Math.max(0, Math.floor(Number(secondsLeft) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * "1h 12m" / "12m 30s" — prose for a sheet, where "72:30" reads as a stopwatch
 * rather than as an amount of time a child still has.
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * Is this attempt over? Distinct from `remainingSeconds() === 0` by the grace
 * window: the clock reads zero to the learner while the server is still
 * accepting, which is what stops the auto-submit racing its own deadline.
 */
export function isExpired({ expiresAtMs, nowMs, offsetMs = 0, graceSeconds = SUBMIT_GRACE_SECONDS }) {
  const expires = Number(expiresAtMs)
  const now = Number(nowMs)
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return false
  return (now + (Number(offsetMs) || 0)) > expires + graceSeconds * 1000
}

/**
 * How long the attempt actually took, for the results screen.
 *
 * Prefers the two server timestamps. Falls back to the paper's duration minus
 * whatever was left — never to a client stopwatch, which a reload zeroes.
 * Returns null rather than 0 when neither is available: "0m 00s" is a claim,
 * and a results screen with nothing to say about time should say nothing.
 */
export function timeUsedSeconds({ startedAtMs, submittedAtMs, durationMin, secondsLeft }) {
  const start = Number(startedAtMs)
  const end = Number(submittedAtMs)
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return Math.floor((end - start) / 1000)
  }
  const total = Number(durationMin)
  const left = Number(secondsLeft)
  if (Number.isFinite(total) && total > 0 && Number.isFinite(left)) {
    return Math.max(0, total * 60 - left)
  }
  return null
}
