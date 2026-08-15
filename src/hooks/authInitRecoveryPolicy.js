/**
 * What the session-restoration watchdog should do when Firebase Auth never
 * emits its first `onAuthStateChanged` event.
 *
 * ## The failure this exists for
 *
 * Firebase Auth's IndexedDB persistence closes its database whenever the page
 * hides, and it treats that as terminal:
 *
 *   onVisibilityChange → visibilityState === 'hidden' → onPageHide()
 *                      → isHiding = true, dbPromise.close()
 *   _openDb()          → if (isHiding) throw Error('Database is closing/hidden')
 *   _withRetries()     → catch (e) { if (this.isHiding) throw e }   // no retry
 *
 * (@firebase/auth 1.13.4, `IndexedDBLocalPersistence`.) Note the trigger is
 * `visibilitychange`, NOT unload — switching tabs, minimising the window, or
 * the screen locking is enough.
 *
 * Auth initialisation writes to that database. `initializeCurrentUser()` reloads
 * the persisted user over the network, and on any non-`auth/network-request-failed`
 * error clears it via `removeCurrentUser()` → `_openDb()`. If the tab hides while
 * that write is in flight, the write throws, `_initializationPromise` rejects, and
 * `_isInitialized` is never set. From there Firebase is permanently wedged:
 *
 *   registerStateListener() {
 *     const promise = this._isInitialized ? Promise.resolve() : this._initializationPromise
 *     promise.then(() => cb(this.currentUser))    // ← no .catch, no error path
 *   }
 *   notifyAuthListeners() { if (!this._isInitialized) return }   // ← permanent no-op
 *
 * So `onAuthStateChanged` never fires — not with a user, not with null — and
 * nothing re-runs initialisation. `authStateReady()` is built on the same
 * listener, so it never settles either; there is no SDK-side signal to observe.
 * The only trace is the rejected floating promise surfacing as an unhandled
 * rejection (Sentry PYTHON-K, `Error: Database is closing/hidden`).
 *
 * ## Why the watchdog is the right place to fix it
 *
 * The watchdog's old behaviour was `setLoading(false)`, which leaves
 * `loading === false && currentUser === null` — and `ProtectedRoute` reads that
 * pair as "genuinely signed out" and redirects to /login. A user with a
 * perfectly valid session gets logged out, which is the "refreshing logs me
 * out" bug AuthContext's own watchdog comment calls catastrophic.
 *
 * `AUTH_HINT_KEY` is what separates the two cases: a device that is KNOWN to
 * have had a session did not just become anonymous, so a timeout there means
 * initialisation FAILED rather than resolved. Recovery is a reload, because
 * `_initializationPromise` stays rejected for the life of the page and the SDK
 * exposes no way to re-drive it.
 *
 * ## Termination
 *
 * A reload that fails the same way must not reload again. The attempt is
 * recorded in sessionStorage first, and every uncertainty resolves AWAY from
 * reloading — unreadable storage, unwritable storage, or an attempt already on
 * record all fall through to `REVEAL`. Landing on /login is a bad outcome; an
 * unbounded reload loop is a much worse one.
 */

/** sessionStorage key recording that this tab already spent its one reload. */
export const AUTH_INIT_RECOVERY_KEY = 'auth:initRecoveryAttempted'

/** Drop the loading gate and let the app render as signed-out (the old behaviour). */
export const REVEAL = 'reveal'
/** Reload now to re-drive Firebase Auth initialisation from scratch. */
export const RELOAD = 'reload'
/** Hold the loader and wait for the page to become visible before reloading. */
export const DEFER = 'defer'

/**
 * Decide what to do when the watchdog fires without an auth event.
 *
 * @param {object}  state
 * @param {boolean} state.hasHint           This device is known to have had a session.
 * @param {boolean} state.recoveryAttempted A recovery reload was already spent.
 * @param {boolean} state.documentHidden    The page is currently hidden.
 * @returns {'reveal'|'reload'|'defer'}
 */
export function decideAuthInitRecovery({ hasHint, recoveryAttempted, documentHidden }) {
  // No hint: a genuinely signed-out visitor whose auth resolved slowly. There
  // is no session to rescue, and revealing the public pages is correct.
  if (!hasHint) return REVEAL
  // Already spent the one reload and still no auth event. Whatever is wrong is
  // not the hide-during-init race, so stop and let the app render.
  if (recoveryAttempted) return REVEAL
  // Reloading a hidden tab re-runs initialisation under background throttling —
  // and, since hiding is what breaks it, re-runs it in exactly the conditions
  // that caused the failure. Hold the loader (nobody is looking at a hidden
  // tab) and recover the moment the user comes back.
  if (documentHidden) return DEFER
  return RELOAD
}

/**
 * Has this tab already spent its recovery reload?
 *
 * Fails CLOSED: if sessionStorage cannot be read (private mode, disabled
 * storage, a cross-origin sandbox) we report `true`, because a reload we
 * cannot record is a reload we cannot guarantee will only happen once.
 */
export function readRecoveryAttempted(storage) {
  try {
    if (!storage) return true
    return storage.getItem(AUTH_INIT_RECOVERY_KEY) === '1'
  } catch {
    return true
  }
}

/**
 * Record the recovery attempt. Returns whether it was durably stored — the
 * caller must NOT reload on `false`, for the termination reason above.
 */
export function markRecoveryAttempted(storage) {
  try {
    if (!storage) return false
    storage.setItem(AUTH_INIT_RECOVERY_KEY, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Forget the attempt once auth has actually spoken. Scoped to the failure
 * episode rather than to the tab: a session that recovers and then hits the
 * race again hours later deserves the same one reload, and cannot loop because
 * each cycle requires a successful initialisation in between.
 */
export function clearRecoveryAttempted(storage) {
  try {
    storage?.removeItem(AUTH_INIT_RECOVERY_KEY)
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}
