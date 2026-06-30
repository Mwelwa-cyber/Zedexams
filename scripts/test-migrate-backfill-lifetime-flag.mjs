import assert from 'node:assert/strict'
import {
  parseExpiry,
  hasPremiumAccessFlag,
  decideLifetimeBackfill,
} from './migrate-backfill-lifetime-flag.mjs'

// ─── parseExpiry ───────────────────────────────────────────────────────────

assert.equal(parseExpiry(null), null, 'null → null')
assert.equal(parseExpiry(undefined), null, 'undefined → null')
assert.equal(parseExpiry(''), null, 'empty string → null')
assert.equal(parseExpiry('not-a-date'), null, 'garbage string → null')
assert.ok(parseExpiry('2026-01-01') instanceof Date, 'ISO string → Date')
assert.ok(parseExpiry(new Date()) instanceof Date, 'Date → Date')
// Firestore Timestamp duck-type
{
  const ts = { toDate: () => new Date('2026-06-01') }
  assert.equal(parseExpiry(ts).getFullYear(), 2026, 'Timestamp.toDate() honoured')
}
// A throwing toDate is swallowed → null
assert.equal(parseExpiry({ toDate: () => { throw new Error('x') } }), null, 'throwing toDate → null')

// ─── hasPremiumAccessFlag ────────────────────────────────────────────────────

assert.equal(hasPremiumAccessFlag(null), false, 'null → false')
assert.equal(hasPremiumAccessFlag({}), false, 'no flags → false')
assert.equal(hasPremiumAccessFlag({ premium: true }), true, 'premium → true')
assert.equal(hasPremiumAccessFlag({ isPremium: true }), true, 'isPremium → true')
assert.equal(hasPremiumAccessFlag({ paymentStatus: 'active' }), true, 'paymentStatus → true')
assert.equal(hasPremiumAccessFlag({ subscriptionStatus: 'active' }), true, 'subscriptionStatus → true')
assert.equal(hasPremiumAccessFlag({ plan: 'premium' }), true, 'plan premium → true')
assert.equal(hasPremiumAccessFlag({ premium: false, plan: 'free' }), false, 'free → false')

// ─── decideLifetimeBackfill ──────────────────────────────────────────────────

// The core case: a comp/lifetime grant from before the marker existed — a
// premium flag with a null expiry and no marker → backfill to preserve access.
{
  const v = decideLifetimeBackfill({ premium: true, subscriptionExpiry: null })
  assert.equal(v.shouldWrite, true, 'flag + null expiry → backfill')
  assert.equal(v.reason, 'flag-without-expiry')
}

// Missing expiry field entirely → same.
{
  const v = decideLifetimeBackfill({ subscriptionStatus: 'active' })
  assert.equal(v.shouldWrite, true, 'flag + absent expiry → backfill')
}

// A real (even future) expiry → the normal time-boxed path, never backfilled.
{
  const v = decideLifetimeBackfill({ premium: true, subscriptionExpiry: new Date(Date.now() + 8.64e7) })
  assert.equal(v.shouldWrite, false, 'has expiry → no-op')
  assert.equal(v.reason, 'has-expiry')
}

// An EXPIRED expiry is still a parseable expiry → not backfilled (the user is
// simply not premium under the gate; we must not silently re-grant them).
{
  const v = decideLifetimeBackfill({ premium: true, subscriptionExpiry: new Date(Date.now() - 8.64e7) })
  assert.equal(v.shouldWrite, false, 'expired (parseable) expiry → no-op, not re-granted')
  assert.equal(v.reason, 'has-expiry')
}

// Already marked → idempotent no-op.
{
  const v = decideLifetimeBackfill({ premium: true, subscriptionExpiry: null, subscriptionLifetime: true })
  assert.equal(v.shouldWrite, false, 'already lifetime → no-op')
  assert.equal(v.reason, 'already-lifetime')
}

// Free user with no flag → never touched.
{
  const v = decideLifetimeBackfill({ plan: 'free' })
  assert.equal(v.shouldWrite, false, 'no access flag → no-op')
  assert.equal(v.reason, 'no-access-flag')
}

// Null user doesn't crash.
{
  const v = decideLifetimeBackfill(null)
  assert.equal(v.shouldWrite, false, 'null → no-op')
}

console.log('test-migrate-backfill-lifetime-flag.mjs — OK')
