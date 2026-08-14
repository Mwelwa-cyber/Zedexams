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
  classifyStorageWriteRejection,
  storageWriteRejectionMessage,
  ATTESTATION_OK,
  ATTESTATION_BUILD_KEY_MISSING,
  ATTESTATION_INIT_FAILED,
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

  // ── classifying a refused write ────────────────────────────────────────
  // The gate fails OPEN when App Check was never configured, so that build's
  // uploads reach an ENFORCED bucket with no token and are refused as
  // `storage/unauthorized` — the same code a rules denial uses. These lock
  // the determination that tells the two apart, because getting it wrong is
  // what sends an admin who already has the role round the sign-out loop.
  console.log('\nappCheckWriteGate — an unattested build is not a permissions problem')
  {
    const appCheck = { native: false, recaptchaKeyConfigured: false, initialized: false }
    ok(
      'no build key + refused write reads as the missing key',
      classifyStorageWriteRejection({ code: 'storage/unauthorized', appCheck })
        === ATTESTATION_BUILD_KEY_MISSING,
    )
    const msg = storageWriteRejectionMessage({ code: 'storage/unauthorized', appCheck })
    ok('names the key that has to be set', /VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY/.test(msg))
    ok('says the account is NOT the problem', /not your account/i.test(msg))
    ok(
      'never sends the user round the sign-out-and-back-in loop',
      !/sign out|sign in again|verified email|needs the (admin|teacher)/i.test(msg),
    )
  }

  console.log('\nappCheckWriteGate — a key that is present but never initialised')
  {
    const appCheck = { native: false, recaptchaKeyConfigured: true, initialized: false }
    ok(
      'reads as a failed init, not a missing key',
      classifyStorageWriteRejection({ code: 'storage/unauthorized', appCheck })
        === ATTESTATION_INIT_FAILED,
    )
    const msg = storageWriteRejectionMessage({ code: 'storage/unauthorized', appCheck })
    ok('offers the action that actually helps', /reload/i.test(msg))
    ok('does not blame a deploy secret the admin already set', !/VITE_FIREBASE/.test(msg))
  }

  console.log('\nappCheckWriteGate — native attestation is Play Integrity, not reCAPTCHA')
  {
    // recaptchaKeyConfigured is meaningless on the Android wrapper, so a
    // missing web key must never be reported as the cause there.
    const appCheck = { native: true, recaptchaKeyConfigured: false, initialized: false }
    ok(
      'a native build never blames the web reCAPTCHA key',
      classifyStorageWriteRejection({ code: 'storage/unauthorized', appCheck })
        === ATTESTATION_INIT_FAILED,
    )
  }

  console.log('\nappCheckWriteGate — a genuine rules denial keeps its own wording')
  {
    ok(
      'App Check up + refused write is a real permissions denial',
      classifyStorageWriteRejection({
        code: 'storage/unauthorized',
        appCheck: { native: false, recaptchaKeyConfigured: true, initialized: true },
      }) === ATTESTATION_OK,
    )
    ok(
      'and yields no attestation message, so the caller keeps its own',
      storageWriteRejectionMessage({
        code: 'storage/unauthorized',
        appCheck: { recaptchaKeyConfigured: true, initialized: true },
      }) === null,
    )
    ok(
      'an unknown App Check state is never guessed at',
      classifyStorageWriteRejection({ code: 'storage/unauthorized' }) === ATTESTATION_OK,
    )
    ok(
      'a non-permission code is never re-diagnosed as attestation',
      classifyStorageWriteRejection({
        code: 'storage/quota-exceeded',
        appCheck: { initialized: false, recaptchaKeyConfigured: false },
      }) === ATTESTATION_OK,
    )
  }

  console.log(`\n✓ appCheckWriteGate: ${passed} assertions passed`)
}

run().catch((e) => { console.error(e); process.exit(1) })
