// Unit tests for the auth session-recovery policy. Plain `node` script — no
// runner, throws on first failed assertion. Covers shouldExpireSession, the
// pure decision used by useAuthRecovery when a forced token refresh fails on
// resume.
//
//   node scripts/test-auth-recovery.mjs
//   npm run test:auth-recovery

import {
  shouldExpireSession,
  TERMINAL_AUTH_ERRORS,
  TRANSIENT_AUTH_ERRORS,
  REFRESH_THROTTLE_MS,
} from '../src/hooks/authRecoveryPolicy.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

// — Terminal codes while online → expire ————————————————————————————————
for (const code of TERMINAL_AUTH_ERRORS) {
  assert(shouldExpireSession(code, true) === true, `terminal code ${code} online → expire`)
}

// — Transient auth/* codes must never expire the session ————————————————
// These are retryable (rate-limit, backend hiccup) — nuking the session here
// would log the user out after heavy usage or a Firebase blip.
for (const code of TRANSIENT_AUTH_ERRORS) {
  assert(shouldExpireSession(code, true) === false, `transient code ${code} online → no expire`)
}
assert(shouldExpireSession('auth/too-many-requests', false) === false, 'too-many-requests offline → no expire')

// — auth/* codes OFF the terminal allowlist must NOT expire the session ——
// The old `startsWith('auth/')` catch-all treated every unrecognised auth code
// as a dead session, which signed users out on recoverable failures
// (auth/timeout, auth/quota-exceeded, …) after a refresh or app resume.
assert(shouldExpireSession('auth/invalid-action-code', true) === false, 'unlisted auth/* online → no expire')
assert(shouldExpireSession('auth/timeout', true) === false, 'auth/timeout → no expire')
assert(shouldExpireSession('auth/quota-exceeded', true) === false, 'auth/quota-exceeded → no expire')

// ── Degraded App Check attestation outranks the terminal allowlist ───────────
//
// App Check is ENFORCED on Auth for this project: a request carrying the
// fail-open placeholder token is answered 401 "Firebase App Check token is
// invalid." A forced token refresh therefore fails for a reason that has
// nothing to do with the credential, and the account is alive. Signing the user
// out there is the cold-load logout (F1).
//
// This is checked BEFORE the code, deliberately. The code an enforced backend's
// 401 maps to is not contractual — the SDK may surface it as internal-error, as
// invalid-credential, or as something unmapped — so classifying on the code is
// guesswork. Knowing attestation just failed is not.
for (const code of TERMINAL_AUTH_ERRORS) {
  assert(
    shouldExpireSession(code, true, { attestationDegraded: true }) === false,
    `terminal code ${code} does NOT expire while attestation is degraded`,
  )
}
assert(
  shouldExpireSession('auth/user-disabled', true, { attestationDegraded: false }) === true,
  'and a terminal code still expires once attestation is healthy',
)
assert(
  shouldExpireSession('auth/user-disabled', true) === true,
  'omitting the context keeps the old behaviour (back-compatible default)',
)

// — Newly-listed terminal codes: a bad refresh token IS a dead session ——
assert(shouldExpireSession('auth/invalid-refresh-token', true) === true, 'invalid-refresh-token online → expire')
assert(shouldExpireSession('auth/invalid-credential', true) === true, 'invalid-credential online → expire')

// — Network failure → never expire (offline tab recovers on reconnect) ——
assert(shouldExpireSession('auth/network-request-failed', true) === false, 'network-request-failed → no expire (online)')
assert(shouldExpireSession('auth/network-request-failed', false) === false, 'network-request-failed → no expire (offline)')

// — Offline at the moment of failure → never expire, regardless of code ——
assert(shouldExpireSession('auth/id-token-expired', false) === false, 'terminal code but offline → no expire')
assert(shouldExpireSession('auth/user-disabled', false) === false, 'user-disabled but offline → no expire')

// — Empty / unknown / non-auth codes → don't nuke an unclassifiable session
assert(shouldExpireSession('', true) === false, 'empty code → no expire')
assert(shouldExpireSession(undefined, true) === false, 'undefined code → no expire')
assert(shouldExpireSession('permission-denied', true) === false, 'firestore permission-denied is not an auth/* code → no expire')
assert(shouldExpireSession('unavailable', true) === false, 'firestore unavailable → no expire')

// — Sanity on the shared throttle constant ————————————————————————————————
assert(REFRESH_THROTTLE_MS >= 1000, 'throttle is a sane positive duration')

console.log(`auth-recovery policy: ${passed} assertions passed`)
