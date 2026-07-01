// Unit tests for the auth network-retry helper. Plain `node` script — no
// runner, throws on first failed assertion. A fake `sleep` keeps it instant
// and also lets us assert the exact backoff schedule.
//
//   node scripts/test-auth-retry.mjs
//   npm run test:auth-retry

import {
  retryOnNetworkError,
  isRetryableAuthError,
  RETRYABLE_AUTH_ERROR,
  DEFAULT_RETRIES,
  DEFAULT_BASE_DELAY_MS,
} from '../src/utils/authRetry.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

function netError() {
  const e = new Error('network')
  e.code = RETRYABLE_AUTH_ERROR
  return e
}
function authError(code) {
  const e = new Error(code)
  e.code = code
  return e
}

// Collect the delays instead of actually waiting.
function fakeSleeper() {
  const delays = []
  return { sleep: async (ms) => { delays.push(ms) }, delays }
}

async function run() {
  // — isRetryableAuthError only matches the network code —————————————————
  assert(isRetryableAuthError(netError()) === true, 'network error is retryable')
  assert(isRetryableAuthError(authError('auth/wrong-password')) === false, 'wrong-password is not retryable')
  assert(isRetryableAuthError(authError('auth/too-many-requests')) === false, 'too-many-requests is not retryable')
  assert(isRetryableAuthError(null) === false, 'null is not retryable')
  assert(isRetryableAuthError(undefined) === false, 'undefined is not retryable')
  assert(isRetryableAuthError({}) === false, 'codeless object is not retryable')

  // — Success on first try: fn called once, no sleeps ————————————————————
  {
    let calls = 0
    const { sleep, delays } = fakeSleeper()
    const out = await retryOnNetworkError(async () => { calls++; return 'ok' }, { sleep })
    assert(out === 'ok', 'returns the resolved value')
    assert(calls === 1, 'no retry when the first attempt succeeds')
    assert(delays.length === 0, 'no backoff sleep on immediate success')
  }

  // — Recovers on a later attempt: 2 network fails then success ——————————
  {
    let calls = 0
    const { sleep, delays } = fakeSleeper()
    const out = await retryOnNetworkError(async () => {
      calls++
      if (calls < 3) throw netError()
      return 'recovered'
    }, { sleep })
    assert(out === 'recovered', 'returns the value once a retry succeeds')
    assert(calls === 3, 'retried until the third attempt succeeded')
    assert(delays.length === 2, 'slept once before each of the two retries')
    assert(delays[0] === DEFAULT_BASE_DELAY_MS, 'first backoff is baseDelay')
    assert(delays[1] === DEFAULT_BASE_DELAY_MS * 2, 'second backoff doubles (exponential)')
  }

  // — Exhausts retries: rethrows the last network error ——————————————————
  {
    let calls = 0
    const { sleep, delays } = fakeSleeper()
    let thrown = null
    try {
      await retryOnNetworkError(async () => { calls++; throw netError() }, { sleep })
    } catch (e) { thrown = e }
    assert(thrown?.code === RETRYABLE_AUTH_ERROR, 'rethrows the network error after exhausting retries')
    assert(calls === DEFAULT_RETRIES + 1, 'made exactly retries+1 attempts')
    assert(delays.length === DEFAULT_RETRIES, 'slept once per retry')
  }

  // — Non-retryable error surfaces immediately: no retry, no sleep ————————
  {
    let calls = 0
    const { sleep, delays } = fakeSleeper()
    let thrown = null
    try {
      await retryOnNetworkError(async () => { calls++; throw authError('auth/wrong-password') }, { sleep })
    } catch (e) { thrown = e }
    assert(thrown?.code === 'auth/wrong-password', 'rethrows a wrong-password error unchanged')
    assert(calls === 1, 'a non-network error is never retried')
    assert(delays.length === 0, 'no backoff for a non-network error')
  }

  // — Honours a custom retry budget —————————————————————————————————————
  {
    let calls = 0
    const { sleep } = fakeSleeper()
    let thrown = null
    try {
      await retryOnNetworkError(async () => { calls++; throw netError() }, { sleep, retries: 4 })
    } catch (e) { thrown = e }
    assert(thrown?.code === RETRYABLE_AUTH_ERROR, 'still throws after a larger budget')
    assert(calls === 5, 'retries:4 → 5 total attempts')
  }

  console.log(`auth-retry helper: ${passed} assertions passed`)
}

run().catch((e) => { console.error(e); process.exit(1) })
