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

// — Any non-transient auth/* code (not network) while online → expire ——
assert(shouldExpireSession('auth/invalid-action-code', true) === true, 'unknown auth/* online → expire')

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
