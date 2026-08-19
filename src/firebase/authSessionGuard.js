/**
 * Stop the Firebase Auth SDK deleting a working session at boot because the
 * one request that verifies it did not come back cleanly.
 *
 * Read `./authBootVerdict.js` first — it states the failure and owns the
 * classification. This module is the mechanism: it watches for the verdict and
 * refuses the removal that follows a non-terminal one.
 *
 * ## Two patches, one window
 *
 * 1. **A fetch observer.** The SDK resolves `self.fetch` lazily, at call time
 *    (`FetchProvider.fetch()`), so wrapping `window.fetch` after the SDK module
 *    has loaded is still seen by it. The wrapper delegates unconditionally and
 *    only *looks* at responses to the two verification endpoints, on a clone,
 *    so it can neither change a request nor consume a body the SDK needs.
 *
 * 2. **A `_remove` guard** on the persistence classes. `directlySetCurrentUser
 *    (null)` reaches storage through `PersistenceUserManager.removeCurrentUser()`
 *    → `persistence._remove(fullUserKey)`. When the verdict says the server
 *    never rejected this credential, that call becomes a no-op and the blob
 *    survives to be tried again.
 *
 * Both are live only during the **boot window** — from module load to the
 * first `onAuthStateChanged`. That bound is what keeps this narrow rather than
 * ambient: after it, ordinary sign-outs, another tab signing out, and account
 * deletion all clear storage exactly as they do today, and `window.fetch` is
 * the browser's own function again.
 *
 * ## What refusing a removal does NOT do
 *
 * It does not put the user back. The SDK's in-memory `currentUser` is already
 * null and this page load will report signed out. What it buys is that the
 * SESSION still exists to be recovered — `AuthContext` reads
 * `wasSessionPreserved()` on that first null event and re-drives initialisation
 * once, which is the only way to make the SDK read the blob again. If the
 * condition has passed, the user lands back where they were and never sees
 * /login. If it has not, they sign in — which is exactly today's behaviour. The
 * worst case is the status quo; that property is deliberate.
 */

import {
  INFRASTRUCTURAL,
  classifyVerificationResponse,
  isSessionVerificationUrl,
  shouldPreserveStoredSession,
} from './authBootVerdict.js'
import { hasAuthSessionHint } from './authSessionHint.js'

/** Marker so a re-import (HMR, a second call) never double-patches. */
export const GUARDED_FLAG = '__zedexamsSessionGuarded'

/**
 * The SDK's persisted-user key is `firebase:authUser:{apiKey}:{appName}`.
 * Matched by prefix so the redirect user (`firebase:redirectUser:…`) and the
 * persistence-type marker (`firebase:persistence:…`) are left alone — clearing
 * either of those is routine and unrelated.
 */
const SESSION_KEY_PREFIX = 'firebase:authUser:'

/** @param {string} key */
export function isPersistedSessionKey(key) {
  return typeof key === 'string' && key.startsWith(SESSION_KEY_PREFIX)
}

// ── Boot-window state ──────────────────────────────────────────────────────
// Module-level rather than per-instance: there is exactly one boot window per
// page, and the fetch observer and the `_remove` guard have to read the same
// verdict.
let armed = false
let verdict = null
let preserved = false
let preservedKey = null
let restoreFetch = null

/**
 * The classification of the last session-verification exchange, or null when
 * none was observed.
 *
 * @returns {'ok'|'terminal'|'infrastructural'|null}
 */
export function getBootVerdict() {
  return verdict
}

/**
 * Did the guard refuse to delete the stored session?
 *
 * True means: the SDK gave up on the persisted user, and the reason was not
 * the server rejecting it. The session is still on disk.
 *
 * @returns {boolean}
 */
export function wasSessionPreserved() {
  return preserved
}

/**
 * End the boot window, and hand back what happened during it.
 *
 * Called from the first `onAuthStateChanged`, after which a removal is an
 * ordinary sign-out. Restores `window.fetch` if — and only if — the wrapper we
 * installed is still the current one, so a later wrapper (Sentry, a browser
 * extension, a future instrumentation) is never clobbered by our teardown.
 *
 * **Returns the outcome and CLEARS it**, rather than leaving it readable, and
 * that is a correctness requirement rather than tidiness. `onAuthStateChanged`
 * fires on every sign-in and sign-out for the life of the page; a `preserved`
 * flag left standing would still be true when the user later taps "Log out",
 * and the caller would answer a deliberate sign-out by reloading the page and
 * restoring the session. Reading it exactly once, at the moment the window
 * closes, makes that impossible by construction.
 *
 * Idempotent: a second call reports no rescue, because there was not a second
 * one.
 *
 * @returns {{preserved: boolean, verdict: string|null}}
 */
export function disarmAuthSessionGuard() {
  armed = false
  if (restoreFetch) {
    try { restoreFetch() } catch { /* teardown is best-effort */ }
    restoreFetch = null
  }
  const outcome = { preserved, verdict }
  preserved = false
  preservedKey = null
  verdict = null
  return outcome
}

/**
 * Reset every module-level flag. Tests only — production has one boot window
 * per page and nothing to reset.
 */
export function __resetAuthSessionGuardForTests() {
  armed = false
  verdict = null
  preserved = false
  preservedKey = null
  restoreFetch = null
}

