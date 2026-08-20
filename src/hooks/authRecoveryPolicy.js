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
// This is an ALLOWLIST — shouldExpireSession only ends the session on a code
// listed here, never on an unrecognised one (see below).
export const TERMINAL_AUTH_ERRORS = new Set([
  'auth/user-token-expired',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/invalid-user-token',
  'auth/invalid-refresh-token',
  'auth/invalid-credential',
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
 * @param {object} [ctx]
 * @param {boolean} [ctx.attestationDegraded] True when App Check issued a
 *   placeholder token recently — see below.
 * @returns {boolean} true → expire the session and redirect to login.
 *
 * Returns false for:
 *   • offline / network blips (the `online` listener retries on reconnect)
 *   • empty/unknown codes (don't nuke a session we can't positively classify)
 *   • transient/retryable auth codes (rate-limiting, backend hiccups)
 *   • any auth/* code NOT on the terminal allowlist — codes like
 *     auth/timeout or auth/quota-exceeded are recoverable, and the old
 *     `startsWith('auth/')` catch-all here was signing users out on them
 *     ("logged out on refresh/resume"). Unknown ≠ dead: default to keeping
 *     the session and let the next resume/online event retry.
 *   • DEGRADED ATTESTATION, whatever the code says. When App Check cannot mint
 *     a real token, `appCheckResilient` fails open with a placeholder its own
 *     comment describes as something "the enforced backends reject". App Check
 *     is enforced on Auth for this project, so during that window a forced
 *     token refresh fails for a reason that has nothing to do with the
 *     credential — and the account is perfectly alive. This is checked FIRST,
 *     and deliberately outranks the terminal allowlist: the codes an enforced
 *     backend's 401 maps to are not contractual, so classifying on the code
 *     alone is guesswork. Knowing attestation just failed is not.
 */
export function shouldExpireSession(code, online, { attestationDegraded = false } = {}) {
  if (attestationDegraded) return false
  if (!code) return false
  if (code === 'auth/network-request-failed') return false
  if (online === false) return false
  if (TRANSIENT_AUTH_ERRORS.has(code)) return false
  return TERMINAL_AUTH_ERRORS.has(code)
}
