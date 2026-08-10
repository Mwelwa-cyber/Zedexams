/**
 * Unit tests for the pure account re-authentication helpers
 * (src/utils/accountReauth.js) that guard the LEGAL-003 delete-account step-up.
 *
 * Pure module → runs under plain `node` (npm run test:account-reauth).
 */
import assert from 'node:assert'
import {
  pickReauthMethod,
  canSubmitDeletion,
  deletionErrorMessage,
} from './accountReauth.js'

// ── pickReauthMethod ─────────────────────────────────────────────────────
;(function pickMethod() {
  assert.strictEqual(
    pickReauthMethod([{ providerId: 'password' }]),
    'password',
    'an email/password account re-auths with its password',
  )
  assert.strictEqual(
    pickReauthMethod([{ providerId: 'google.com' }]),
    'oauth',
    'a Google account re-auths through the provider popup',
  )
  // Password provider wins when an account has linked both.
  assert.strictEqual(
    pickReauthMethod([{ providerId: 'google.com' }, { providerId: 'password' }]),
    'password',
  )
  // Defensive: missing / malformed provider lists never throw.
  assert.strictEqual(pickReauthMethod([]), 'oauth')
  assert.strictEqual(pickReauthMethod(null), 'oauth')
  assert.strictEqual(pickReauthMethod(undefined), 'oauth')
  assert.strictEqual(pickReauthMethod([null, {}]), 'oauth')
  console.log('✓ pickReauthMethod')
})()

// ── canSubmitDeletion ────────────────────────────────────────────────────
;(function submitGate() {
  // Not confirmed → never submittable, regardless of method/password.
  assert.strictEqual(canSubmitDeletion({ method: 'oauth', confirmed: false }), false)
  assert.strictEqual(
    canSubmitDeletion({ method: 'password', password: 'hunter2', confirmed: false }),
    false,
  )

  // OAuth: a confirmed intent is enough (the popup collects the credential).
  assert.strictEqual(canSubmitDeletion({ method: 'oauth', confirmed: true }), true)

  // Password: confirmed AND a non-empty password.
  assert.strictEqual(
    canSubmitDeletion({ method: 'password', password: '', confirmed: true }),
    false,
    'a password account cannot delete without a password',
  )
  assert.strictEqual(
    canSubmitDeletion({ method: 'password', password: '   ', confirmed: true }),
    true,
    'whitespace is a non-empty password (Firebase, not us, validates it)',
  )
  assert.strictEqual(
    canSubmitDeletion({ method: 'password', password: 'hunter2', confirmed: true }),
    true,
  )
  // Empty args never throw.
  assert.strictEqual(canSubmitDeletion(), false)
  assert.strictEqual(canSubmitDeletion({}), false)
  console.log('✓ canSubmitDeletion')
})()

// ── deletionErrorMessage ─────────────────────────────────────────────────
;(function errorCopy() {
  // Wrong password variants all collapse to one calm line.
  for (const code of ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials']) {
    assert.match(deletionErrorMessage({ code }), /password is incorrect/i, code)
  }

  // Backend recent-login rejection (httpsCallable shape: code + details.reason).
  const recent = deletionErrorMessage({
    code: 'functions/failed-precondition',
    details: { reason: 'requires-recent-login' },
  })
  assert.match(recent, /confirm your identity/i)
  // …and the Firebase client-side equivalent maps to the same copy.
  assert.strictEqual(deletionErrorMessage({ code: 'auth/requires-recent-login' }), recent)

  // Popup + missing-password + rate-limit each get their own actionable copy.
  assert.match(deletionErrorMessage({ code: 'auth/popup-closed-by-user' }), /cancelled/i)
  assert.match(deletionErrorMessage({ code: 'auth/popup-blocked' }), /allow popups/i)
  assert.match(deletionErrorMessage({ code: 'account/password-required' }), /enter your password/i)
  assert.match(deletionErrorMessage({ code: 'auth/too-many-requests' }), /wait a few minutes/i)
  assert.match(
    deletionErrorMessage({ code: 'auth/operation-not-supported-in-this-environment' }),
    /sign out and sign in again/i,
  )

  // A bare string code works too.
  assert.match(deletionErrorMessage('auth/network-request-failed'), /connection/i)

  // Unknown / empty → the safe fallback, never a raw Firebase string.
  const fallback = deletionErrorMessage({ code: 'auth/something-new' })
  assert.match(fallback, /could not delete your account/i)
  assert.strictEqual(deletionErrorMessage(null), fallback)
  assert.strictEqual(deletionErrorMessage(undefined), fallback)
  // A caller can override the fallback copy.
  assert.strictEqual(deletionErrorMessage({ code: 'x' }, 'custom'), 'custom')

  // ── PURGE-003: the account is already GONE ─────────────────────────────
  // The default fallback tells the reader to try again. Past the point of no
  // return there is nothing left to try and no account to try it with, so it
  // is not merely unhelpful — it is false.
  const gone = deletionErrorMessage({
    code: 'functions/internal',
    message: 'Your sign-in has been removed and the rest of your data is still being deleted.',
    details: { reason: 'purge-failed', irreversible: true },
  })
  assert.match(gone, /sign-in has been removed/i, "the server's own sentence reaches the reader")
  assert.doesNotMatch(gone, /try again/i, 'there is nothing left to try')

  // A server that sent no message still must not produce the retry copy.
  const noMessage = deletionErrorMessage({
    code: 'functions/internal',
    details: { reason: 'purge-unverified', irreversible: true },
  })
  assert.match(noMessage, /do not need to do anything else/i)
  assert.doesNotMatch(noMessage, /try again/i)

  // The flag is what decides, and it is checked strictly: `details` crosses a
  // serialization boundary, and the string 'false' is truthy.
  assert.match(
    deletionErrorMessage({code: 'functions/internal', message: 'x', details: {irreversible: 'false'}}),
    /could not delete your account/i,
  )
  // A pre-destructive failure keeps the retry copy — the account is intact and
  // retrying is exactly what the user should do.
  assert.match(
    deletionErrorMessage({code: 'functions/internal', message: 'x', details: {reason: 'revoke-failed'}}),
    /could not delete your account/i,
  )
  console.log('✓ deletionErrorMessage')
})()

console.log('All accountReauth tests passed.')
