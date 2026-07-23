// Pure region-selection logic for the passkey Cloud Functions' staged
// us-central1 → africa-south1 migration. No Firebase imports — tests under
// plain `node` (scripts/test-passkey-region-routing.mjs). The effectful
// wiring (flag snapshot, callable instances, fallback retries) lives in
// src/services/passkeyService.js, the ONE client entry point.
//
// MIRROR: the region constants + callable lists must match
// functions/passkeys/passkeyRegions.js exactly (the mirror is asserted by
// scripts/test-passkey-region-routing.mjs). Keep them in sync.
//
// Routing flag (settings/global.featureFlags.passkeyFunctionsRegion):
//   { mode: 'off' | 'pilot' | 'all', pilotUids: ['<uid>', ...] }
//   - absent / 'off' / any unknown shape → us-central1 (fail-safe default —
//     this is also the instant, no-redeploy rollback switch)
//   - 'pilot' → africa-south1 ONLY for the allow-listed uids (authenticated
//     flows), or pre-auth sign-in on a device that a pilot user previously
//     authenticated on (the device hint below)
//   - 'all'  → africa-south1 for everyone
//
// Device hint: sign-in is pre-auth, so the pilot allow-list can't be checked
// against a uid yet. After a SUCCESSFUL authenticated passkey operation the
// service stores the resolved region name (and nothing else — no credential,
// challenge, or token material) under PASSKEY_REGION_HINT_KEY so the next
// pre-auth sign-in on that device can route regionally. The hint is advisory
// routing metadata only: it is re-validated against the live flag on every
// use and cleared the moment the flag stops resolving regional.

export const PASSKEY_PRIMARY_REGION = 'us-central1'
export const PASSKEY_REGIONAL_REGION = 'africa-south1'
export const PASSKEY_REGIONAL_SUFFIX = 'Africa'
export const PASSKEY_REGION_HINT_KEY = 'zedexams.passkeyRegionHint'

// The four flow callables that have an africa-south1 twin (mirror of
// PASSKEY_REGIONAL_CALLABLES in functions/passkeys/passkeyRegions.js).
export const PASSKEY_REGIONAL_CALLABLES = Object.freeze([
  'generatePasskeyRegistrationOptions',
  'verifyPasskeyRegistration',
  'generatePasskeyAuthenticationOptions',
  'verifyPasskeyAuthentication',
])

/** Export name of a flow callable's africa-south1 twin. */
export function regionalCallableName(baseName) {
  return `${baseName}${PASSKEY_REGIONAL_SUFFIX}`
}

/** A device hint is honoured only when it is EXACTLY the regional region
 * name — anything else (tampered, stale, unknown) resolves to null. */
export function sanitizeRegionHint(value) {
  return value === PASSKEY_REGIONAL_REGION ? PASSKEY_REGIONAL_REGION : null
}

/**
 * Decide which region the passkey FLOW callables should use.
 * Returns { region, source } — source is for diagnostics/tests only.
 * Fail-safe: every unknown/invalid input resolves to us-central1.
 */
export function resolvePasskeyFunctionsRegion({ featureFlags, uid = null, deviceHint = null } = {}) {
  const config = featureFlags?.passkeyFunctionsRegion
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { region: PASSKEY_PRIMARY_REGION, source: 'default' }
  }
  if (config.mode === 'all') {
    return { region: PASSKEY_REGIONAL_REGION, source: 'all' }
  }
  if (config.mode === 'pilot') {
    const pilotUids = Array.isArray(config.pilotUids) ? config.pilotUids : []
    if (uid && pilotUids.includes(uid)) {
      return { region: PASSKEY_REGIONAL_REGION, source: 'pilot-uid' }
    }
    if (!uid && sanitizeRegionHint(deviceHint)) {
      return { region: PASSKEY_REGIONAL_REGION, source: 'device-hint' }
    }
    return { region: PASSKEY_PRIMARY_REGION, source: 'not-in-pilot' }
  }
  return { region: PASSKEY_PRIMARY_REGION, source: config.mode === 'off' ? 'off' : 'default' }
}

/**
 * The hint to persist after a SUCCESSFUL passkey operation where the uid is
 * known (post-sign-in or authenticated registration): the regional region
 * name when the flag currently routes this uid regionally, else null (which
 * clears any stored hint — this is how a rollback flag flip also scrubs
 * pilot devices on their next sign-in).
 */
export function regionHintAfterAuth({ featureFlags, uid }) {
  const { region } = resolvePasskeyFunctionsRegion({ featureFlags, uid })
  return region === PASSKEY_REGIONAL_REGION ? PASSKEY_REGIONAL_REGION : null
}

/**
 * Whether a failed regional call may be retried once on us-central1.
 * Deliberately narrow:
 *   - 'options' phase (nothing consumed yet): the twin is absent
 *     ('functions/not-found') or unreachable ('functions/unavailable').
 *   - 'verify' phase: ONLY 'functions/not-found' — the callable does not
 *     exist in that region, so nothing was processed. Ambiguous failures
 *     (timeout, internal) are never retried; the single-use challenge makes
 *     even an accidental double-submit fail closed (CHALLENGE_REUSED) rather
 *     than replay, but we don't lean on that.
 */
export function shouldFallbackToPrimary({ code, phase }) {
  if (phase === 'options') {
    return code === 'functions/not-found' || code === 'functions/unavailable'
  }
  return code === 'functions/not-found'
}
