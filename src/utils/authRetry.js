// Retry wrapper for Firebase Auth calls that fail with a *transient* network
// error. On Zambian mobile networks a full-signal phone still routinely drops
// or times out the single fetch Firebase Auth makes to
// identitytoolkit.googleapis.com — the SDK surfaces that as
// `auth/network-request-failed`, and today the user just sees a dead-end
// "Network error" with no second chance. A short automatic retry with
// exponential backoff turns most of those one-off drops into a successful
// sign-in without the user having to notice, retype anything, or tap again.
//
// Scope is deliberately narrow: ONLY `auth/network-request-failed` is retried.
// Wrong-password, too-many-requests, user-not-found, etc. are real answers from
// the server and must surface immediately — retrying them would waste the
// user's time and, for too-many-requests, make the rate-limit worse.
//
// Pure + timer-injectable so it unit-tests under plain `node` with a fake
// sleep (scripts/test-auth-retry.mjs) — no real delays, no Firebase.

export const RETRYABLE_AUTH_ERROR = 'auth/network-request-failed'
export const DEFAULT_RETRIES = 2
export const DEFAULT_BASE_DELAY_MS = 400

/** True only for the transient network failure we want to retry. */
export function isRetryableAuthError(err) {
  return err?.code === RETRYABLE_AUTH_ERROR
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run `fn` and, if it throws `auth/network-request-failed`, retry it up to
 * `retries` more times with exponential backoff (baseDelay, 2×baseDelay, …).
 * Any other error — and the final network failure once retries are exhausted —
 * is rethrown unchanged so the caller's normal error handling is untouched.
 *
 * With the defaults this makes at most 3 attempts and adds ~1.2 s of worst-case
 * latency before giving up, which stays well inside the login form's spinner.
 *
 * @template T
 * @param {() => Promise<T>} fn            the auth call to run (and maybe retry)
 * @param {object} [opts]
 * @param {number} [opts.retries]          extra attempts after the first (default 2)
 * @param {number} [opts.baseDelayMs]      first backoff delay in ms (default 400)
 * @param {(ms:number)=>Promise<void>} [opts.sleep]  injectable delay (tests)
 * @returns {Promise<T>}
 */
export async function retryOnNetworkError(fn, {
  retries = DEFAULT_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  sleep = defaultSleep,
} = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (!isRetryableAuthError(err) || attempt >= retries) throw err
      await sleep(baseDelayMs * 2 ** attempt)
      attempt++
    }
  }
}
