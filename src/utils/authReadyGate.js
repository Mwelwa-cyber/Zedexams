/**
 * A module-level mirror of `AuthContext`'s `authReady`, for the code that
 * cannot read React context.
 *
 * ## Why this exists
 *
 * The Firestore read path (`src/hooks/firestore/*`) is plain functions. They are
 * called from hooks that already gate on a uid, which looks sufficient and is
 * not: `useBadges(userId)` fires the moment a uid exists, and a uid exists
 * before the ID token is attached to outgoing requests. A query issued in that
 * window is rejected by the rules with `Missing or insufficient permissions`,
 * and because every getter degrades to `[]` the UI shows an empty state rather
 * than an error — the failure is invisible except in the reporter. That is the
 * `firestore.getUserResults` noise logged against the `/login` route: the read
 * was issued on a learner screen, the guard then bounced to /login, and the
 * rejection landed after the navigation, so the route on the event names where
 * the user ended up rather than where the query came from.
 *
 * Gating on the uid alone cannot fix that, because the uid is not the thing
 * that was missing. Waiting for auth to RESOLVE is.
 *
 * ## Why a module singleton and not a hook
 *
 * A hook would fix the callers that remember to use it. This sits under every
 * caller, including the ones that pass a uid down through three components, so
 * a new learner surface gets the guarantee without knowing the guarantee
 * exists.
 *
 * ## Bounded, never blocking
 *
 * `whenAuthReady` resolves — it never rejects and never waits forever. If auth
 * genuinely wedges, the caller gets `false` after the timeout and decides for
 * itself; a read path that hung would turn a recoverable auth failure into a
 * permanently blank screen, which is a worse outcome than a denied query.
 */

/** How long a read will wait for auth before giving up and answering honestly. */
export const AUTH_READY_WAIT_MS = 15_000

let ready = false
let waiters = []

/** Has Firebase Auth emitted its first state? */
export function isAuthReady() {
  return ready
}

/**
 * Called from `AuthContext`'s `onAuthStateChanged` — and from nowhere else, for
 * the same reason `authReady` itself has one setter.
 */
export function markAuthReady() {
  if (ready) return
  ready = true
  const pending = waiters
  waiters = []
  for (const resolve of pending) {
    try { resolve(true) } catch { /* a waiter that throws must not strand the rest */ }
  }
}

/**
 * Reset to unresolved. Used when the provider remounts (and by tests) so a
 * second mount does not inherit the first one's answer.
 */
export function markAuthUnresolved() {
  ready = false
  waiters = []
}

/**
 * Resolve once auth has spoken, or `false` if it has not within `timeoutMs`.
 *
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export function whenAuthReady({ timeoutMs = AUTH_READY_WAIT_MS } = {}) {
  if (ready) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    // Deliberately NOT unref'd. An unref'd timer does not hold the event loop
    // open, so under node it can simply never fire — which turns the one
    // guarantee this function makes ("you always get an answer") into "you get
    // an answer if something else happens to be running". The timer is cleared
    // the moment auth resolves, so the cost of holding it is bounded by
    // `timeoutMs` and only paid while a read is genuinely waiting.
    const timer = setTimeout(() => done(false), timeoutMs)
    waiters.push(() => done(true))
  })
}
