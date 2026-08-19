/**
 * How many times, and how patiently, to re-drive a failed auth initialisation
 * before concluding the session is unrecoverable.
 *
 * ## Why a retry ladder and not a straight verdict
 *
 * The old path had two outcomes: reveal the app as signed out, or reload once.
 * Both are answers to "initialisation did not finish", and neither asks the
 * question that actually decides what to do — WHY it did not finish.
 *
 * A device holding `firebase:authUser:*` with a live refresh token has a real
 * session. If the token reload behind `initializeCurrentUser()` failed because
 * the link dropped, the radio was asleep, or the tab was throttled, the session
 * is fine and the correct move is to ask again in a moment. Treating that as a
 * dead session logs a learner out of a perfectly good account — the whole
 * incident this module exists for.
 *
 * Only three error codes mean the stored user is genuinely no good, and they
 * are the ones the server has ruled on. Everything else — network failures,
 * rate limits, timeouts, an unclassifiable throw, an initialisation that simply
 * never settled — keeps the stored user and retries.
 *
 * ## Termination
 *
 * The ladder is finite (three attempts, 1s → 3s → 8s, 12s of patience in
 * total) and every uncertainty resolves toward KEEPING the user. Running out
 * of attempts is not itself evidence that the session is dead; it only means
 * we could not confirm it here, so the last rung reports `wedged` and hands
 * over to the reload recovery rather than signing anyone out.
 */

/**
 * Backoff before attempts 1, 2 and 3 of the ladder, in milliseconds.
 *
 * Chosen against what actually recovers in this window: a dropped mobile
 * request retries fast, a sleeping radio needs a second or two, and a
 * background-throttled tab needs the better part of ten. Past ~12s a user is
 * looking at a loading screen and would rather have the reload.
 */
export const AUTH_INIT_RETRY_DELAYS_MS = Object.freeze([1000, 3000, 8000])

/**
 * The only errors that mean the STORED user must go.
 *
 * Each is a server verdict on the credential itself, so retrying re-asks a
 * question that has already been answered:
 *   • auth/user-token-expired  — the refresh token is past its life or revoked
 *   • auth/user-disabled       — an admin disabled the account
 *   • auth/invalid-user-token  — the token does not belong to this project
 *
 * Deliberately NOT here: `auth/network-request-failed`, `auth/timeout`,
 * `auth/too-many-requests`, `auth/internal-error`, and anything unrecognised.
 * Those describe the trip, not the credential.
 */
export const TERMINAL_AUTH_ERROR_CODES = Object.freeze([
  'auth/user-token-expired',
  'auth/user-disabled',
  'auth/invalid-user-token',
])

const TERMINAL_SET = new Set(TERMINAL_AUTH_ERROR_CODES)

/**
 * Does this error code mean the stored user should be cleared?
 *
 * Fails OPEN (keeps the user) for anything it does not recognise, including
 * `undefined` — an error we cannot classify is not evidence of a dead session,
 * and the cost of guessing wrong in that direction is a logout.
 *
 * @param {string|undefined|null} code
 * @returns {boolean}
 */
export function shouldClearStoredUser(code) {
  return TERMINAL_SET.has(code)
}

/** Retry: wait `delayMs`, then ask again. Session kept. */
export const RETRY = 'retry'
/** Terminal server verdict on the credential. Session cleared. */
export const CLEAR = 'clear'
/** Out of attempts with the session still unconfirmed. Session kept. */
export const WEDGED = 'wedged'

/**
 * Decide the next step of the ladder.
 *
 * @param {object}  state
 * @param {number}  state.attempt    0-based index of the attempt just finished.
 * @param {boolean} state.hasHint    This device is known to have had a session.
 * @param {string?} state.errorCode  Firebase error code, if the attempt threw one.
 * @param {number[]} [state.delays]  Override the ladder (tests).
 * @returns {{action: 'retry'|'clear'|'wedged', delayMs: number, attempt: number, keepsUser: boolean}}
 */
export function planAuthInitAttempt({ attempt, hasHint, errorCode, delays = AUTH_INIT_RETRY_DELAYS_MS }) {
  // A terminal code outranks the ladder: there is nothing left to retry, and
  // holding a revoked session on screen is worse than ending it cleanly.
  if (shouldClearStoredUser(errorCode)) {
    return { action: CLEAR, delayMs: 0, attempt, keepsUser: false }
  }
  // No hint means no session to rescue. Retrying would hold a signed-out
  // visitor on a loader for twelve seconds to confirm something already known.
  if (!hasHint) {
    return { action: WEDGED, delayMs: 0, attempt, keepsUser: true }
  }
  // Attempt 0 waits delays[0], attempt 1 waits delays[1], and so on; once the
  // ladder is exhausted there is no rung left to climb.
  if (attempt >= 0 && attempt < delays.length) {
    return { action: RETRY, delayMs: delays[attempt], attempt: attempt + 1, keepsUser: true }
  }
  return { action: WEDGED, delayMs: 0, attempt, keepsUser: true }
}

/**
 * Total time the ladder will spend before it can report `wedged`.
 * Exported so the restoration watchdog's own window can be reasoned about
 * against a number rather than a guess.
 */
export function totalRetryWindowMs(delays = AUTH_INIT_RETRY_DELAYS_MS) {
  return delays.reduce((sum, ms) => sum + ms, 0)
}
