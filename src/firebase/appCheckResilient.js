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
 * Monitoring-only products (Auth / Firestore) — a placeholder token is logged
 * exactly like a missing one. The enforced products simply keep failing while
 * reCAPTCHA is down, which is already what happens today — no regression, and
 * sign-in is never held hostage again. When reCAPTCHA is healthy the real token
 * flows through unchanged.
 *
 * ⚠️ STORAGE IS NO LONGER MONITORING-ONLY (2026-08). App Check enforcement is
 * enabled on Cloud Storage, and an enforced bucket answers a request whose
 * token is absent or unrecognised with
 *   401 {"error":{"code":401,"message":"Firebase App Check token is invalid."}}
 * — so the placeholder below is REJECTED there rather than logged, and because
 * the SDK caches it for the full TTL a single stall would refuse every upload
 * for a minute. Storage READS are unaffected (a download URL carrying a valid
 * download token serves without App Check being consulted). Storage WRITES must
 * therefore go through the gate in appCheckWriteGate.js — do not spend a
 * placeholder on one.
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

// ── Attestation health ───────────────────────────────────────────────────────
//
// Every failure below is swallowed by design — resilientGetToken never rejects.
// That is correct for the caller and terrible for observability: a reCAPTCHA
// that fails for 30% of learners looks identical, from every log and dashboard
// we have, to one that never fails at all. Sentry showed ONE reCAPTCHA timeout
// in 90 days while this path was silently issuing placeholders, because a
// swallowed failure is not an error anyone can see.
//
// So each placeholder records WHY, and leaves a timestamp other layers can ask
// about. The state lives here rather than in a sibling module because this is
// the only place that knows a placeholder was issued.

/** Why a placeholder was issued instead of a real token. */
export const PLACEHOLDER_REASONS = Object.freeze({
  TIMEOUT: 'timeout',   // reCAPTCHA did not answer within timeoutMs
  THREW: 'threw',       // the provider crashed
  EMPTY: 'empty',       // it resolved, with no token
})

let lastPlaceholderAt = 0
let lastPlaceholderReason = null
let placeholderCount = 0

/** Reset the recorded state. Tests only. */
export function resetAttestationState() {
  lastPlaceholderAt = 0
  lastPlaceholderReason = null
  placeholderCount = 0
}

/** Current attestation health, for diagnostics and telemetry. */
export function readAttestationState() {
  return { lastPlaceholderAt, lastPlaceholderReason, placeholderCount }
}

/**
 * Did attestation fail within the last `withinMs`?
 *
 * The window defaults to the placeholder's own TTL: while a placeholder is
 * still the token the SDK is sending, every enforced backend is rejecting us,
 * so any auth or data failure in that window is explained by attestation and
 * must not be read as a dead credential.
 *
 * @param {number} [withinMs]
 * @param {() => number} [now]
 * @returns {boolean}
 */
export function attestationDegraded(withinMs = APPCHECK_PLACEHOLDER_TTL_MS, now = Date.now) {
  if (!lastPlaceholderAt) return false
  return now() - lastPlaceholderAt <= withinMs
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
 * @param {(reason:string)=>void} [opts.onPlaceholder] Called when a placeholder is
 *   issued, with a PLACEHOLDER_REASONS value. Injected rather than imported so
 *   this module stays framework-free and node-testable.
 * @returns {Promise<{token:string, expireTimeMillis:number}>}
 */
export async function resilientGetToken(innerGetToken, {
  timeoutMs = APPCHECK_TOKEN_TIMEOUT_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onPlaceholder = null,
} = {}) {
  const placeholder = makePlaceholderToken(now)
  // Recorded at most once per call: a timeout that loses the race to a late
  // real token must not leave the state saying attestation was degraded.
  let recorded = false
  const issue = (reason) => {
    if (recorded) return placeholder
    recorded = true
    lastPlaceholderAt = now()
    lastPlaceholderReason = reason
    placeholderCount += 1
    // Never let a telemetry sink break the token path — that would reintroduce
    // exactly the stall this module exists to prevent.
    if (onPlaceholder) { try { onPlaceholder(reason) } catch { /* best effort */ } }
    return placeholder
  }
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve(issue(PLACEHOLDER_REASONS.TIMEOUT)), timeoutMs)
  })
  try {
    // `Promise.resolve().then(innerGetToken)` so a synchronous throw inside the
    // provider is turned into a rejection we can catch (not an uncaught throw).
    const real = Promise.resolve()
      .then(innerGetToken)
      .then((res) => (res && res.token ? res : issue(PLACEHOLDER_REASONS.EMPTY)))
      .catch(() => issue(PLACEHOLDER_REASONS.THREW))
    return await Promise.race([real, timeout])
  } finally {
    clearTimer(timer)
  }
}
