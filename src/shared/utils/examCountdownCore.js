/**
 * The arithmetic behind a timed assessment's countdown, with no React and no
 * clock of its own.
 *
 * ## Why this is a module and not four lines inside a component
 *
 * The rule it encodes is a correctness rule, not a display rule: the remaining
 * time is always RE-DERIVED from a fixed deadline and is never decremented.
 * A decremented counter gains time whenever the tab is backgrounded, the
 * device sleeps or the page is refreshed — which on an exam is the learner
 * getting more time than the paper allows. Both timed runners already knew
 * that and both implemented it separately; keeping the arithmetic here means
 * the next timed surface inherits the rule instead of re-deriving it.
 */

/**
 * Whole seconds left before `endTime`, floored at zero.
 *
 * Rounds rather than floors so the displayed second never sits half a beat
 * behind the true remaining time — the runners tick at 500 ms precisely so
 * that this rounding lands on the right second.
 *
 * @param {number|null|undefined} endTime  Unix ms deadline
 * @param {number} now                     Unix ms, injected so this stays pure
 * @returns {number} seconds remaining, >= 0
 */
export function remainingSeconds(endTime, now) {
  if (!Number.isFinite(endTime)) return 0
  return Math.max(0, Math.round((endTime - now) / 1000))
}

/**
 * A one-shot latch.
 *
 * Both runners auto-submit when the clock reaches zero, and both have a SECOND
 * path that can reach the same submit first — the quiz runner resumes a session
 * whose deadline already passed, and the daily exam submits by hand. The two
 * paths must never both fire: a double submit writes the attempt twice.
 *
 * Modelling that as a latch rather than a boolean ref means the guard and the
 * action cannot drift apart — you cannot claim the latch and then forget to
 * run the action, or run the action without claiming.
 *
 * @returns {{ claim(fn?: Function): boolean, claimed(): boolean }}
 */
export function createOneShot() {
  let taken = false
  return {
    /** Run `fn` and return true the first time only; a no-op afterwards. */
    claim(fn) {
      if (taken) return false
      taken = true
      fn?.()
      return true
    },
    claimed() { return taken },
  }
}
