/**
 * Node test for src/hooks/aiOperationLockCore.js — pure decision logic
 * behind the frontend AI-operation request lock. No React, no DOM.
 *
 * Run: node src/hooks/aiOperationLockCore.test.js
 */

import assert from 'node:assert/strict'
import {
  stableFingerprint,
  resolveIdempotencyKey,
  buildPendingRecord,
  storageKeyFor,
  PENDING_RECORD_MAX_AGE_MS,
} from './aiOperationLockCore.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

// ── stableFingerprint ────────────────────────────────────────────────────
ok('same fields → same fingerprint', stableFingerprint({a: 1, b: 2}) === stableFingerprint({b: 2, a: 1}))
ok('different fields → different fingerprint', stableFingerprint({a: 1}) !== stableFingerprint({a: 2}))
ok('undefined fields are ignored', stableFingerprint({a: 1, b: undefined}) === stableFingerprint({a: 1}))

// ── storageKeyFor ────────────────────────────────────────────────────────
ok('storage key is namespaced by lockKey', storageKeyFor('assessment:new').includes('assessment:new'))
ok('two different lock keys get two different storage keys',
    storageKeyFor('a') !== storageKeyFor('b'))

// ── resolveIdempotencyKey ────────────────────────────────────────────────
{
  const r = resolveIdempotencyKey({persisted: null, fingerprint: 'fp1', now: 1000})
  ok('no persisted record → mint a fresh key (key:null)', r.key === null && r.resumed === false)
}
{
  const persisted = {key: 'abc-123', status: 'pending', fingerprint: 'fp1', startedAt: 1000}
  const r = resolveIdempotencyKey({persisted, fingerprint: 'fp1', now: 1500})
  ok('same fingerprint, still pending, within age window → reuse the key', r.key === 'abc-123' && r.resumed === true)
}
{
  const persisted = {key: 'abc-123', status: 'pending', fingerprint: 'fp1', startedAt: 1000}
  const r = resolveIdempotencyKey({persisted, fingerprint: 'fp2', now: 1500})
  ok('different fingerprint (user changed inputs) → mint a fresh key, do NOT reuse',
      r.key === null && r.resumed === false)
}
{
  const persisted = {key: 'abc-123', status: 'done', fingerprint: 'fp1', startedAt: 1000}
  const r = resolveIdempotencyKey({persisted, fingerprint: 'fp1', now: 1500})
  ok('a completed/cleared record is never resumed (status !== pending)',
      r.key === null && r.resumed === false)
}
{
  const persisted = {key: 'abc-123', status: 'pending', fingerprint: 'fp1', startedAt: 1000}
  const r = resolveIdempotencyKey({
    persisted, fingerprint: 'fp1', now: 1000 + PENDING_RECORD_MAX_AGE_MS + 1,
  })
  ok('a record older than the abandonment ceiling is not resumed forever',
      r.key === null && r.resumed === false)
}
{
  // Regression guard for the explicit spec requirement: a client timeout
  // alone (arbitrarily long, as long as it's under the abandonment ceiling)
  // must never force a fresh key.
  const persisted = {key: 'abc-123', status: 'pending', fingerprint: 'fp1', startedAt: 1000}
  const r = resolveIdempotencyKey({persisted, fingerprint: 'fp1', now: 1000 + 5 * 60 * 1000})
  ok('a slow/timed-out request (well under the abandonment ceiling) still reuses the key',
      r.key === 'abc-123')
}

// ── buildPendingRecord ───────────────────────────────────────────────────
{
  const rec = buildPendingRecord({key: 'k1', fingerprint: 'fp1', now: 2000})
  ok('pending record captures key/status/fingerprint/startedAt',
      rec.key === 'k1' && rec.status === 'pending' && rec.fingerprint === 'fp1' && rec.startedAt === 2000)
}

console.log(`\n✓ ${passed} aiOperationLockCore assertions passed.`)
