// Pure, React-free policy for auth session recovery. Kept separate from
// useAuthRecovery so the decision logic can be unit-tested with plain `node`
// (scripts/test-auth-recovery.mjs) without pulling in React or a DOM.

// Minimum gap between forced token refreshes. A `visibilitychange` and a
// `pageshow` can fire together when iOS restores from bfcache, and `online`
// often follows immediately after wake — we only want one network round-trip.
export const REFRESH_THROTTLE_MS = 30_000

// Firebase auth error codes that mean "this session is gone, send the user
// back to login". `auth/network-request-failed` is intentionally NOT here: an
// offline tab will recover when the radio comes back, no need to log out.
export const TERMINAL_AUTH_ERRORS = new Set([
  'auth/user-token-expired',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/invalid-user-token',
  'auth/requires-recent-login',
])

// Firebase auth codes that look like `auth/*` but are transient / retryable.
// A forced token refresh failing with one of these does NOT mean the session
// is gone — the next resume or `online` event should retry without disrupting
// the user. Never expire the session on these.
//
// auth/too-many-requests  — Firebase is rate-limiting; back off, don't log out.
// auth/internal-error     — Transient Firebase backend hiccup; not a dead session.
export const TRANSIENT_AUTH_ERRORS = new Set([
  'auth/too-many-requests',
  'auth/internal-error',
])

/**
 * Decide whether a failed token refresh means the session is truly dead.
 *
 * @param {string} code   Firebase error code (e.g. 'auth/id-token-expired').
 * @param {boolean} online navigator.onLine at the time of failure.
 * @returns {boolean} true → expire the session and redirect to login.
 *
 * Returns false for:
 *   • offline / network blips (the `online` listener retries on reconnect)
 *   • empty/unknown codes (don't nuke a session we can't positively classify)
 *   • transient/retryable auth codes (rate-limiting, backend hiccups)
 * Any explicit `auth/*` code that survives those guards is treated as terminal
 * — a stale or revoked token won't fix itself on its own.
 */
export function shouldExpireSession(code, online) {
  if (!code) return false
  if (code === 'auth/network-request-failed') return false
  if (online === false) return false
  if (TRANSIENT_AUTH_ERRORS.has(code)) return false
  return TERMINAL_AUTH_ERRORS.has(code) || code.startsWith('auth/')
}
