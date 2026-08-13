/**
 * src/firebase/appCheckWriteGate.js
 *
 * Pure, framework-free decision core for "may this Storage WRITE proceed?".
 * Deliberately firebase-free so it unit-tests under plain `node` (see the
 * sibling appCheckWriteGate.test.js) without dragging the browser SDK in.
 *
 * WHY THIS EXISTS — App Check enforcement on Cloud Storage (2026-08):
 * `appCheckResilient.js` deliberately FAILS OPEN: when reCAPTCHA hangs or
 * crashes it yields a short-lived placeholder token so Auth and Firestore
 * requests proceed instead of stalling (the sign-in outage of 2026-07-01).
 * That trade is still right for Auth/Firestore — a placeholder is logged
 * exactly like a missing token and nothing is rejected.
 *
 * It is NOT right for a Storage write once enforcement is on. Verified
 * against the live bucket: a request whose App Check token is absent or
 * unrecognised is answered
 *   401 {"error":{"code":401,"message":"Firebase App Check token is invalid."}}
 * so an upload carrying the placeholder is doomed before it leaves. Two
 * consequences make that worse than a one-off failure:
 *
 *   1. The placeholder is CACHED for its full TTL (60s). The Firebase SDK
 *      reuses it for every subsequent request until it expires, so a single
 *      5s reCAPTCHA stall locks out every upload for a minute — even if
 *      reCAPTCHA recovered immediately.
 *   2. The rejection surfaces as `storage/unauthorized`, indistinguishable
 *      from a Security Rules denial or an oversized file, so the upload
 *      screens report the wrong cause to the teacher.
 *
 * The gate below spends ONE forced refresh to convert a cached placeholder
 * back into a real token before giving up, and otherwise refuses the write
 * with a reason the UI can phrase honestly. Reads are untouched: a download
 * URL carrying a valid download token serves without App Check being
 * consulted, which is why images render normally while writes would not.
 */

/** The write may proceed — a genuine attestation token is in hand. */
export const WRITE_ATTESTED = 'attested'
/** App Check isn't configured in this build; defer to the server. */
export const WRITE_UNCONFIGURED = 'unconfigured'
/** Only the fail-open placeholder is available — refuse the write. */
export const WRITE_PLACEHOLDER = 'placeholder'
/** Token minting threw; treat like a placeholder (refuse, retryable). */
export const WRITE_ERROR = 'error'

/**
 * What the user is told when attestation can't be obtained. Deliberately
 * about the DEVICE CHECK rather than about permissions: the teacher has the
 * right to upload, so "you're not allowed" would be a lie, and "try again"
 * is genuinely the correct action (the placeholder is short-lived).
 */
export const WRITE_BLOCKED_MESSAGE =
  "We couldn't verify this device just now. Please try that upload again in a moment."

// ── Why a refused write is NOT necessarily a permissions problem ──────────
//
// The gate above catches the case it can see coming: App Check initialised,
// but only the placeholder is available. That write never leaves, and the
// caller gets `appcheck/unattested` — a code the upload screens already
// phrase honestly.
//
// The case it CANNOT catch is the one that fails open by design. When App
// Check never initialised at all (`configured: false`) the gate lets the
// write through, because blocking would break local development and the
// emulator suite to no benefit. That was sound while Storage was
// Monitoring-only. It is not sound in a PRODUCTION build against an ENFORCED
// bucket: the request goes up carrying no App Check token whatsoever, and an
// enforced bucket answers
//   401 {"error":{"code":401,"message":"Firebase App Check token is invalid."}}
// which the JS SDK surfaces as `storage/unauthorized` — the SAME code a
// Security Rules denial produces.
//
// The upload screens then read that code as a rules denial and tell the user
// to check their role, verify their email, and sign out and back in. For an
// admin or superAdmin who already passes every arm of storage.rules, all of
// that advice is a dead end — the exact misdiagnosis loop the docblock in
// src/utils/quizImageUpload.js was written to kill, reappearing one layer
// down.
//
// It does not have to be a guess. If App Check did not initialise in this
// build, then NO request from this page carried a token, so an enforced
// bucket refused the write for that reason and no other. That is a
// determination, and these helpers make it.
//
// Reading the state at failure time is reliable: every write goes through
// assertStorageWriteAttested(), which awaits whenAppCheckReady() before the
// upload starts, so init has always settled by the time an error is handled.

/** Not an attestation failure — treat the refusal as a rules denial. */
export const ATTESTATION_OK = 'attestation-ok'
/** This build shipped with no reCAPTCHA site key, so App Check never ran. */
export const ATTESTATION_BUILD_KEY_MISSING = 'build-key-missing'
/** A key was present (or native), but App Check init did not complete. */
export const ATTESTATION_INIT_FAILED = 'init-failed'

