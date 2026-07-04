/**
 * src/firebase/appCheckResilient.js
 *
 * Pure, framework-free core for a fail-open App Check token path. Deliberately
 * firebase-free so it unit-tests under plain `node` (see the sibling
 * appCheckResilient.test.js) without dragging the browser SDK into the runner.
 *
 * WHY THIS EXISTS — the sign-in outage of 2026-07-01:
 * Firebase attaches an App Check token to EVERY Auth + Firestore request, even
 * when App Check is only in **Monitoring** mode (the token is collected and
 * logged server-side, never used to reject). The reCAPTCHA provider that
 * mints those tokens (v3 at the time of the outage, now reCAPTCHA Enterprise) can:
 *   • crash — "reCAPTCHA placeholder element must be empty" on a redundant
 *     render (bfcache restore / a second render), or
 *   • hang — "reCAPTCHA Timeout" on a flaky connection to Google's reCAPTCHA.
 * When it does, `getToken()` never resolves, so the Auth / Firestore request
 * that is waiting on the token stalls — surfacing to the user as
 * `auth/network-request-failed` and Firestore "backend didn't respond within
 * 10 seconds". Because it depends only on reCAPTCHA breaking (not on the user's
 * network or on enforcement), it hit MANY users across networks at once.
 *
 * The fix: RACE the real token fetch against a short timeout and NEVER reject.
 * On crash / hang / empty result we yield a short-lived placeholder token so the
 * request proceeds immediately instead of stalling. This is harmless for the
 * Monitoring-only products (Auth / Firestore / Storage) — a placeholder token is
 * logged exactly like a missing one. The enforced products (Firebase AI Logic)
 * simply keep failing while reCAPTCHA is down, which is already what happens
 * today — no regression, and sign-in is never held hostage again. When reCAPTCHA
 * is healthy the real token flows through unchanged.
 */

// How long to wait for a real reCAPTCHA token before proceeding without one.
// Comfortably shorter than Firestore's 10s connection watchdog so the request
// is never the thing that trips it.
export const APPCHECK_TOKEN_TIMEOUT_MS = 5000

// Placeholder lifetime. Short so the SDK re-requests a *real* token soon after
// reCAPTCHA recovers, restoring proper attestation for the enforced products.
export const APPCHECK_PLACEHOLDER_TTL_MS = 60_000

// Deliberately not a real token — the Monitoring-only backends log it like a
// missing token; the enforced backends reject it (already the case when
// reCAPTCHA is down). Named so it's obvious in a server log what happened.
export const APPCHECK_PLACEHOLDER_TOKEN = 'appcheck-recaptcha-unavailable'

/** A fresh, short-lived placeholder App Check token. */
export function makePlaceholderToken(now = Date.now) {
  return {
    token: APPCHECK_PLACEHOLDER_TOKEN,
    expireTimeMillis: now() + APPCHECK_PLACEHOLDER_TTL_MS,
  }
}

/**
 * Run `innerGetToken` (the real reCAPTCHA provider's getToken) but never let it
 * block: if it throws, resolves empty, or takes longer than `timeoutMs`, resolve
 * with a placeholder token instead. Always resolves — never rejects — so the
 * App Check machinery (and therefore Auth / Firestore) can't stall on it.
 *
 * Timer + clock are injectable so the timeout path is deterministically testable
 * under plain `node` with no real delay.
 *
 * @param {() => Promise<{token:string, expireTimeMillis:number}>} innerGetToken
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {() => number} [opts.now]
 * @param {(fn:Function, ms:number)=>any} [opts.setTimer]
 * @param {(handle:any)=>void} [opts.clearTimer]
 * @returns {Promise<{token:string, expireTimeMillis:number}>}
 */
export async function resilientGetToken(innerGetToken, {
  timeoutMs = APPCHECK_TOKEN_TIMEOUT_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const placeholder = makePlaceholderToken(now)
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve(placeholder), timeoutMs)
  })
  try {
    // `Promise.resolve().then(innerGetToken)` so a synchronous throw inside the
    // provider is turned into a rejection we can catch (not an uncaught throw).
    const real = Promise.resolve()
      .then(innerGetToken)
      .then((res) => (res && res.token ? res : placeholder))
      .catch(() => placeholder)
    return await Promise.race([real, timeout])
  } finally {
    clearTimer(timer)
  }
}
