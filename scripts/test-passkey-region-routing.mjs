// Plain-node tests for src/services/passkeyRegionCore.js — the pure region
// selection behind the staged us-central1 → africa-south1 passkey migration —
// plus the runnable mirror check against functions/passkeys/passkeyRegions.js
// (client and server must agree on regions, twin suffix, and which callables
// have twins). Run: node scripts/test-passkey-region-routing.mjs

import assert from 'node:assert'
import { createRequire } from 'node:module'
import {
  PASSKEY_PRIMARY_REGION,
  PASSKEY_REGIONAL_REGION,
  PASSKEY_REGIONAL_SUFFIX,
  PASSKEY_REGIONAL_CALLABLES,
  regionalCallableName,
  sanitizeRegionHint,
  resolvePasskeyFunctionsRegion,
  regionHintAfterAuth,
  shouldFallbackToPrimary,
} from '../src/services/passkeyRegionCore.js'

const require = createRequire(import.meta.url)
const server = require('../functions/passkeys/passkeyRegions.js')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

const TEACHER = 'testTeacherUid001'
const OTHER = 'someOtherUid00002'
const pilotFlags = {
  passkeyFunctionsRegion: { mode: 'pilot', pilotUids: [TEACHER] },
}

// ── Default + rollback: everything unknown resolves to us-central1 ────────
for (const [label, featureFlags] of [
  ['no flags at all', undefined],
  ['empty flags', {}],
  ['flag explicitly off', { passkeyFunctionsRegion: { mode: 'off' } }],
  ['unknown mode', { passkeyFunctionsRegion: { mode: 'sprint' } }],
  ['config is a string', { passkeyFunctionsRegion: 'africa-south1' }],
  ['config is an array', { passkeyFunctionsRegion: ['africa-south1'] }],
  ['config missing mode', { passkeyFunctionsRegion: { pilotUids: [TEACHER] } }],
]) {
  const { region } = resolvePasskeyFunctionsRegion({ featureFlags, uid: TEACHER })
  ok(`${label} → us-central1`, region === PASSKEY_PRIMARY_REGION)
}

// Rollback switching: identical caller, flag flipped all → off re-routes.
{
  const before = resolvePasskeyFunctionsRegion({
    featureFlags: { passkeyFunctionsRegion: { mode: 'all' } }, uid: OTHER,
  })
  const after = resolvePasskeyFunctionsRegion({
    featureFlags: { passkeyFunctionsRegion: { mode: 'off' } }, uid: OTHER,
  })
  ok('mode all routes regionally', before.region === PASSKEY_REGIONAL_REGION && before.source === 'all')
  ok('rollback flag flip re-routes to us-central1 with no redeploy',
    after.region === PASSKEY_PRIMARY_REGION)
}

// ── Pilot allow-listing (the approved test teacher only) ──────────────────
{
  const teacher = resolvePasskeyFunctionsRegion({ featureFlags: pilotFlags, uid: TEACHER })
  ok('pilot: the allow-listed test teacher routes to africa-south1',
    teacher.region === PASSKEY_REGIONAL_REGION && teacher.source === 'pilot-uid')

  const other = resolvePasskeyFunctionsRegion({ featureFlags: pilotFlags, uid: OTHER })
  ok('pilot: every other authenticated user stays on us-central1',
    other.region === PASSKEY_PRIMARY_REGION && other.source === 'not-in-pilot')

  // Pre-auth sign-in: no uid yet — only a previously-primed device hint routes.
  const hinted = resolvePasskeyFunctionsRegion({
    featureFlags: pilotFlags, uid: null, deviceHint: PASSKEY_REGIONAL_REGION,
  })
  ok('pilot: pre-auth sign-in on a primed pilot device routes regionally',
    hinted.region === PASSKEY_REGIONAL_REGION && hinted.source === 'device-hint')

  const unhinted = resolvePasskeyFunctionsRegion({ featureFlags: pilotFlags, uid: null })
  ok('pilot: pre-auth sign-in on any other device stays on us-central1',
    unhinted.region === PASSKEY_PRIMARY_REGION)

  const tampered = resolvePasskeyFunctionsRegion({
    featureFlags: pilotFlags, uid: null, deviceHint: 'evil-region',
  })
  ok('pilot: a tampered device hint is ignored', tampered.region === PASSKEY_PRIMARY_REGION)

  // A signed-in NON-pilot user on a primed device must not ride the hint —
  // the uid decision always wins once the uid is known.
  const nonPilotOnPrimedDevice = resolvePasskeyFunctionsRegion({
    featureFlags: pilotFlags, uid: OTHER, deviceHint: PASSKEY_REGIONAL_REGION,
  })
  ok('pilot: the device hint never overrides a known non-pilot uid',
    nonPilotOnPrimedDevice.region === PASSKEY_PRIMARY_REGION)

  // The hint only applies while the flag still says pilot — flag off means
  // a stale hint routes nowhere.
  const staleHint = resolvePasskeyFunctionsRegion({
    featureFlags: {}, uid: null, deviceHint: PASSKEY_REGIONAL_REGION,
  })
  ok('a stale device hint is inert once the flag is off',
    staleHint.region === PASSKEY_PRIMARY_REGION)
}

