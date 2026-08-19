/**
 * "This device has a signed-in user" — the one-bit hint the app drops on
 * sign-in and clears on sign-out.
 *
 * Firebase restores the auth session from IndexedDB asynchronously, so for the
 * first frames of a cold start `auth.currentUser` is null even for a returning
 * user. The hint is what lets the router tell a returning learner (show the
 * restoration loader) apart from a genuinely signed-out visitor (show the
 * marketing page immediately, no spinner) SYNCHRONOUSLY, on the very first
 * render. localStorage, not sessionStorage, so it survives the app being fully
 * closed and reopened.
 *
 * It lives here rather than in `contexts/AuthContext` — which is where it was
 * written and which still re-exports it, so every existing import keeps
 * working — because `firebase/authSessionGuard` needs to read it, and
 * `AuthContext` imports `firebase/config`. Importing back the other way would
 * be a cycle. A two-function storage wrapper is also simply the wrong thing to
 * reach a React context module for.
 */

export const AUTH_HINT_KEY = 'auth:hasSession'

/**
 * Does this device hold a signed-in session?
 *
 * Never throws: private mode and a full quota both surface as a storage
 * exception, and the honest answer there is "no hint", which degrades to the
 * pre-hint behaviour rather than to an error.
 *
 * @returns {boolean}
 */
export function hasAuthSessionHint() {
  try { return localStorage.getItem(AUTH_HINT_KEY) === '1' } catch { return false }
}

/**
 * Record or clear the hint.
 *
 * @param {boolean} present
 */
export function setAuthSessionHint(present) {
  try {
    if (present) localStorage.setItem(AUTH_HINT_KEY, '1')
    else localStorage.removeItem(AUTH_HINT_KEY)
  } catch { /* private mode / quota — fall back to the no-hint behaviour */ }
}
