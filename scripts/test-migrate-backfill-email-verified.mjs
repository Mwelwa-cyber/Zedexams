#!/usr/bin/env node
// Tests for the pure decision logic in migrate-backfill-email-verified.mjs.
// Plain-node suite (test:migrate-email-verified) — throws on failure.

import assert from 'node:assert/strict'
import {
  decideEmailVerifiedBackfill,
  classifyAccount,
} from './migrate-backfill-email-verified.mjs'

const NOW = Date.UTC(2026, 0, 1)
const DAY_MS = 24 * 60 * 60 * 1000

// ── classifyAccount ────────────────────────────────────────────────────────
assert.equal(classifyAccount({ email: 'a@x.zm', emailVerified: true }), 'verified')
assert.equal(classifyAccount({ email: 'a@x.zm', emailVerified: false }), 'unverified')
assert.equal(classifyAccount({ email: 'a@x.zm' }), 'unverified')
assert.equal(classifyAccount({ email: null }), 'no-email')
assert.equal(classifyAccount(null), 'no-email')

// ── mirror writes ──────────────────────────────────────────────────────────
{
  // Unverified account, no mirror yet → mirror false (no grace requested).
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: false },
    { role: 'learner' },
    { now: NOW },
  )
  assert.equal(r.shouldWrite, true)
  assert.deepEqual(r.fields, { emailVerified: false })
}
{
  // Verified account, stale mirror → flip to true.
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: true },
    { role: 'learner', emailVerified: false },
    { now: NOW },
  )
  assert.deepEqual(r.fields, { emailVerified: true })
}
{
  // Mirror already current → no-op.
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: true },
    { role: 'learner', emailVerified: true },
    { now: NOW },
  )
  assert.equal(r.shouldWrite, false)
}
{
  // No-email account (future custom-token learner) mirrors as verified —
  // there is nothing to verify, so admin filters must not flag it.
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: null, emailVerified: false },
    { role: 'learner' },
    { now: NOW },
  )
  assert.deepEqual(r.fields, { emailVerified: true })
}

// ── grace window ───────────────────────────────────────────────────────────
{
  // Unverified + graceDays → grace stamped exactly N days out.
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: false },
    { role: 'learner' },
    { graceDays: 7, now: NOW },
  )
  assert.equal(r.shouldWrite, true)
  assert.equal(r.fields.emailVerified, false)
  assert.ok(r.fields.verificationGraceUntil instanceof Date)
  assert.equal(r.fields.verificationGraceUntil.getTime(), NOW + 7 * DAY_MS)
}
{
  // Existing grace is never overwritten (no shortening/extending on re-run).
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: false },
    { role: 'learner', emailVerified: false, verificationGraceUntil: new Date(NOW + DAY_MS) },
    { graceDays: 7, now: NOW },
  )
  assert.equal(r.shouldWrite, false)
}
{
  // Verified accounts never get grace.
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: true },
    { role: 'teacher' },
    { graceDays: 7, now: NOW },
  )
  assert.deepEqual(Object.keys(r.fields), ['emailVerified'])
}

// ── missing profile doc ────────────────────────────────────────────────────
{
  const r = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: false },
    null,
    { graceDays: 7, now: NOW },
  )
  assert.equal(r.shouldWrite, false)
  assert.deepEqual(r.reasons, ['no-profile-doc'])
}

// ── idempotence: running the decision on its own output is a no-op ────────
{
  const first = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: false },
    { role: 'learner' },
    { graceDays: 7, now: NOW },
  )
  const second = decideEmailVerifiedBackfill(
    { uid: 'u', email: 'a@x.zm', emailVerified: false },
    { role: 'learner', ...first.fields },
    { graceDays: 7, now: NOW },
  )
  assert.equal(second.shouldWrite, false)
}

console.log('✓ migrate-backfill-email-verified decision logic OK')
