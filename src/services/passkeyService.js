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
//   - No credential, challenge, or token material is ever written to
//     localStorage. The ONLY passkey-adjacent localStorage entry is the
//     region routing hint (a bare region name — see passkeyRegionCore.js).
//
// Regional routing (staged us-central1 → africa-south1 migration): the flow
// callables (registration + sign-in) can be served from africa-south1 twins
// colocated with Firestore. Which region to use is decided HERE and nowhere
// else, from settings/global.featureFlags.passkeyFunctionsRegion (live
// snapshot, so a flag flip is an instant no-redeploy rollback) via the pure
// resolver in passkeyRegionCore.js. Management callables always stay on
// us-central1 — they have no regional twin.

import { getFunctions, httpsCallable } from 'firebase/functions'
import { signInWithCustomToken } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import {
  browserSupportsWebAuthn,
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser'
import app, { auth, db } from '../firebase/config'
import { capture } from '../utils/analytics'
import {
  PASSKEY_PRIMARY_REGION,
  PASSKEY_REGIONAL_REGION,
  PASSKEY_REGION_HINT_KEY,
  regionalCallableName,
  sanitizeRegionHint,
  resolvePasskeyFunctionsRegion,
  regionHintAfterAuth,
  shouldFallbackToPrimary,
} from './passkeyRegionCore'

// Callables are created lazily on first use (not at module import) so pages
// that merely import this service — and jsdom specs that mock the Firebase
// config — never pay for or depend on Functions initialisation.
// Management callables exist only in us-central1; flow callables have one
// instance per region (the africa-south1 twins use the `...Africa` names).
let managementCache = null
function managementCallables() {
  if (!managementCache) {
    const functions = getFunctions(app, PASSKEY_PRIMARY_REGION)
    managementCache = {
      listUserPasskeys: httpsCallable(functions, 'listUserPasskeys'),
      renameUserPasskey: httpsCallable(functions, 'renameUserPasskey'),
      removeUserPasskey: httpsCallable(functions, 'removeUserPasskey'),
    }
  }
  return managementCache
}

const flowCaches = {}
function flowCallables(region) {
  if (!flowCaches[region]) {
    const functions = getFunctions(app, region)
    const name = (base) =>
      region === PASSKEY_REGIONAL_REGION ? regionalCallableName(base) : base
    flowCaches[region] = {
      generateRegistrationOptions: httpsCallable(functions, name('generatePasskeyRegistrationOptions')),
      verifyRegistration: httpsCallable(functions, name('verifyPasskeyRegistration')),
      generateAuthenticationOptions: httpsCallable(functions, name('generatePasskeyAuthenticationOptions')),
      verifyAuthentication: httpsCallable(functions, name('verifyPasskeyAuthentication')),
    }
  }
  return flowCaches[region]
}

// ── Region routing state ─────────────────────────────────────────────────
// A live snapshot of settings/global.featureFlags, started lazily on the
// first flow call and kept open so a rollback flag flip re-routes the very
// next attempt. The Login page already subscribes to the same doc through
// PlatformSettingsProvider, so the SDK shares the underlying watch — this
// adds no extra reads and (once mounted) no extra latency. Fail-safe: any
// read error resolves to {} → us-central1.
let regionFlags = null
let regionFlagsReady = null
function ensureRegionFlags() {
  if (!regionFlagsReady) {
    regionFlagsReady = new Promise((resolve) => {
      try {
        onSnapshot(
          doc(db, 'settings', 'global'),
          (snap) => {
            regionFlags = (snap.exists() && snap.data()?.featureFlags) || {}
            resolve()
          },
          () => {
            regionFlags = regionFlags || {}
            resolve()
          },
        )
      } catch {
        regionFlags = {}
        resolve()
      }
    })
  }
  return regionFlagsReady
}

function readRegionHint() {
  try {
    return sanitizeRegionHint(window.localStorage.getItem(PASSKEY_REGION_HINT_KEY))
  } catch {
    return null
  }
}

// hint === null clears the entry — a rollback flag flip scrubs pilot devices
// on their next successful sign-in.
function persistRegionHint(hint) {
  try {
    if (hint) window.localStorage.setItem(PASSKEY_REGION_HINT_KEY, hint)
    else window.localStorage.removeItem(PASSKEY_REGION_HINT_KEY)
  } catch {
    // Storage unavailable (private mode/quota) — routing just stays default.
  }
}

async function resolveFlowRegion() {
  await ensureRegionFlags()
  return resolvePasskeyFunctionsRegion({
    featureFlags: regionFlags,
    uid: auth.currentUser?.uid || null,
    deviceHint: readRegionHint(),
  }).region
}

/**
 * Call one flow callable in `region`, with a narrow one-shot fallback to
 * us-central1 (see shouldFallbackToPrimary for exactly when that is safe).
 * Returns { data, regionUsed } so a flow that fell back completes its later
 * steps on the same region. Cross-region completion is safe regardless —
 * challenges live in the one shared Firestore database and are single-use.
 */
async function callFlow(region, callableName, payload, phase) {
  try {
    const { data } = await flowCallables(region)[callableName](payload)
    return { data, regionUsed: region }
  } catch (err) {
    if (
      region !== PASSKEY_PRIMARY_REGION &&
      shouldFallbackToPrimary({ code: err?.code, phase })
    ) {
      const { data } = await flowCallables(PASSKEY_PRIMARY_REGION)[callableName](payload)
      return { data, regionUsed: PASSKEY_PRIMARY_REGION }
    }
    throw err
  }
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
  ADMIN_MFA_REQUIRED: 'PASSKEY_ADMIN_MFA_REQUIRED',
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
  [PASSKEY_ERRORS.CREDENTIAL_DUPLICATE]:
    'A passkey for this account already exists on this device or password manager.',
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
  [PASSKEY_ERRORS.ADMIN_MFA_REQUIRED]:
    'Administrator accounts sign in with email, password and an authenticator code.',
}

/**
 * Client-side mirror of the server's registration eligibility (server still
 * enforces): admins are excluded (their mandatory TOTP MFA cannot ride a
 * custom-token session), and the optional rollout lists narrow who can
 * register during the staged launch. Used to hide/disable "Add a passkey"
 * so users outside the rollout never hit a dead-end OS prompt.
 */
export function canRegisterPasskeys({ featureFlags, role, uid }) {
  const flags = featureFlags || {}
  if (flags.passkeyAuthenticationEnabled !== true) return false
  if (role === 'admin' || role === 'superAdmin') return false
  const roles = Array.isArray(flags.passkeyRolloutRoles) ? flags.passkeyRolloutRoles : []
  const uids = Array.isArray(flags.passkeyRolloutUids) ? flags.passkeyRolloutUids : []
  if (roles.length === 0 && uids.length === 0) return true
  if (uid && uids.includes(uid)) return true
  if (role && roles.includes(role)) return true
  return false
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
    const region = await resolveFlowRegion()
    const opts = await callFlow(region, 'generateRegistrationOptions', {}, 'options')
    const attestation = await startRegistration({ optionsJSON: opts.data.options })
    const { data: verified } = await callFlow(opts.regionUsed, 'verifyRegistration', {
      challengeId: opts.data.challengeId,
      response: attestation,
      name: name || '',
    }, 'verify')
    // Registration is authenticated, so the uid is known here — prime (or
    // clear) this device's pre-auth sign-in routing hint.
    persistRegionHint(regionHintAfterAuth({
      featureFlags: regionFlags,
      uid: auth.currentUser?.uid || null,
    }))
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
    const region = await resolveFlowRegion()
    const opts = await callFlow(region, 'generateAuthenticationOptions', {}, 'options')
    const assertion = await startAuthentication({ optionsJSON: opts.data.options })
    const { data: verified } = await callFlow(opts.regionUsed, 'verifyAuthentication', {
      challengeId: opts.data.challengeId,
      response: assertion,
    }, 'verify')
    const cred = await signInWithCustomToken(auth, verified.token)
    // Now that the uid is known, refresh (or clear) this device's pre-auth
    // routing hint against the live flag.
    persistRegionHint(regionHintAfterAuth({
      featureFlags: regionFlags,
      uid: cred.user?.uid || null,
    }))
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
  const { data } = await managementCallables().listUserPasskeys({})
  return data
}

/** Rename one of the signed-in user's passkeys. */
export async function renamePasskey(credentialId, name) {
  const { data } = await managementCallables().renameUserPasskey({ credentialId, name })
  return data
}

/** Remove one of the signed-in user's passkeys — it stops working
 * immediately. The same device can be re-registered later. */
export async function removePasskey(credentialId) {
  const { data } = await managementCallables().removeUserPasskey({ credentialId })
  capture('passkey_removed')
  return data
}
