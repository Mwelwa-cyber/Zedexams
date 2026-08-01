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
