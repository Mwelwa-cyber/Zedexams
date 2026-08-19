/**
 * Was the persisted session REJECTED by the server, or did the check simply
 * fail to complete?
 *
 * ## The bug this answers
 *
 * On every cold start the Firebase Auth SDK re-verifies the persisted user
 * before it will hand it back:
 *
 *   async reloadAndSetCurrentUserOrClear(user) {
 *     try { await _reloadWithoutSaving(user) }
 *     catch (e) {
 *       if (e?.code !== 'auth/network-request-failed') {
 *         return this.directlySetCurrentUser(null)   // ← deletes the session
 *       }
 *     }
 *     return this.directlySetCurrentUser(user)
 *   }
 *
 * `_reloadWithoutSaving` refreshes the ID token (`securetoken.googleapis.com`)
 * and looks the account up (`identitytoolkit.googleapis.com/v1/accounts:lookup`).
 * Exactly ONE error code is treated as survivable —
 * `auth/network-request-failed`, which the SDK raises only when the `fetch`
 * itself rejects. Every other outcome deletes the stored user from IndexedDB,
 * permanently, before `onAuthStateChanged` has fired even once.
 *
 * So a request that REACHES Google and comes back unhappy ends the session:
 *
 *   • 429 / `TOO_MANY_ATTEMPTS_TRY_LATER` — a per-project rate limit
 *   • 5xx — an Identity Platform blip
 *   • 403 / 401 — App Check enforcement, a quota rule, an API-key restriction
 *   • a 200 whose `users` array is empty → `auth/internal-error`
 *   • any server error string the SDK has no mapping for
 *
 * None of those is a statement about the credential, and all of them are
 * transient and project-wide — which is exactly the reported shape of the bug:
 * every reload signs the user out, for admins, teachers and learners at once,
 * and a session left alone drops on its own when the next refresh lands in the
 * bad window.
 *
 * The app already has a carefully-argued policy for this question
 * (`hooks/authInitRetryPolicy.js`: "network failures, rate limits, timeouts…
 * keep the stored user and retry"), and it never gets to run, because the SDK
 * has already destroyed the session by the time the app is told anything.
 *
 * ## What this module does
 *
 * It classifies the ONE network exchange that decides the question, so the
 * removal can be judged instead of obeyed. Pure and DOM-free: the whole fix
 * turns on getting this classification right, and it should be testable
 * without a browser, a Firebase app, or a network.
 *
 * The bias is the same one the retry ladder already argues for: **unknown is
 * not dead**. A verdict we cannot positively read as "the server rejected this
 * credential" keeps the session, because the cost of guessing wrong in that
 * direction is one stale blob, and the cost of guessing wrong in the other is
 * a logout of a working account.
 */

/** The check completed and the server was happy. */
export const OK = 'ok'
/** The server ruled on the CREDENTIAL: it is genuinely no good. */
export const TERMINAL = 'terminal'
/** The check did not complete, or failed for a reason about the trip. */
export const INFRASTRUCTURAL = 'infrastructural'

/**
 * The two Google endpoints `_reloadWithoutSaving` goes through. Matched on
 * path as well as host so an unrelated call to the same host (the SDK makes
 * several — `accounts:sendOobCode`, `accounts:signInWithPassword`, …) is not
 * mistaken for the boot check.
 */
const VERIFICATION_PATTERNS = [
  // Token refresh. Its failure modes are the same shape and it runs first.
  /^https:\/\/securetoken\.googleapis\.com\/v1\/token(\?|$)/,
  // The account lookup the reload is actually built on.
  /^https:\/\/(?:[a-z0-9-]+-)?identitytoolkit\.googleapis\.com\/v1\/accounts:lookup(\?|$)/,
]

