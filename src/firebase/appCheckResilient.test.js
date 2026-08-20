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
  APPCHECK_PLACEHOLDER_TTL_MS,
  PLACEHOLDER_REASONS,
  attestationDegraded,
  readAttestationState,
  resetAttestationState,
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

  // ── Attestation health ───────────────────────────────────────────────────────
  //
  // The point of these: a swallowed failure that nothing records is invisible,
  // and an invisible failure is what let F1 (the cold-load logout) run unmeasured.

  console.log('\nappCheckResilient — a placeholder records WHY, and is observable')

  for (const [label, provider, expected] of [
    ['a throwing provider', () => { throw new Error('reCAPTCHA crashed') }, PLACEHOLDER_REASONS.THREW],
    ['an empty result', async () => ({ token: '' }), PLACEHOLDER_REASONS.EMPTY],
  ]) {
    resetAttestationState()
    const seen = []
    const res = await resilientGetToken(provider, { onPlaceholder: (r) => seen.push(r) })
    ok(`${label} → placeholder`, res.token === APPCHECK_PLACEHOLDER_TOKEN)
    ok(`${label} → reason "${expected}"`, readAttestationState().lastPlaceholderReason === expected)
    ok(`${label} → onPlaceholder called once`, seen.length === 1 && seen[0] === expected)
  }

  {
    resetAttestationState()
    const seen = []
    const t = fakeTimer()
    const pending = resilientGetToken(() => new Promise(() => {}), {
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
      onPlaceholder: (r) => seen.push(r),
    })
    t.fire()
    await pending
    ok('a hang records reason "timeout"', readAttestationState().lastPlaceholderReason === PLACEHOLDER_REASONS.TIMEOUT)
    ok('and reports it exactly once', seen.length === 1)
  }

  console.log('\nappCheckResilient — a HEALTHY provider records nothing')
  {
    resetAttestationState()
    const seen = []
    const good = { token: 'real-token', expireTimeMillis: Date.now() + 60_000 }
    const res = await resilientGetToken(async () => good, { onPlaceholder: (r) => seen.push(r) })
    ok('the real token passes through', res.token === 'real-token')
    ok('no placeholder recorded', readAttestationState().placeholderCount === 0)
    ok('onPlaceholder never fired', seen.length === 0)
    ok('attestation is not degraded', attestationDegraded() === false)
  }

  console.log('\nappCheckResilient — attestationDegraded is a WINDOW, not a latch')
  {
    resetAttestationState()
    ok('clean state is not degraded', attestationDegraded() === false)
    const clock = 1_000_000
    await resilientGetToken(() => { throw new Error('boom') }, { now: () => clock })
    ok('degraded immediately after a placeholder', attestationDegraded(APPCHECK_PLACEHOLDER_TTL_MS, () => clock) === true)
    ok('still degraded at the TTL boundary',
      attestationDegraded(APPCHECK_PLACEHOLDER_TTL_MS, () => clock + APPCHECK_PLACEHOLDER_TTL_MS) === true)
    ok('recovered once the placeholder has expired',
      attestationDegraded(APPCHECK_PLACEHOLDER_TTL_MS, () => clock + APPCHECK_PLACEHOLDER_TTL_MS + 1) === false)
  }

  console.log('\nappCheckResilient — a telemetry sink must never break the token path')
  {
    resetAttestationState()
    const res = await resilientGetToken(() => { throw new Error('boom') }, {
      onPlaceholder: () => { throw new Error('sentry is down') },
    })
    ok('a throwing sink still yields the placeholder', res.token === APPCHECK_PLACEHOLDER_TOKEN)
    ok('and the state is still recorded', readAttestationState().placeholderCount === 1)
  }

  console.log(`\n✓ appCheckResilient: ${passed} assertions passed`)
}

run().catch((e) => { console.error(e); process.exit(1) })