/**
 * Why an enforced bucket refused this write, given the build's App Check
 * state. Only ever returns an attestation cause for `storage/unauthorized`:
 * every other code already says what it means.
 *
 * @param {object} opts
 * @param {string} opts.code  The Firebase error code from the failed write.
 * @param {{native?:boolean, recaptchaKeyConfigured?:boolean, initialized?:boolean}} [opts.appCheck]
 *   getAppCheckClientState() from src/firebase/config.js. Omit it (or pass
 *   null) and the verdict is always ATTESTATION_OK, which preserves the
 *   previous permissions-first wording for callers that can't see the state.
 * @returns {string} One of the ATTESTATION_* constants.
 */
export function classifyStorageWriteRejection({ code, appCheck } = {}) {
  if (String(code || '') !== 'storage/unauthorized') return ATTESTATION_OK
  if (!appCheck || typeof appCheck !== 'object') return ATTESTATION_OK
  // Only a build where App Check never came up can be diagnosed from here.
  // If it DID initialise, the token was real (the gate refuses a placeholder
  // before the upload), so the refusal genuinely came from the rules.
  if (appCheck.initialized !== false) return ATTESTATION_OK
  // On the Android wrapper attestation is Play Integrity, so the web
  // reCAPTCHA key says nothing about why init failed.
  if (appCheck.native) return ATTESTATION_INIT_FAILED
  return appCheck.recaptchaKeyConfigured
    ? ATTESTATION_INIT_FAILED
    : ATTESTATION_BUILD_KEY_MISSING
}

/**
 * The message for an attestation-caused refusal, or null when the refusal
 * was a genuine permissions denial and the caller should keep its own
 * role/verification wording.
 *
 * The two causes get different copy because the remedies are different: a
 * missing build key is a deployment fault that no amount of signing in and
 * out will fix, while a failed init is usually local and usually transient.
 *
 * @param {object} opts  Same shape as classifyStorageWriteRejection.
 * @returns {string|null}
 */
export function storageWriteRejectionMessage(opts) {
  switch (classifyStorageWriteRejection(opts)) {
    case ATTESTATION_BUILD_KEY_MISSING:
      return 'Upload blocked — this site was built without its App Check key, so '
        + 'Storage rejects every upload from it. This is not your account or the '
        + 'file: your role and permissions are fine. Set '
        + 'VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY in the deploy secrets and redeploy. '
        + 'Admins can confirm at /admin/app-check — "Build key" will read MISSING.'
    case ATTESTATION_INIT_FAILED:
      return 'Upload blocked — device verification (App Check) did not start on this '
        + 'page, so Storage rejected the upload. This is not your account or the '
        + 'file. Reload the page and try again; if it keeps happening, a browser '
        + 'extension or network filter is blocking reCAPTCHA. Admins can check '
        + '/admin/app-check.'
    default:
      return null
  }
}

/**
 * Decide whether a Storage write may proceed.
 *
 * Fails OPEN when App Check isn't configured at all (`configured: false`) —
 * a lint-only build, the emulator suite, or a dev server with no reCAPTCHA
 * key. Blocking there would break local development to no benefit, since an
 * unenforced backend accepts the write and an enforced one rejects it with
 * its own error either way. It fails CLOSED only when App Check IS
 * configured and still cannot produce a real token, which is precisely the
 * degraded-reCAPTCHA case the placeholder was invented for.
 *
 * @param {object} opts
 * @param {(forceRefresh:boolean) => Promise<string>} opts.mintToken
 *   Mints an App Check token. `forceRefresh` bypasses the SDK's cache.
 * @param {string} opts.placeholderToken The fail-open sentinel to detect.
 * @param {boolean} [opts.configured=true] Whether App Check initialised.
 * @returns {Promise<{ok: boolean, reason: string}>} Never rejects.
 */
export async function resolveWriteAttestation({
  mintToken,
  placeholderToken,
  configured = true,
} = {}) {
  if (!configured || typeof mintToken !== 'function') {
    return { ok: true, reason: WRITE_UNCONFIGURED }
  }

  const isReal = (token) => Boolean(token) && token !== placeholderToken

  try {
    // First attempt uses the SDK's cache — the overwhelmingly common path,
    // where a real token is already in hand and this costs nothing.
    if (isReal(await mintToken(false))) {
      return { ok: true, reason: WRITE_ATTESTED }
    }
    // A cached placeholder would otherwise persist for its whole TTL. One
    // forced refresh re-enters the provider, which is enough to recover as
    // soon as reCAPTCHA is healthy again rather than a minute later.
    if (isReal(await mintToken(true))) {
      return { ok: true, reason: WRITE_ATTESTED }
    }
    return { ok: false, reason: WRITE_PLACEHOLDER }
  } catch {
    // resilientGetToken never rejects, so reaching here means the SDK itself
    // failed. Same user-visible outcome: refuse, and invite a retry.
    return { ok: false, reason: WRITE_ERROR }
  }
}
