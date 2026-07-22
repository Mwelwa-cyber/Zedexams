// Passkey (WebAuthn) client service — the ONE place the app talks to the
// passkey Cloud Functions and the browser WebAuthn API. Components never
// call navigator.credentials or the callables directly, and never handle
// binary fields: @simplewebauthn/browser does the ArrayBuffer ⇄ Base64URL
// serialization in startRegistration/startAuthentication, so no conversion
// logic is duplicated anywhere else.
//
// Security notes:
//   - Biometrics never leave the device: the browser/OS authenticator does
//     the fingerprint/face/PIN check locally and only a signed assertion is
//     sent to the server.
//   - The custom token from verifyPasskeyAuthentication goes straight into
//     signInWithCustomToken and is never logged or persisted.
//   - Nothing passkey-related is written to localStorage.

import { getFunctions, httpsCallable } from 'firebase/functions'
import { signInWithCustomToken } from 'firebase/auth'
import {
  browserSupportsWebAuthn,
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser'
import app, { auth } from '../firebase/config'
import { capture } from '../utils/analytics'

// Callables are created lazily on first use (not at module import) so pages
// that merely import this service — and jsdom specs that mock the Firebase
// config — never pay for or depend on Functions initialisation.
let callableCache = null
function callables() {
  if (!callableCache) {
    const functions = getFunctions(app, 'us-central1')
    callableCache = {
      generateRegistrationOptions: httpsCallable(functions, 'generatePasskeyRegistrationOptions'),
      verifyRegistration: httpsCallable(functions, 'verifyPasskeyRegistration'),
      generateAuthenticationOptions: httpsCallable(functions, 'generatePasskeyAuthenticationOptions'),
      verifyAuthentication: httpsCallable(functions, 'verifyPasskeyAuthentication'),
      listUserPasskeys: httpsCallable(functions, 'listUserPasskeys'),
      renameUserPasskey: httpsCallable(functions, 'renameUserPasskey'),
      removeUserPasskey: httpsCallable(functions, 'removeUserPasskey'),
    }
  }
  return callableCache
}

// Mirror of the server-side cap in functions/passkeys/passkeyCore.js —
// display only; enforcement is always server-side.
export const MAX_PASSKEYS_PER_USER = 10

// ── Support detection ────────────────────────────────────────────────────

/** True when this browser can do WebAuthn at all. Cheap + synchronous. */
export function isPasskeySupported() {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

// ── Error mapping ────────────────────────────────────────────────────────

export const PASSKEY_ERRORS = Object.freeze({
  NOT_SUPPORTED: 'PASSKEY_NOT_SUPPORTED',
  CANCELLED: 'PASSKEY_CANCELLED',
  CHALLENGE_EXPIRED: 'PASSKEY_CHALLENGE_EXPIRED',
  CHALLENGE_REUSED: 'PASSKEY_CHALLENGE_REUSED',
  CHALLENGE_INVALID: 'PASSKEY_CHALLENGE_INVALID',
  ORIGIN_INVALID: 'PASSKEY_ORIGIN_INVALID',
  RP_ID_INVALID: 'PASSKEY_RP_ID_INVALID',
  CREDENTIAL_UNKNOWN: 'PASSKEY_CREDENTIAL_UNKNOWN',
  CREDENTIAL_REVOKED: 'PASSKEY_CREDENTIAL_REVOKED',
  CREDENTIAL_DUPLICATE: 'PASSKEY_CREDENTIAL_DUPLICATE',
  VERIFICATION_FAILED: 'PASSKEY_VERIFICATION_FAILED',
  LIMIT_REACHED: 'PASSKEY_LIMIT_REACHED',
  REAUTH_REQUIRED: 'PASSKEY_REAUTH_REQUIRED',
  NETWORK_ERROR: 'PASSKEY_NETWORK_ERROR',
  RATE_LIMITED: 'PASSKEY_RATE_LIMITED',
  DISABLED: 'PASSKEY_DISABLED',
})

// Safe user-facing copy per code — no stack traces or verification
// internals ever reach the UI.
const ERROR_MESSAGES = {
  [PASSKEY_ERRORS.NOT_SUPPORTED]:
    'Passkeys are not supported on this browser. Use Google or your password to sign in.',
  [PASSKEY_ERRORS.CANCELLED]: 'Passkey sign-in was cancelled.',
  [PASSKEY_ERRORS.CHALLENGE_EXPIRED]: 'This request expired. Please try again.',
  [PASSKEY_ERRORS.CHALLENGE_REUSED]: 'This request was already used. Please try again.',
  [PASSKEY_ERRORS.CHALLENGE_INVALID]:
    'This request could not be verified. Please try again.',
  [PASSKEY_ERRORS.CREDENTIAL_UNKNOWN]:
    'This passkey is no longer linked to a ZedExams account. Use another sign-in method.',
  [PASSKEY_ERRORS.CREDENTIAL_REVOKED]:
    'This passkey is no longer linked to a ZedExams account. Use another sign-in method.',
  [PASSKEY_ERRORS.CREDENTIAL_DUPLICATE]: 'This passkey is already registered.',
  [PASSKEY_ERRORS.VERIFICATION_FAILED]:
    'We could not verify this passkey. Try again or use another sign-in method.',
  [PASSKEY_ERRORS.LIMIT_REACHED]:
    `You can have at most ${MAX_PASSKEYS_PER_USER} passkeys. Remove one to add another.`,
  [PASSKEY_ERRORS.REAUTH_REQUIRED]:
    'For security, please sign out and sign in again, then retry.',
  [PASSKEY_ERRORS.NETWORK_ERROR]:
    'Passkey sign-in could not connect. Check your internet connection and try again.',
  [PASSKEY_ERRORS.RATE_LIMITED]:
    'Too many attempts. Please wait a moment and try again.',
  [PASSKEY_ERRORS.DISABLED]: 'Passkey sign-in is not available yet.',
}

const GENERIC_MESSAGE =
  'We could not verify this passkey. Try again or use another sign-in method.'

/**
 * Normalise any failure from the flows below into { code, message,
 * cancelled }. Cancellation (user dismissed the OS prompt) is a neutral
 * outcome, not a system error — callers should show the message without
 * error styling.
 */
export function mapPasskeyError(err) {
  // User dismissed / timed out the OS authenticator sheet.
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
    return {
      code: PASSKEY_ERRORS.CANCELLED,
      message: ERROR_MESSAGES[PASSKEY_ERRORS.CANCELLED],
      cancelled: true,
    }
  }
  if (err?.name === 'InvalidStateError') {
    // The authenticator already holds a credential for this account
    // (excludeCredentials matched) — effectively a duplicate.
    return {
      code: PASSKEY_ERRORS.CREDENTIAL_DUPLICATE,
      message: ERROR_MESSAGES[PASSKEY_ERRORS.CREDENTIAL_DUPLICATE],
      cancelled: false,
    }
  }
  // Structured code from our Cloud Functions (HttpsError details.code).
  const serverCode = err?.details?.code
  if (serverCode && ERROR_MESSAGES[serverCode]) {
    return { code: serverCode, message: ERROR_MESSAGES[serverCode], cancelled: false }
  }
  if (err?.code === 'functions/resource-exhausted') {
    return {
      code: PASSKEY_ERRORS.RATE_LIMITED,
      message: ERROR_MESSAGES[PASSKEY_ERRORS.RATE_LIMITED],
      cancelled: false,
    }
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline || err?.code === 'functions/unavailable' || err?.code === 'functions/deadline-exceeded') {
    return {
      code: PASSKEY_ERRORS.NETWORK_ERROR,
      message: ERROR_MESSAGES[PASSKEY_ERRORS.NETWORK_ERROR],
      cancelled: false,
    }
  }
  return { code: PASSKEY_ERRORS.VERIFICATION_FAILED, message: GENERIC_MESSAGE, cancelled: false }
}

// ── Flows ────────────────────────────────────────────────────────────────

/**
 * Register a new passkey for the CURRENTLY signed-in user. Never called
 * automatically — only from the explicit "Add a passkey" action in
 * Settings → Security → Passkeys.
 * Resolves with the new passkey's safe metadata.
 */
export async function registerPasskey(name) {
  if (!isPasskeySupported()) {
    const e = new Error('WebAuthn unsupported')
    e.name = 'PasskeyUnsupported'
    e.details = { code: PASSKEY_ERRORS.NOT_SUPPORTED }
    throw e
  }
  capture('passkey_setup_started')
  try {
    const { data } = await callables().generateRegistrationOptions({})
    const attestation = await startRegistration({ optionsJSON: data.options })
    const { data: verified } = await callables().verifyRegistration({
      challengeId: data.challengeId,
      response: attestation,
      name: name || '',
    })
    capture('passkey_setup_completed')
    return verified.passkey
  } catch (err) {
    const mapped = mapPasskeyError(err)
    capture(mapped.cancelled ? 'passkey_setup_cancelled' : 'passkey_setup_failed')
    throw err
  }
}

/**
 * Sign in with a passkey. On success the existing Firebase account session
 * is restored via signInWithCustomToken — same uid, role, claims, and
 * subscription as any other sign-in method. Resolves with the UserCredential
 * so Login.jsx can run its normal completePostLogin tail.
 */
export async function signInWithPasskey() {
  if (!isPasskeySupported()) {
    const e = new Error('WebAuthn unsupported')
    e.name = 'PasskeyUnsupported'
    e.details = { code: PASSKEY_ERRORS.NOT_SUPPORTED }
    throw e
  }
  capture('passkey_signin_started')
  try {
    const { data } = await callables().generateAuthenticationOptions({})
    const assertion = await startAuthentication({ optionsJSON: data.options })
    const { data: verified } = await callables().verifyAuthentication({
      challengeId: data.challengeId,
      response: assertion,
    })
    const cred = await signInWithCustomToken(auth, verified.token)
    capture('passkey_signin_completed')
    return cred
  } catch (err) {
    const mapped = mapPasskeyError(err)
    capture(mapped.cancelled ? 'passkey_signin_cancelled' : 'passkey_signin_failed')
    throw err
  }
}

/** List the signed-in user's passkeys (safe metadata only). */
export async function listPasskeys() {
  const { data } = await callables().listUserPasskeys({})
  return data
}

/** Rename one of the signed-in user's passkeys. */
export async function renamePasskey(credentialId, name) {
  const { data } = await callables().renameUserPasskey({ credentialId, name })
  return data
}

/** Remove one of the signed-in user's passkeys — it stops working
 * immediately. The same device can be re-registered later. */
export async function removePasskey(credentialId) {
  const { data } = await callables().removeUserPasskey({ credentialId })
  capture('passkey_removed')
  return data
}
