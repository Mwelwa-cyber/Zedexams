/**
 * Unit tests for the fail-open App Check token path
 * (src/firebase/appCheckResilient.js).
 *
 * Locks the contract behind the 2026-07-01 sign-in outage: a crashed / hung /
 * empty reCAPTCHA token fetch must NEVER stall the caller — it resolves with a
 * placeholder so Auth / Firestore proceed. A healthy fetch passes through
 * untouched. Pure module → runs under plain `node`.
 *
 * Run: node src/firebase/appCheckResilient.test.js  (npm run test:appcheck-resilient)
 */
import assert from 'node:assert'
import {
  resilientGetToken,
  makePlaceholderToken,
  APPCHECK_PLACEHOLDER_TOKEN,
  APPCHECK_TOKEN_TIMEOUT_MS,
} from './appCheckResilient.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// A controllable fake timer so the timeout branch is deterministic (no real
// waiting). `fire()` invokes the pending timeout callback on demand.
function fakeTimer() {
  let cb = null
  let cleared = false
  return {
    setTimer: (fn) => { cb = fn; return 42 },
    clearTimer: (handle) => { cleared = handle === 42 },
    fire: () => cb && cb(),
    wasCleared: () => cleared,
  }
}

async function run() {
  console.log('appCheckResilient — healthy reCAPTCHA passes through')
  {
    const t = fakeTimer()
    const real = { token: 'real-token', expireTimeMillis: 9_999 }
    const res = await resilientGetToken(async () => real, { setTimer: t.setTimer, clearTimer: t.clearTimer })
    ok('returns the real token unchanged', res === real)
    ok('real token is not the placeholder', res.token !== APPCHECK_PLACEHOLDER_TOKEN)
    ok('timer cleared (no leak)', t.wasCleared())
  }

  console.log('\nappCheckResilient — a thrown provider degrades to placeholder')
  {
    const t = fakeTimer()
    const res = await resilientGetToken(() => { throw new Error('reCAPTCHA placeholder element must be empty') },
      { setTimer: t.setTimer, clearTimer: t.clearTimer })
    ok('synchronous throw → placeholder token', res.token === APPCHECK_PLACEHOLDER_TOKEN)
    ok('placeholder carries a future expiry', res.expireTimeMillis > 0)
  }

  console.log('\nappCheckResilient — a rejected provider degrades to placeholder')
  {
    const t = fakeTimer()
    const res = await resilientGetToken(async () => { throw new Error('reCAPTCHA Timeout') },
      { setTimer: t.setTimer, clearTimer: t.clearTimer })
    ok('async rejection → placeholder token', res.token === APPCHECK_PLACEHOLDER_TOKEN)
  }

  console.log('\nappCheckResilient — an empty/tokenless result degrades to placeholder')
  {
    const t = fakeTimer()
    const res = await resilientGetToken(async () => ({ token: '' }),
      { setTimer: t.setTimer, clearTimer: t.clearTimer })
    ok('empty token → placeholder token', res.token === APPCHECK_PLACEHOLDER_TOKEN)
  }

  console.log('\nappCheckResilient — a HANGING provider still resolves via the timeout')
  {
    const t = fakeTimer()
    // Inner promise never settles — the exact failure mode that stalled sign-in.
    const p = resilientGetToken(() => new Promise(() => {}),
      { setTimer: t.setTimer, clearTimer: t.clearTimer, now: () => 1_000 })
    t.fire() // trip the injected timeout
    const res = await p
    ok('hang → placeholder token (never stalls)', res.token === APPCHECK_PLACEHOLDER_TOKEN)
    ok('placeholder expiry uses the injected clock', res.expireTimeMillis === 1_000 + 60_000)
  }

  console.log('\nappCheckResilient — makePlaceholderToken shape')
  {
    const p = makePlaceholderToken(() => 0)
    ok('token is the named placeholder', p.token === APPCHECK_PLACEHOLDER_TOKEN)
    ok('default timeout constant is sane (< Firestore 10s watchdog)', APPCHECK_TOKEN_TIMEOUT_MS < 10_000)
  }

  console.log(`\n✓ appCheckResilient: ${passed} assertions passed`)
}

run().catch((e) => { console.error(e); process.exit(1) })
