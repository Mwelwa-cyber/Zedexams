/**
 * Tests for offlineSecurity — the allow/deny cache policy and the at-rest codec.
 * Run: node src/offline/offlineSecurity.test.js
 */

import {
  CACHEABLE_TYPES,
  isCacheableType,
  isSensitiveKey,
  assertCacheable,
  stripSensitiveFields,
  deviceKeyFrom,
  xorEncode,
  xorDecode,
  encodePayload,
  decodePayload,
} from './offlineSecurity.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('isCacheableType — allow-list, fail-closed')
{
  assert(isCacheableType('quiz'), 'quiz allowed')
  assert(isCacheableType('EXAM'), 'case-insensitive')
  assert(CACHEABLE_TYPES.includes('flashcards'), 'flashcards on the list')
  assert(!isCacheableType('payment'), 'payment rejected')
  assert(!isCacheableType('unknown'), 'unknown type rejected (fail-closed)')
  assert(!isCacheableType(''), 'empty rejected')
  assert(!isCacheableType(undefined), 'undefined rejected')
}

console.log('\nisSensitiveKey — deny-list backstop')
{
  assert(isSensitiveKey('VITE_FIREBASE_API_KEY'), 'firebase api key flagged')
  assert(isSensitiveKey('user-payment-card'), 'payment flagged')
  assert(isSensitiveKey('subscriptionSecret'), 'subscription flagged')
  assert(isSensitiveKey('systemPrompt'), 'ai prompt flagged')
  assert(isSensitiveKey('authToken'), 'auth token flagged')
  assert(!isSensitiveKey('quiz:abc123'), 'ordinary quiz key clean')
}

console.log('\nassertCacheable — allow AND not deny')
{
  assert(assertCacheable({ type: 'quiz', key: 'quiz:abc' }).allowed, 'plain quiz allowed')
  assert(!assertCacheable({ type: 'quiz', key: 'quiz:payment:1' }).allowed, 'sensitive key blocks allowed type')
  assert(!assertCacheable({ type: 'secret', key: 'x' }).allowed, 'non-listed type blocked')
  const r = assertCacheable({ type: 'billing', key: 'b' })
  assert(!r.allowed && typeof r.reason === 'string' && r.reason.length > 0, 'rejection carries a reason')
}

console.log('\nstripSensitiveFields — deep removal')
{
  const cleaned = stripSensitiveFields({
    title: 'Fractions',
    authToken: 'xyz',
    nested: { paymentCard: '4111', keep: 1 },
    list: [{ secret: 's', ok: 2 }],
  })
  assert(cleaned.title === 'Fractions', 'ordinary field kept')
  assert(!('authToken' in cleaned), 'top-level sensitive dropped')
  assert(!('paymentCard' in cleaned.nested) && cleaned.nested.keep === 1, 'nested sensitive dropped, sibling kept')
  assert(!('secret' in cleaned.list[0]) && cleaned.list[0].ok === 2, 'sensitive dropped inside arrays')
}

console.log('\nxorEncode/xorDecode — reversible obfuscation')
{
  const key = deviceKeyFrom('device-uuid-123')
  const text = 'What is 3/4 + 1/4? — Zambian CBC quiz ✓'
  const enc = xorEncode(text, key)
  assert(Array.isArray(enc) && enc.length === text.length, 'encodes to a code array')
  assert(JSON.stringify(enc) !== JSON.stringify([...text].map((c) => c.charCodeAt(0))), 'output differs from plaintext codes')
  assert(xorDecode(enc, key) === text, 'round-trips back to original')
  assert(xorDecode(enc, deviceKeyFrom('other-device')) !== text, 'wrong key does not recover text')
}

console.log('\nencodePayload/decodePayload — object round-trip + legacy passthrough')
{
  const key = deviceKeyFrom('seed')
  const payload = { quizId: 'q1', questions: [{ q: 'Q?', a: 2 }] }
  const rec = encodePayload(payload, key)
  assert(rec.__enc === 'xor1' && Array.isArray(rec.d), 'wraps with marker + version')
  assert(JSON.stringify(decodePayload(rec, key)) === JSON.stringify(payload), 'decodes back to the object')
  // Legacy plaintext records (no __enc marker) pass through untouched.
  const legacy = { quizId: 'old' }
  assert(decodePayload(legacy, key) === legacy, 'plain record passes through')
  // Corrupt / wrong-key decode is null, not a throw.
  assert(decodePayload({ __enc: 'xor1', d: [1, 2, 3] }, key) === null || typeof decodePayload({ __enc: 'xor1', d: [1, 2, 3] }, key) !== 'undefined', 'bad blob decodes to null, never throws')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll offlineSecurity tests passed.')
