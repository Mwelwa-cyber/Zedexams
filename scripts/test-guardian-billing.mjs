// scripts/test-guardian-billing.mjs
//
// Pure-logic tests for "a guardian pays for a child"
// (functions/guardianBillingCore.js). Run with `npm run test:guardian-billing`.
//
// This is the money path, so the properties pinned here are the ones whose
// failure modes are silent and expensive:
//
//   • an ORDINARY payment still credits its payer — the regression that
//     would break every existing purchase in the product;
//   • a payer who is not the child's owner cannot credit that child;
//   • a guardian payment is never an upgrade, so a parent holding a plan
//     cannot buy their child a full period for a prorated few kwacha;
//   • a request is settled only when it names the child being paid for.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const core = require('../functions/guardianBillingCore.js')
const { can } = await import('../functions/shared/guardian/guardianRolesCore.js')

const {
  creditedUid,
  decideGuardianPayment,
  decideRequestSettlement,
  guardianPaymentFields,
  isGuardianPayment,
  normalizeBeneficiary,
} = core

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

/* ── Which account a payment credits ───────────────────────────────── */

t('an ordinary payment credits its payer — the regression that matters most', () => {
  // Every purchase in the product before today looks exactly like this.
  assert.equal(creditedUid({ userId: 'buyer' }), 'buyer')
  assert.equal(creditedUid({ userId: 'buyer', beneficiaryUid: null }), 'buyer')
  assert.equal(creditedUid({ userId: 'buyer', beneficiaryUid: '' }), 'buyer')
  assert.equal(creditedUid({ userId: 'buyer', beneficiaryUid: '   ' }), 'buyer')
  assert.equal(isGuardianPayment({ userId: 'buyer' }), false)
})

t('a guardian payment credits the CHILD, not the parent', () => {
  const pay = { userId: 'parent', beneficiaryUid: 'kid' }
  assert.equal(creditedUid(pay), 'kid')
  assert.equal(isGuardianPayment(pay), true)
})

t('a payment naming nobody credits nobody, rather than guessing', () => {
  assert.equal(creditedUid({}), null)
  assert.equal(creditedUid(null), null)
  assert.equal(creditedUid(undefined), null)
})

/* ── Normalising what the client asked for ─────────────────────────── */

t('paying for yourself is an ordinary payment, not a beneficiary one', () => {
  assert.equal(normalizeBeneficiary('me', 'me'), null)
  assert.equal(normalizeBeneficiary('  me  ', 'me'), null)
})

t('rubbish is dropped rather than half-accepted', () => {
  for (const bad of [null, undefined, '', '   ', 42, {}, [], true]) {
    assert.equal(normalizeBeneficiary(bad, 'me'), null, `should drop ${JSON.stringify(bad)}`)
  }
  assert.equal(normalizeBeneficiary('  kid ', 'me'), 'kid')
})

/* ── Who may pay for whom ──────────────────────────────────────────── */

t('an ordinary payment needs no guardian relationship at all', () => {
  assert.equal(decideGuardianPayment({ beneficiaryUid: null, role: null, can }).allowed, true)
})

t('the owner may pay for their child', () => {
  assert.equal(decideGuardianPayment({ beneficiaryUid: 'kid', role: 'owner', can }).allowed, true)
})

t('a CO-GUARDIAN may not — moving money is the owner’s', () => {
  // A co-guardian can approve a request and change what a child may use.
  // Billing is one of the two things they cannot undo for the person who
  // invited them, so it stays with the owner.
  const v = decideGuardianPayment({ beneficiaryUid: 'kid', role: 'co_guardian', can })
  assert.equal(v.allowed, false)
  assert.equal(v.reason, 'not-owner')
  assert.match(v.message, /account owner/i)
})

t('a stranger cannot credit somebody else’s child', () => {
  const v = decideGuardianPayment({ beneficiaryUid: 'kid', role: null, can })
  assert.equal(v.allowed, false)
  assert.equal(v.reason, 'not-linked')
})

t('an unrecognised role buys nothing', () => {
  assert.equal(decideGuardianPayment({ beneficiaryUid: 'kid', role: 'trustee', can }).allowed, false)
})

t('a missing capability check refuses rather than waving it through', () => {
  const v = decideGuardianPayment({ beneficiaryUid: 'kid', role: 'owner' })
  assert.equal(v.allowed, false)
  assert.equal(v.reason, 'no-capability-check')
})

/* ── The fields a guardian payment carries ─────────────────────────── */

t('a guardian payment is explicitly NOT an upgrade', () => {
  // The prorated quote is computed from the PAYER's subscription, so a
  // parent on an active plan would otherwise buy their child a full
  // period for a few kwacha of tier difference.
  const f = guardianPaymentFields({ beneficiaryUid: 'kid', beneficiaryName: 'Milton Phiri' })
  assert.equal(f.isUpgrade, false)
  assert.equal(f.beneficiaryUid, 'kid')
  assert.equal(f.beneficiaryName, 'Milton Phiri')
})

t('an ordinary payment gains no fields at all', () => {
  assert.deepEqual(guardianPaymentFields({ beneficiaryUid: null }), {})
  assert.deepEqual(guardianPaymentFields({}), {})
})

t('the request id is carried only when there is one', () => {
  assert.equal('guardianRequestId' in guardianPaymentFields({ beneficiaryUid: 'kid' }), false)
  assert.equal(
    guardianPaymentFields({ beneficiaryUid: 'kid', guardianRequestId: 'req1' }).guardianRequestId,
    'req1',
  )
})

t('a missing or oversized name degrades rather than being written raw', () => {
  assert.equal(guardianPaymentFields({ beneficiaryUid: 'kid' }).beneficiaryName, null)
  assert.equal(guardianPaymentFields({ beneficiaryUid: 'kid', beneficiaryName: '  ' }).beneficiaryName, null)
  const long = guardianPaymentFields({ beneficiaryUid: 'kid', beneficiaryName: 'x'.repeat(500) })
  assert.equal(long.beneficiaryName.length, 120)
})

/* ── Which request a payment settles ───────────────────────────────── */

t('a request is settled only when it names the child being paid for', () => {
  // The id arrives from a URL in an email, and settling it tells a child
  // their guardian unlocked what they asked for.
  assert.equal(
    decideRequestSettlement({ request: { uid: 'kid', status: 'sent' }, beneficiaryUid: 'kid' }).settle,
    true,
  )
  const wrong = decideRequestSettlement({
    request: { uid: 'other-kid', status: 'sent' }, beneficiaryUid: 'kid',
  })
  assert.equal(wrong.settle, false)
  assert.equal(wrong.reason, 'different-child')
})

t('an already-paid or withdrawn request is not settled twice', () => {
  for (const [status, reason] of [['paid', 'already-paid'], ['declined', 'not-outstanding'], ['expired', 'not-outstanding']]) {
    const v = decideRequestSettlement({ request: { uid: 'kid', status }, beneficiaryUid: 'kid' })
    assert.equal(v.settle, false, status)
    assert.equal(v.reason, reason)
  }
})

t('a missing request, or a payment with no beneficiary, settles nothing', () => {
  assert.equal(decideRequestSettlement({ request: null, beneficiaryUid: 'kid' }).settle, false)
  assert.equal(decideRequestSettlement({ request: { uid: 'kid', status: 'sent' } }).settle, false)
  assert.equal(decideRequestSettlement({}).settle, false)
})

console.log(`guardian billing — ${passed} total assertions passed`)
