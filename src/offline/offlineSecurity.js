/**
 * offlineSecurity — the guardrail that decides what is allowed to touch the
 * device's offline cache, plus a light at-rest codec for the bytes that are.
 *
 * Everything here is PURE (no browser APIs, no crypto that needs a runtime) so
 * it unit-tests under plain `node` — see offlineSecurity.test.js. The real
 * WebCrypto AES-GCM path (used when `crypto.subtle` + a device key are
 * available) lives in offlineStore.js and calls `isCacheableType` from here as
 * the gate; this module is the single source of truth for the policy.
 *
 * Objective 9 (Security): NEVER store locally:
 *   • Firebase API keys / config secrets
 *   • Payment information
 *   • Subscription secrets
 *   • AI prompts
 *   • Sensitive account information
 *
 * The approach is allow-list first (only known educational content types may be
 * cached) with a deny-list backstop (obviously-sensitive keys are rejected even
 * if they somehow carry an allowed type). Fail closed: an unknown type is NOT
 * cacheable.
 */

/**
 * Educational content types that are safe to cache offline. This mirrors the
 * "Intelligent Offline Cache" list in the product spec. Keep the strings stable
 * — they become IndexedDB keys and sync-queue discriminators.
 */
export const CACHEABLE_TYPES = Object.freeze([
  'quiz',
  'test',
  'exam',
  'exam-paper',
  'lesson',
  'lesson-notes',
  'note',
  'worksheet',
  'flashcards',
  'image',
  'diagram',
  'curriculum',
  'past-paper',
  'recent',
])

/**
 * Substrings that mark a value as sensitive and therefore never cacheable,
 * regardless of the declared type. Matched case-insensitively against the
 * cache key / type. This is the deny-list backstop behind the allow-list.
 */
const SENSITIVE_MARKERS = Object.freeze([
  'apikey',
  'api-key',
  'api_key',
  'firebaseconfig',
  'secret',
  'token',
  'password',
  'payment',
  'card',
  'lenco',
  'billing',
  'invoice',
  'subscription',
  'aiprompt',
  'ai-prompt',
  'prompt',
  'account',
  'credential',
  'session',
  'auth',
])

/** Normalise a type/key to a lower-case, separator-collapsed comparison form. */
function normalize(value) {
  return String(value == null ? '' : value).toLowerCase()
}

/**
 * True when `type` is on the educational allow-list. Fails closed: an unknown,
 * empty, or non-string type returns false.
 * @param {string} type
 * @returns {boolean}
 */
export function isCacheableType(type) {
  return CACHEABLE_TYPES.includes(normalize(type))
}

/**
 * True when `key` (or type) contains a sensitive marker and must never be
 * written to the offline store.
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  const k = normalize(key)
  return SENSITIVE_MARKERS.some((m) => k.includes(m))
}

/**
 * The one call sites should use: may this {type, key} pair be cached?
 * Allow-list AND NOT deny-list. Returns a structured result so the caller can
 * log *why* something was rejected (useful for the /admin diagnostics).
 * @param {{ type?: string, key?: string }} entry
 * @returns {{ allowed: boolean, reason: string }}
 */
export function assertCacheable({ type, key } = {}) {
  if (!isCacheableType(type)) {
    return { allowed: false, reason: `type "${type}" is not on the offline allow-list` }
  }
  if (isSensitiveKey(key) || isSensitiveKey(type)) {
    return { allowed: false, reason: 'key/type matched a sensitive marker' }
  }
  return { allowed: true, reason: '' }
}

/**
 * Recursively strip fields that must never leave the network layer even inside
 * an otherwise-cacheable payload (a quiz doc that happens to carry an auth
 * token, say). Structure-preserving; returns a new object.
 * @param {*} value
 * @returns {*}
 */
export function stripSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(stripSensitiveFields)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) continue
      out[k] = stripSensitiveFields(v)
    }
    return out
  }
  return value
}

/* ─────────────────────────── at-rest obfuscation ─────────────────────────
 * A deterministic, reversible byte transform. This is NOT a substitute for
 * WebCrypto AES-GCM (which offlineStore uses when available) — it is the
 * portable, dependency-free fallback so cached educational content is never
 * sitting in IndexedDB as clear plaintext on a shared low-end device. The key
 * is device-derived (see deviceKeyFrom) and never itself persisted.
 */

/**
 * Derive a small numeric key stream seed from a device-stable string (e.g. a
 * per-install UUID). djb2-style; stable across reloads for the same input.
 * @param {string} seed
 * @returns {number} 32-bit unsigned
 */
export function deviceKeyFrom(seed) {
  const str = String(seed || 'zedexams-offline')
  let hash = 5381
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

/**
 * XOR a UTF-16 string against a rolling key stream derived from `key`. Its own
 * inverse — calling it twice with the same key returns the original — so it is
 * both the encode and decode primitive. Returns a base64-ish safe string via
 * escape/encode so it round-trips through JSON and IndexedDB.
 * @param {string} text
 * @param {number} key 32-bit key from deviceKeyFrom
 * @returns {number[]} char-code array (JSON-safe, reversible with xorDecode)
 */
export function xorEncode(text, key) {
  const src = String(text == null ? '' : text)
  const out = new Array(src.length)
  let k = (key >>> 0) || 1
  for (let i = 0; i < src.length; i += 1) {
    // Advance a cheap xorshift PRNG so identical characters don't map to the
    // same output byte (defeats trivial frequency analysis of the blob).
    k ^= k << 13; k ^= k >>> 17; k ^= k << 5; k >>>= 0
    out[i] = src.charCodeAt(i) ^ (k & 0xffff)
  }
  return out
}

/**
 * Inverse of xorEncode. Same key → original string.
 * @param {number[]} codes
 * @param {number} key
 * @returns {string}
 */
export function xorDecode(codes, key) {
  if (!Array.isArray(codes)) return ''
  const out = new Array(codes.length)
  let k = (key >>> 0) || 1
  for (let i = 0; i < codes.length; i += 1) {
    k ^= k << 13; k ^= k >>> 17; k ^= k << 5; k >>>= 0
    out[i] = String.fromCharCode((codes[i] ^ (k & 0xffff)) & 0xffff)
  }
  return out.join('')
}

/**
 * Obfuscate a JSON-serialisable payload for at-rest storage. Wraps the encoded
 * form with a marker + version so the reader knows to decode it.
 * @param {*} payload
 * @param {number} key
 * @returns {{ __enc: 'xor1', d: number[] }}
 */
export function encodePayload(payload, key) {
  return { __enc: 'xor1', d: xorEncode(JSON.stringify(payload ?? null), key) }
}

/**
 * Inverse of encodePayload. Passes plain (unencoded) records through unchanged
 * so a store that mixes encoded + legacy plaintext records still reads.
 * @param {*} record
 * @param {number} key
 * @returns {*}
 */
export function decodePayload(record, key) {
  if (record && record.__enc === 'xor1' && Array.isArray(record.d)) {
    try {
      return JSON.parse(xorDecode(record.d, key))
    } catch {
      return null
    }
  }
  return record
}