/**
 * Record what a verification exchange said. Exported so the observer's
 * behaviour is testable without a real `fetch` or `Response`.
 *
 * Only ever moves the verdict on a request we recognise, and the LAST such
 * exchange wins: the token refresh runs before the account lookup, and it is
 * the one that failed most recently that the SDK acted on.
 *
 * @param {string} url
 * @param {{status?: number, body?: unknown}|null} exchange Null = the request
 *   never produced a response (the fetch itself rejected). That is the case
 *   the SDK already survives, so it is recorded as infrastructural for
 *   completeness rather than because anything depends on it.
 */
export function recordVerificationExchange(url, exchange) {
  if (!isSessionVerificationUrl(url)) return
  verdict = exchange ? classifyVerificationResponse(exchange) : INFRASTRUCTURAL
}

/**
 * Decide, and record, what to do with a `_remove` of `key`.
 *
 * @param {string} key
 * @returns {boolean} true → the removal was refused.
 */
function refuseRemoval(key) {
  const keep = shouldPreserveStoredSession({
    armed,
    isSessionKey: isPersistedSessionKey(key),
    hasHint: hasAuthSessionHint(),
    verdict,
  })
  if (!keep) return false
  preserved = true
  preservedKey = key
  console.warn(
    '[auth] refused to delete the stored session at boot — the account was never rejected',
    { verdict: verdict ?? 'not-observed' },
  )
  return true
}

/** The key whose removal was refused, for diagnostics. @returns {string|null} */
export function preservedSessionKey() {
  return preservedKey
}

/**
 * Read a verification response and record its verdict.
 *
 * Always reads a CLONE: a body can be consumed once, and the SDK needs the
 * original untouched. Never throws and is never awaited — an unreadable body
 * simply falls back to classifying on the status alone.
 *
 * @param {string} url
 * @param {Response} response
 */
async function observeResponse(url, response) {
  try {
    const body = await response.clone().json()
    recordVerificationExchange(url, { status: response.status, body })
  } catch {
    recordVerificationExchange(url, { status: response?.status })
  }
}

/**
 * Wrap `fetchTarget.fetch` so verification responses are classified.
 *
 * @param {{fetch: Function}} fetchTarget Usually `window`.
 * @returns {(() => void)|null} An undo, or null when there was nothing to wrap.
 */
export function installVerificationObserver(fetchTarget) {
  const original = fetchTarget?.fetch
  if (typeof original !== 'function') return null

  const observed = function observedFetch(input) {
    // Resolve the URL defensively: `input` is a string, a URL, or a Request,
    // and a throw here would take down every request on the page.
    let url = ''
    try {
      url = typeof input === 'string' ? input : (input?.url ?? String(input ?? ''))
    } catch { url = '' }

    const result = original.apply(this, arguments)
    if (!armed || !isSessionVerificationUrl(url)) return result

    return Promise.resolve(result).then(
      (response) => {
        // Fire-and-forget: the response is handed back unchanged and unawaited,
        // so nothing the observation does can delay or break the SDK's own read.
        void observeResponse(url, response)
        return response
      },
      (err) => {
        // The fetch itself rejected. The SDK maps this to
        // `auth/network-request-failed` and already keeps the session, so this
        // records the fact without changing anything.
        recordVerificationExchange(url, null)
        throw err
      },
    )
  }

  fetchTarget.fetch = observed
  return () => {
    if (fetchTarget.fetch === observed) fetchTarget.fetch = original
  }
}

/**
 * Patch one persistence class so `_remove` consults the guard.
 *
 * @param {Function} persistenceClass The exported `indexedDBLocalPersistence` /
 *   `browserLocalPersistence` (both are the CLASS; the SDK instantiates lazily).
 * @returns {boolean} whether the patch was applied now.
 */
export function guardPersistenceRemoval(persistenceClass) {
  const proto = persistenceClass?.prototype
  // Fail SAFE, not closed: an SDK that renamed `_remove` is left exactly as it
  // is rather than half-patched. The session is then no worse protected than
  // it is today.
  if (!proto) return false
  if (Object.prototype.hasOwnProperty.call(proto, GUARDED_FLAG)) return false
  if (typeof proto._remove !== 'function') return false

  const original = proto._remove
  proto._remove = function _remove(key) {
    if (refuseRemoval(key)) return Promise.resolve()
    return original.apply(this, arguments)
  }
  Object.defineProperty(proto, GUARDED_FLAG, { value: true, enumerable: false })
  return true
}

/**
 * Arm the guard. Call once, at module load, BEFORE `getAuth()` — the boot
 * window it protects opens the moment the SDK starts initialising.
 *
 * @param {object} opts
 * @param {Function[]} opts.persistences Persistence classes to guard.
 * @param {{fetch: Function}} [opts.fetchTarget] Defaults to `window`.
 * @returns {{armed: boolean, patched: number, observing: boolean}}
 */
export function installAuthSessionGuard({ persistences = [], fetchTarget } = {}) {
  armed = true
  verdict = null
  preserved = false
  preservedKey = null

  let patched = 0
  for (const persistence of persistences) {
    if (guardPersistenceRemoval(persistence)) patched += 1
  }

  const target = fetchTarget ?? (typeof window !== 'undefined' ? window : null)
  restoreFetch = target ? installVerificationObserver(target) : null

  return { armed, patched, observing: Boolean(restoreFetch) }
}
