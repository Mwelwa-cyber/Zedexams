// Deletion-in-flight state, shared by `accountService` (which starts a
// deletion) and `AuthContext` (which watches the profile document).
//
// Its own module because both sides need it and neither may import the other:
// AuthContext → accountService → AuthContext is a cycle, and the thing being
// shared is one boolean plus a callback list.
//
// Why it exists at all. The profile listener treats a missing `users/{uid}` as
// damage and repairs it by calling `bootstrapUserProfile`. That is correct for
// the case it was written for — a signup whose profile write did not land —
// and catastrophic during a deletion, where the document is missing because we
// deleted it on purpose. The server now closes that window from its side (the
// session is destroyed before Firestore is touched, and the callable refuses a
// uid with no Auth user or a purge tombstone). This is the client's half:
// cheap, local, and it keeps the repair path from ever being asked.

let inFlight = false
const startListeners = new Set()

/**
 * Register a callback to run when a deletion starts — used by AuthContext to
 * tear its profile listener down BEFORE the callable is invoked, rather than
 * racing the delete of `users/{uid}` that follows.
 *
 * @param {Function} fn
 * @returns {Function} unsubscribe
 */
export function onAccountDeletionStart(fn) {
  startListeners.add(fn)
  return () => startListeners.delete(fn)
}

/** Mark a deletion as in flight and notify listeners. */
export function beginAccountDeletion() {
  inFlight = true
  for (const fn of startListeners) {
    try { fn() } catch { /* a listener must not break the deletion */ }
  }
}

/** Clear the flag. Always call from a `finally` — a stuck flag disables genuine profile repair. */
export function endAccountDeletion() {
  inFlight = false
}

/** @returns {boolean} */
export function isAccountDeletionInFlight() {
  return inFlight
}