/**
 * Is this the request whose answer decides whether the stored session lives?
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isSessionVerificationUrl(url) {
  if (typeof url !== 'string' || !url) return false
  return VERIFICATION_PATTERNS.some((re) => re.test(url))
}

/**
 * Server error strings that are a verdict on the credential itself.
 *
 * Every one of these means asking again would re-ask a question the server has
 * already answered. Anything NOT here — including anything unrecognised — is
 * treated as a failed trip, not a dead session.
 */
export const TERMINAL_SERVER_ERRORS = Object.freeze([
  'TOKEN_EXPIRED',
  'USER_DISABLED',
  'USER_NOT_FOUND',
  'INVALID_ID_TOKEN',
  'INVALID_REFRESH_TOKEN',
  'MISSING_REFRESH_TOKEN',
  'INVALID_GRANT_TYPE',
  'CREDENTIAL_TOO_OLD_LOGIN_AGAIN',
])

const TERMINAL_SERVER_ERROR_SET = new Set(TERMINAL_SERVER_ERRORS)

/**
 * Pull the server's error token out of an Identity Platform error body.
 *
 * Both endpoints answer with `{"error": {"message": "TOKEN_EXPIRED : extra"}}`,
 * and the SDK itself splits on `' : '` before mapping — so we split the same
 * way rather than matching the whole string.
 *
 * @param {unknown} body Parsed JSON body, or anything at all.
 * @returns {string} The bare error token, or '' when there isn't one.
 */
export function readServerErrorCode(body) {
  const message = body?.error?.message ?? body?.errorMessage
  if (typeof message !== 'string') return ''
  return message.split(' : ')[0].trim()
}

/**
 * Classify the response to a session-verification request.
 *
 * @param {object} exchange
 * @param {number} [exchange.status] HTTP status. Omit for "never got one".
 * @param {unknown} [exchange.body]  Parsed JSON body, when we could read one.
 * @returns {'ok'|'terminal'|'infrastructural'}
 */
export function classifyVerificationResponse({ status, body } = {}) {
  // A 2xx that still carries an `errorMessage` is an error — the SDK checks
  // for exactly that, and so must we, or a rejected credential reads as fine.
  const serverCode = readServerErrorCode(body)
  if (typeof status === 'number' && status >= 200 && status < 300 && !serverCode) {
    return OK
  }
  // The server ruled on the credential. This is the only path that ends a
  // session, and it requires a code we recognise — never a bare status.
  if (TERMINAL_SERVER_ERROR_SET.has(serverCode)) return TERMINAL
  // Everything else describes the trip: a rate limit, a quota, an attestation
  // refusal, a backend blip, an unmapped string, or no response at all.
  return INFRASTRUCTURAL
}

/**
 * Should a removal of the stored session be REFUSED?
 *
 * Called on the SDK's own `_remove` of the persisted-user key. Every argument
 * has to hold, and each rules out a case where removing really is correct:
 *
 * @param {object} state
 * @param {boolean} state.armed    Is initialisation still in flight? After the
 *   first auth event, a removal is an ordinary sign-out and never ours to
 *   second-guess.
 * @param {boolean} state.isSessionKey Is this the persisted-user record, as
 *   opposed to the redirect user or a persistence-type marker?
 * @param {boolean} state.hasHint  Did this device have a signed-in session? A
 *   device with no hint has nothing to rescue, and an unreadable blob there
 *   should be allowed to clear.
 * @param {string|null} state.verdict The classification above, or null when no
 *   verification request was observed at all.
 * @returns {boolean} true → keep the stored session.
 */
export function shouldPreserveStoredSession({ armed, isSessionKey, hasHint, verdict }) {
  if (!armed) return false
  if (!isSessionKey) return false
  if (!hasHint) return false
  // The one case where the removal is right. Note that `null` (we never saw
  // the exchange) and `OK` (the call succeeded and the SDK still gave up —
  // an empty `users` array, i.e. `auth/internal-error`) both fall through to
  // "keep": neither is the server rejecting this credential.
  if (verdict === TERMINAL) return false
  return true
}
