/**
 * usageReset — the single client-side source of truth for WHEN the daily
 * AI allowance resets (usage-card risk review, item 2).
 *
 * The server keys daily usage by UTC date (functions/teacherTools/
 * usageMeter.js yyyymmdd), so the allowance resets at 00:00 UTC — which is
 * ~02:00 in Zambia, NOT local midnight. Every surface that talks about the
 * daily reset must derive from these helpers so no page claims "midnight"
 * while another says "02:00". Pure and dependency-free (plain-node tested
 * in usageReset.test.js); timezone is injectable for deterministic tests
 * and defaults to the device timezone in the app.
 *
 * Backlog (subscription-system phase): have the backend return an explicit
 * `resetAt` timestamp with the meter so clients stop re-deriving the
 * boundary — and only then revisit whether the boundary itself should move
 * to Africa/Lusaka.
 */

/** The next daily-reset instant (next UTC midnight), as epoch ms. */
export function nextDailyResetMs(now = Date.now()) {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

/** Milliseconds until the next daily reset. Never negative. */
export function msUntilDailyReset(now = Date.now()) {
  return Math.max(0, nextDailyResetMs(now) - now)
}

/** "4h 07m" / "23m" countdown text for a millisecond duration. */
export function formatResetIn(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/**
 * The daily-reset instant as a local wall-clock time, e.g. "02:00" in
 * Zambia. `timeZone` is for tests; omit it in the app so the teacher sees
 * their own device's local time.
 */
export function formatResetClock(now = Date.now(), timeZone) {
  return new Date(nextDailyResetMs(now)).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  })
}
