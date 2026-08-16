/* Pure timing decisions for the loading-delay gate (see useDelayedFlag).
 *
 * Kept DOM-free and clock-free — `now` is passed in — so the two behaviours
 * that matter can be asserted directly rather than inferred from a rendered
 * component under fake timers.
 *
 * The two behaviours:
 *
 *   1. Don't show a loader for the first `delay` ms. Most route transitions in
 *      the app finish faster than that, so a loader rendered immediately is a
 *      flash that appears and vanishes — which is what makes a brief wait feel
 *      busy. Below the threshold the user correctly sees nothing at all.
 *
 *   2. Once shown, hold it for at least `minVisible` ms. Without this, gating
 *      on (1) alone just moves the flash later: a loader that appears at 199ms
 *      and disappears at 210ms is worse than either extreme.
 */

export const DEFAULT_DELAY_MS = 200
export const DEFAULT_MIN_VISIBLE_MS = 400

/**
 * @param {object}  input
 * @param {boolean} input.active      Is the underlying operation in flight?
 * @param {boolean} input.visible     Is the loader on screen right now?
 * @param {number}  input.now         Current time (ms epoch).
 * @param {number}  input.shownAt     When the loader became visible (ms epoch).
 * @param {number} [input.delay]      Hold-off before showing.
 * @param {number} [input.minVisible] Floor on how long it stays once shown.
 * @returns {{ action: 'show'|'hide'|'none', waitMs: number }}
 */
export function resolveDelayedFlag({
  active,
  visible,
  now,
  shownAt,
  delay = DEFAULT_DELAY_MS,
  minVisible = DEFAULT_MIN_VISIBLE_MS,
}) {
  // Coerce BOTH sides: `visible` is React state and always a real boolean, but
  // `active` is caller-supplied and routinely truthy-but-not-true (an in-flight
  // promise, a stage string). A strict compare would read those as a change on
  // every call and re-arm the timer forever.
  if (Boolean(active) === Boolean(visible)) return { action: 'none', waitMs: 0 }

  if (active) return { action: 'show', waitMs: Math.max(0, delay) }

  // Guard the shownAt arithmetic: a non-finite stamp (never set, or a clock
  // that jumped) must not resolve to NaN, which would schedule a timer that
  // never fires and strand the loader on screen forever.
  const elapsed = Number.isFinite(shownAt) && Number.isFinite(now) ? now - shownAt : minVisible
  return { action: 'hide', waitMs: Math.max(0, minVisible - Math.max(0, elapsed)) }
}
