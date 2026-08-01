/**
 * Unit tests for the Storage write-time attestation gate
 * (src/firebase/appCheckWriteGate.js).
 *
 * Locks the contract that App Check enforcement on Cloud Storage created: the
 * fail-open placeholder from appCheckResilient.js keeps Auth / Firestore
 * moving, but must never be spent on a Storage WRITE, because an enforced
 * bucket answers an unrecognised token with
 * `401 Firebase App Check token is invalid.` and the SDK would cache that
 * placeholder for its whole 60s TTL. Pure module → runs under plain `node`.
 *
 * Run: node src/firebase/appCheckWriteGate.test.js  (npm run test:appcheck-write-gate)
 */
import assert from 'node:assert'
import {
  resolveWriteAttestation,
  WRITE_ATTESTED,
  WRITE_UNCONFIGURED,
  WRITE_PLACEHOLDER,
  WRITE_ERROR,
  WRITE_BLOCKED_MESSAGE,
} from './appCheckWriteGate.js'

const PLACEHOLDER = 'appcheck-recaptcha-unavailable'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// Mints `queue` in order, recording the forceRefresh flag of every call.
function minter(queue) {
  const calls = []
  return {
    calls,
    mintToken: async (forceRefresh) => {
      calls.push(forceRefresh)
      if (!queue.length) throw new Error('minter exhausted')
      return queue.shift()
    },
  }
}

async function run() {
  console.log('\nappCheckWriteGate — the healthy path costs nothing')
  {
    const m = minter(['real-token'])
    const res = await resolveWriteAttestation({
      mintToken: m.mintToken,
      placeholderToken: PLACEHOLDER,
    })
    ok('a real cached token allows the write', res.ok === true)
    ok('reason is "attested"', res.reason === WRITE_ATTESTED)
    ok('exactly one mint — no gratuitous refresh', m.calls.length === 1)
    ok('the first mint uses the SDK cache', m.calls[0] === false)
  }

  console.log('\nappCheckWriteGate — a cached placeholder is refreshed, not spent')
  {
    const m = minter([PLACEHOLDER, 'real-token'])
    const res = await resolveWriteAttestation({
      mintToken: m.mintToken,
      placeholderToken: PLACEHOLDER,
    })
    ok('recovers once reCAPTCHA is healthy again', res.ok === true)
    ok('reason is "attested"', res.reason === WRITE_ATTESTED)
    ok('spent exactly one forced refresh', m.calls.length === 2 && m.calls[1] === true)
  }

  console.log('\nappCheckWriteGate — a sustained outage refuses the write')
  {
    const m = minter([PLACEHOLDER, PLACEHOLDER])
    const res = await resolveWriteAttestation({
      mintToken: m.mintToken,
      placeholderToken: PLACEHOLDER,
    })
    ok('refuses rather than issuing a doomed upload', res.ok === false)
    ok('reason names the placeholder', res.reason === WRITE_PLACEHOLDER)
    ok('does not retry forever (bounded at 2 mints)', m.calls.length === 2)
  }

  console.log('\nappCheckWriteGate — an empty token is not a real token')
  {
    for (const empty of ['', null, undefined]) {
      const res = await resolveWriteAttestation({
        mintToken: minter([empty, empty]).mintToken,
        placeholderToken: PLACEHOLDER,
      })
      ok(`${JSON.stringify(empty)} is refused like a placeholder`, res.ok === false)
    }
  }

  console.log('\nappCheckWriteGate — fails OPEN when App Check is not configured')
  {
    const res = await resolveWriteAttestation({
      mintToken: async () => PLACEHOLDER,
      placeholderToken: PLACEHOLDER,
      configured: false,
    })
    ok('an unconfigured build is not blocked client-side', res.ok === true)
    ok('reason is "unconfigured"', res.reason === WRITE_UNCONFIGURED)
  }
  {
    const res = await resolveWriteAttestation({})
    ok('a missing minter is treated as unconfigured, not as failure', res.ok === true)
    ok('reason is "unconfigured"', res.reason === WRITE_UNCONFIGURED)
  }

  console.log('\nappCheckWriteGate — a throwing SDK is refused, never propagated')
  {
    const res = await resolveWriteAttestation({
      mintToken: async () => { throw new Error('SDK exploded') },
      placeholderToken: PLACEHOLDER,
    })
    ok('never rejects', res.ok === false)
    ok('reason is "error"', res.reason === WRITE_ERROR)
  }

  console.log('\nappCheckWriteGate — the user-facing message')
  {
    ok('invites a retry', /try .*again/i.test(WRITE_BLOCKED_MESSAGE))
    ok(
      'does not claim the user lacks permission',
      !/permission|not allowed|unauthori[sz]ed|forbidden/i.test(WRITE_BLOCKED_MESSAGE),
    )
  }

  console.log(`\n✓ appCheckWriteGate: ${passed} assertions passed`)
}

run().catch((e) => { console.error(e); process.exit(1) })
