// Pure core for useAiOperationLock.js — no React, no browser storage APIs, so
// this is unit-testable under plain `node` (same *Core.js split as
// assessmentDraftCore.js). The hook itself owns sessionStorage/BroadcastChannel
// I/O and calls these decision functions.
//
// Mirrors the server-side decision in functions/aiOperationsCore.js
// (decideReservationOutcome) closely enough on the ONE question that matters
// client-side: "is this a retry of the same logical request, or a new one?" —
// but this is only ever a cheap client-side hint. The server's own fingerprint
// check (functions/aiOperationsCore.js) is the authoritative one; a client
// that gets this wrong just wastes a round trip to a REJECTED /
// IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT response, it can never bypass
// the server check.

export const AI_OP_STORAGE_PREFIX = 'zedexams:ai-op:'

export function storageKeyFor(lockKey) {
  return `${AI_OP_STORAGE_PREFIX}${lockKey}`
}

// A generous ceiling so a genuinely abandoned pending record (tab left open
// for days) doesn't wedge the lock slot forever, WITHOUT ever expiring within
// any realistic retry/refresh/timeout window — expiring early here would
// violate "never mint a new key merely because the client timed out".
export const PENDING_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Stable (key-sorted) string form of an object, used only to compare
 * "is this the same logical request" — not a security boundary, so no
 * hashing needed (the real fingerprint check is server-side). */
export function stableFingerprint(fields) {
  const stringify = (value) => {
    if (value === undefined) return 'null'
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(value[k])}`).join(',')}}`
  }
  return stringify(fields || {})
}

/**
 * Decide whether to reuse a persisted idempotency key or mint a fresh one.
 *
 * @param {Object} args
 * @param {{key:string,status:string,startedAt:number,fingerprint:string}|null} args.persisted
 * @param {string} args.fingerprint  Fingerprint of the CURRENT request about to be sent.
 * @param {number} args.now
 * @returns {{key:string|null, resumed:boolean}} `key:null` means the caller must mint a fresh UUID.
 */
export function resolveIdempotencyKey({persisted, fingerprint, now, maxAgeMs = PENDING_RECORD_MAX_AGE_MS}) {
  if (
    persisted &&
    persisted.status === 'pending' &&
    typeof persisted.key === 'string' &&
    persisted.fingerprint === fingerprint &&
    typeof persisted.startedAt === 'number' &&
    now - persisted.startedAt < maxAgeMs
  ) {
    return {key: persisted.key, resumed: true}
  }
  return {key: null, resumed: false}
}

export function buildPendingRecord({key, fingerprint, now}) {
  return {key, status: 'pending', fingerprint, startedAt: now}
}