// ── Hint lifecycle ────────────────────────────────────────────────────────
ok('sanitizeRegionHint accepts only the exact regional name',
  sanitizeRegionHint(PASSKEY_REGIONAL_REGION) === PASSKEY_REGIONAL_REGION &&
  sanitizeRegionHint('africa-south1 ') === null &&
  sanitizeRegionHint('us-central1') === null &&
  sanitizeRegionHint(null) === null)
ok('post-auth hint is set for a pilot uid',
  regionHintAfterAuth({ featureFlags: pilotFlags, uid: TEACHER }) === PASSKEY_REGIONAL_REGION)
ok('post-auth hint is cleared for a non-pilot uid',
  regionHintAfterAuth({ featureFlags: pilotFlags, uid: OTHER }) === null)
ok('post-auth hint is cleared after rollback (mode off)',
  regionHintAfterAuth({
    featureFlags: { passkeyFunctionsRegion: { mode: 'off' } }, uid: TEACHER,
  }) === null)

// ── Fallback policy (narrow by design) ────────────────────────────────────
ok('options phase falls back on not-found and unavailable',
  shouldFallbackToPrimary({ code: 'functions/not-found', phase: 'options' }) &&
  shouldFallbackToPrimary({ code: 'functions/unavailable', phase: 'options' }))
ok('options phase never falls back on ambiguous failures',
  !shouldFallbackToPrimary({ code: 'functions/internal', phase: 'options' }) &&
  !shouldFallbackToPrimary({ code: 'functions/deadline-exceeded', phase: 'options' }))
ok('verify phase falls back ONLY when the callable is absent',
  shouldFallbackToPrimary({ code: 'functions/not-found', phase: 'verify' }) &&
  !shouldFallbackToPrimary({ code: 'functions/unavailable', phase: 'verify' }) &&
  !shouldFallbackToPrimary({ code: 'functions/internal', phase: 'verify' }) &&
  !shouldFallbackToPrimary({ code: 'functions/deadline-exceeded', phase: 'verify' }))

// ── Client ⇄ server mirror ────────────────────────────────────────────────
ok('primary region mirrors the server registry',
  PASSKEY_PRIMARY_REGION === server.PASSKEY_PRIMARY_REGION)
ok('regional region mirrors the server registry',
  PASSKEY_REGIONAL_REGION === server.PASSKEY_REGIONAL_REGION)
ok('twin suffix mirrors the server registry',
  PASSKEY_REGIONAL_SUFFIX === server.PASSKEY_REGIONAL_SUFFIX)
ok('the set of twinned callables mirrors the server registry',
  JSON.stringify([...PASSKEY_REGIONAL_CALLABLES]) ===
  JSON.stringify([...server.PASSKEY_REGIONAL_CALLABLES]))
for (const base of PASSKEY_REGIONAL_CALLABLES) {
  ok(`twin name for ${base} matches the server export name`,
    regionalCallableName(base) === server.regionalExportName(base))
}

console.log(`\npasskey-region-routing: ${passed} tests passed`)
