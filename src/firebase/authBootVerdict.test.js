/**
 * Node test for src/firebase/authBootVerdict.js — the rule that decides
 * whether a failed boot-time session check means the credential is dead or
 * only that the check did not complete.
 *
 * The bug this guards: Firebase's `reloadAndSetCurrentUserOrClear` deletes the
 * persisted user on EVERY error except `auth/network-request-failed`, so a
 * rate limit or a 5xx signs a working account out on reload. Getting these
 * classifications wrong in the "terminal" direction reinstates exactly that.
 *
 * Run: node src/firebase/authBootVerdict.test.js
 */

import assert from 'node:assert/strict'

import {
  INFRASTRUCTURAL,
  OK,
  TERMINAL,
  TERMINAL_SERVER_ERRORS,
  classifyVerificationResponse,
  isSessionVerificationUrl,
  readServerErrorCode,
  shouldPreserveStoredSession,
} from './authBootVerdict.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// ── Which requests decide the question ───────────────────────────────────
ok('the account lookup is a verification request', isSessionVerificationUrl(
  'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIza',
) === true)
ok('the token refresh is a verification request', isSessionVerificationUrl(
  'https://securetoken.googleapis.com/v1/token?key=AIza',
) === true)
// The SDK talks to identitytoolkit constantly. Only the reload's own call
// decides whether the stored session lives, so nothing else may set a verdict.
ok('signing in is NOT a verification request', isSessionVerificationUrl(
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIza',
) === false)
ok('sending an email is NOT a verification request', isSessionVerificationUrl(
  'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=AIza',
) === false)
ok('an unrelated host is not a verification request', isSessionVerificationUrl(
  'https://zedexams.com/v1/accounts:lookup',
) === false)
// A regional Identity Platform host still verifies the same session.
ok('a regional identitytoolkit host still matches', isSessionVerificationUrl(
  'https://europe-west1-identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIza',
) === true)
ok('a non-string url is not a verification request', isSessionVerificationUrl(undefined) === false)

// ── Reading the server's own word ────────────────────────────────────────
ok('reads a bare error message', readServerErrorCode({ error: { message: 'TOKEN_EXPIRED' } }) === 'TOKEN_EXPIRED')
// The SDK splits on ' : ' before mapping, so we have to split the same way or
// a real verdict reads as an unrecognised string.
ok('reads the code out of a decorated message', readServerErrorCode({
  error: { message: 'USER_DISABLED : The account has been disabled' },
}) === 'USER_DISABLED')
ok('reads the 200-with-errorMessage shape', readServerErrorCode({ errorMessage: 'USER_NOT_FOUND' }) === 'USER_NOT_FOUND')
ok('no message reads as no code', readServerErrorCode({}) === '')
ok('a non-object body reads as no code', readServerErrorCode(undefined) === '')

// ── The classification ───────────────────────────────────────────────────
ok('a clean 200 is ok', classifyVerificationResponse({ status: 200, body: { users: [{}] } }) === OK)

// Every terminal code is a genuine server verdict on the credential.
for (const code of TERMINAL_SERVER_ERRORS) {
  ok(`${code} is terminal`, classifyVerificationResponse({
    status: 400, body: { error: { message: code } },
  }) === TERMINAL)
}

// THE BUG, stated as assertions. Each of these deleted a working session.
ok('a rate limit is NOT terminal', classifyVerificationResponse({
  status: 429, body: { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } },
}) === INFRASTRUCTURAL)
ok('a 500 is NOT terminal', classifyVerificationResponse({ status: 500, body: {} }) === INFRASTRUCTURAL)
ok('a 503 is NOT terminal', classifyVerificationResponse({ status: 503 }) === INFRASTRUCTURAL)
ok('an App Check refusal is NOT terminal', classifyVerificationResponse({
  status: 403, body: { error: { message: 'Firebase App Check token is invalid.' } },
}) === INFRASTRUCTURAL)
ok('a quota error is NOT terminal', classifyVerificationResponse({
  status: 429, body: { error: { message: 'QUOTA_EXCEEDED' } },
}) === INFRASTRUCTURAL)
// Unknown is not dead — the same rule authInitRetryPolicy already argues for.
ok('an unmapped server string is NOT terminal', classifyVerificationResponse({
  status: 400, body: { error: { message: 'SOMETHING_NOBODY_HAS_SEEN' } },
}) === INFRASTRUCTURAL)
ok('no response at all is NOT terminal', classifyVerificationResponse({}) === INFRASTRUCTURAL)
ok('no argument at all is NOT terminal', classifyVerificationResponse() === INFRASTRUCTURAL)
// A 2xx can still carry an error. Reading only the status would call a
// rejected credential healthy.
ok('a 200 carrying an errorMessage is not ok', classifyVerificationResponse({
  status: 200, body: { errorMessage: 'TOKEN_EXPIRED' },
}) === TERMINAL)

// ── The removal decision ─────────────────────────────────────────────────
const base = { armed: true, isSessionKey: true, hasHint: true, verdict: INFRASTRUCTURAL }

ok('an unverifiable session is preserved', shouldPreserveStoredSession(base) === true)
// The whole reason this is safe to ship: a real rejection still logs the user
// out, immediately and completely.
ok('a server-rejected session is released', shouldPreserveStoredSession({
  ...base, verdict: TERMINAL,
}) === false)
// After the boot window every removal is an ordinary sign-out. Holding one
// would mean a user who tapped "Log out" stayed signed in.
ok('a removal after boot is never touched', shouldPreserveStoredSession({
  ...base, armed: false,
}) === false)
// The redirect user and the persistence-type marker are cleared routinely.
ok('a non-session key is never touched', shouldPreserveStoredSession({
  ...base, isSessionKey: false,
}) === false)
// Nothing to rescue, and a device with no hint may well be clearing a blob
// that is genuinely unusable.
ok('a device with no session hint is never touched', shouldPreserveStoredSession({
  ...base, hasHint: false,
}) === false)
// Two cases that are NOT the server rejecting the credential, and so keep it:
// a check that succeeded while the SDK still gave up (an empty `users` array
// is `auth/internal-error`), and one we never observed at all.
ok('an ok verdict still preserves', shouldPreserveStoredSession({ ...base, verdict: OK }) === true)
ok('an unobserved verdict still preserves', shouldPreserveStoredSession({ ...base, verdict: null }) === true)

console.log(`\n  ${passed} assertions passed`)
