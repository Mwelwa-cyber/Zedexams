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

/**
 * Is an unhandled promise rejection, right now, evidence of THIS failure?
 *
 * The watchdog is a backstop, not a detector: it waits 30 s on a hinted device
 * before concluding anything, so a user who switched tabs during a cold start
 * sat on a loader for half a minute before the recovery reload fired. The
 * rejection itself is available immediately — Firebase's wedged init surfaces
 * as an unhandled rejection the moment the persistence write throws.
 *
 * What makes it usable is that the MESSAGE is not the evidence. Matching
 * `Database is closing/hidden` would bind us to one SDK version's wording, and
 * would go quietly dead the day Firebase rephrased it — the worst failure mode
 * available to a detector. The preconditions carry the meaning instead:
 *
 *   • hasHint        — this device had a live session, so there is a session to lose
 *   • authUnresolved — `onAuthStateChanged` has still not fired
 *   • hidDuringInit  — the page hid while initialisation was in flight, which
 *                      is the one and only way this failure is reached
 *
 * All three together are specific enough that ANY unhandled rejection in that
 * window is better explained by this bug than by anything else, and the cost of
 * being wrong is one reload — already bounded by the once-only guard, and taken
 * on a device that is sitting on a loading screen regardless.
 *
 * This does not replace the watchdog. A failure that produces no observable
 * rejection still needs the timeout, so both paths run and converge on the same
 * `decideAuthInitRecovery` call.
 */
export function shouldFastRecover({ hasHint, authUnresolved, hidDuringInit }) {
  return !!(hasHint && authUnresolved && hidDuringInit)
}

/* ── The session-rescue budget ───────────────────────────────────────────────
 *
 * `firebase/authSessionGuard` refuses the SDK's boot-time deletion of a session
 * the server never rejected, and `AuthContext` answers that by re-driving
 * initialisation — a reload, because the SDK exposes no other way to make it
 * read the blob again. That recovery needs a budget for the same reason the
 * wedge recovery does: a condition that outlives every attempt must end at
 * /login rather than in a reload loop.
 *
 * It needs its own budget, and that is the bug this section exists for. Both
 * recoveries used to share `AUTH_INIT_RECOVERY_KEY`, and they are triggered by
 * DIFFERENT failures:
 *
 *   • the wedge      — `onAuthStateChanged` never fires at all (PYTHON-K/N)
 *   • the boot check — it fires with `user === null` after a failed
 *                      verification the guard refused to act on (PYTHON-P)
 *
 * Sharing one single-use flag made them interfere in both directions. The worse
 * direction is the wedge's: it reloads WITHOUT `onAuthStateChanged` ever having
 * fired, and `clearRecoveryAttempted` is only ever called from inside that
 * callback — so the flag survives the reload, and the boot-check failure on the
 * next load reads someone else's spent attempt as its own. It is then denied
 * the rescue, falls through, and sets `authReady` with `currentUser === null`,
 * which every route guard correctly reads as signed out. The session blob is
 * still on disk and still valid; the user lands on /login anyway. sessionStorage
 * outlives a reload, so once a tab hit the wedge, every boot-check failure in
 * that tab was logged straight out with no attempt at all.
 *
 * Two keys, two budgets, no interference. Each is cleared only by an auth event
 * that actually settles, so neither can be spent on the other's failure.
 */

/** sessionStorage key holding how many rescue reloads this tab has spent. */
export const AUTH_SESSION_RESCUE_KEY = 'auth:sessionRescueAttempts'

/**
 * How long to wait before each re-drive of initialisation.
 *
 * A ladder rather than the single 1500 ms attempt this replaces, because the
 * causes `authBootVerdict` names — a project-wide 429, a 5xx, an attestation
 * refusal — routinely outlive a second and a half, and asking again inside the
 * same bad window mostly re-asks into it. Two rungs is the whole budget: ~7.5 s
 * of branded restoration screen against a spurious logout, and a hard stop
 * after it.
 */
export const SESSION_RESCUE_DELAYS_MS = Object.freeze([1500, 6000])

/**
 * How many rescue reloads has this tab already spent?
 *
 * Fails CLOSED, exactly as `readRecoveryAttempted` does: storage we cannot read
 * reports the budget EXHAUSTED, because an attempt we cannot count is an
 * attempt we cannot bound.
 */
export function readRescueAttempts(storage) {
  try {
    if (!storage) return SESSION_RESCUE_DELAYS_MS.length
    const raw = Number.parseInt(storage.getItem(AUTH_SESSION_RESCUE_KEY) ?? '0', 10)
    if (!Number.isFinite(raw) || raw < 0) return SESSION_RESCUE_DELAYS_MS.length
    return raw
  } catch {
    return SESSION_RESCUE_DELAYS_MS.length
  }
}

/**
 * Record that a rescue reload is about to happen.
 *
 * Returns whether it was durably stored — the caller must NOT reload on
 * `false`, for the same termination reason `markRecoveryAttempted` gives.
 */
export function recordRescueAttempt(storage, attempt) {
  try {
    if (!storage) return false
    storage.setItem(AUTH_SESSION_RESCUE_KEY, String(attempt))
    return true
  } catch {
    return false
  }
}

/** Return the budget to the tab once auth has actually settled. */
export function clearRescueAttempts(storage) {
  try {
    storage?.removeItem(AUTH_SESSION_RESCUE_KEY)
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

/**
 * Decide whether to re-drive initialisation again, and after how long.
 *
 * Pure so the budget is testable without a DOM: the whole termination argument
 * is that `attempt` only ever climbs, and is reset solely by an auth event that
 * settled — which requires a successful initialisation in between.
 *
 * @param {object} state
 * @param {number} state.attempts Rescue reloads already spent in this tab.
 * @returns {{action: 'reload'|'reveal', delayMs: number, attempt: number}}
 */
export function planSessionRescue({ attempts = 0 } = {}) {
  const spent = Number.isFinite(attempts) && attempts > 0 ? attempts : 0
  if (spent >= SESSION_RESCUE_DELAYS_MS.length) {
    return { action: REVEAL, delayMs: 0, attempt: spent }
  }
  return { action: RELOAD, delayMs: SESSION_RESCUE_DELAYS_MS[spent], attempt: spent + 1 }
}
