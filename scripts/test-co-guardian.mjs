// scripts/test-co-guardian.mjs
//
// Pure-logic tests for the family-sharing invite
// (functions/parentApp/coGuardianCore.js). Run with `npm run test:co-guardian`.
//
// Two things here are security-shaped rather than cosmetic: the stored id
// must not be the redeemable token, and the email comparison that decides
// whether a forwarded link may be used must not be defeated by casing or
// stray whitespace.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const core = require('../functions/parentApp/coGuardianCore.js')

const {
  CO_GUARDIAN_INVITE_TTL_DAYS,
  buildCoGuardianInviteEmail,
  hashInviteToken,
  normalizeEmail,
  randomInviteToken,
} = core

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

/* ── Tokens ────────────────────────────────────────────────────────── */

t('the stored id is a hash, not the token — a leaked row is not redeemable', () => {
  const raw = randomInviteToken(crypto.randomBytes)
  const id = hashInviteToken(raw)
  assert.notEqual(id, raw)
  assert.match(id, /^[0-9a-f]{64}$/)
  // And it is the SHA-256 anyone can verify, not a bespoke scheme.
  assert.equal(id, crypto.createHash('sha256').update(raw).digest('hex'))
})

t('hashing is stable, so the same link keeps opening the same invite', () => {
  assert.equal(hashInviteToken('abc'), hashInviteToken('abc'))
  assert.notEqual(hashInviteToken('abc'), hashInviteToken('abd'))
})

t('tokens are long and URL-safe', () => {
  const raw = randomInviteToken(crypto.randomBytes)
  assert.ok(raw.length >= 40, `token too short: ${raw.length}`)
  assert.equal(raw, encodeURIComponent(raw), 'token must survive a query string unescaped')
})

t('token minting is deterministic under an injected randomBytes', () => {
  const stub = (n) => Buffer.alloc(n, 7)
  assert.equal(randomInviteToken(stub), randomInviteToken(stub))
})

/* ── Email canonicalisation ────────────────────────────────────────── */

t('addresses compare equal across casing and padding', () => {
  // This is the comparison that decides whether a forwarded invite may be
  // redeemed. If "Grace@Example.com " did not match "grace@example.com",
  // a legitimate guardian would be locked out of their own invite.
  assert.equal(normalizeEmail('  Grace@Example.COM '), 'grace@example.com')
  assert.equal(normalizeEmail('grace@example.com'), 'grace@example.com')
})

t('a non-address is rejected rather than half-accepted', () => {
  for (const bad of ['', '   ', null, undefined, 'grace', 'grace@', '@example.com',
    'grace@example', 'a@b@c.com', 'grace @example.com', 'grace@exam ple.com',
    'grace@.com', 'grace@example.']) {
    assert.equal(normalizeEmail(bad), '', `should reject ${JSON.stringify(bad)}`)
  }
})

t('ordinary Zambian addresses are accepted', () => {
  for (const good of ['grace@zamtel.zm', 'g.phiri@uni.edu.zm', 'grace+kids@gmail.com']) {
    assert.equal(normalizeEmail(good), good)
  }
})

/* ── The invite email ──────────────────────────────────────────────── */

t('the invite says what it grants AND what it withholds', () => {
  const mail = buildCoGuardianInviteEmail({
    inviterName: 'Grace Phiri',
    childName: 'Milton',
    acceptUrl: 'https://zedexams.com/family/accept?t=xyz',
    expiresInDays: 7,
  })
  assert.match(mail.subject, /Grace Phiri/)
  assert.match(mail.subject, /Milton/)
  assert.match(mail.text, /see Milton's progress/)
  assert.match(mail.text, /approve requests/)
  // The withheld half matters most: accepting must not read as taking
  // over the account.
  assert.match(mail.text, /does NOT give you billing/)
  assert.match(mail.text, /delete the account/)
  assert.match(mail.text, /7 days/)
  assert.match(mail.text, /https:\/\/zedexams\.com\/family\/accept\?t=xyz/)
  // An unexpected recipient is told nothing happens until they act.
  assert.match(mail.text, /Nothing\s+happens until you accept/)
})

t('missing names degrade to words rather than to undefined', () => {
  const mail = buildCoGuardianInviteEmail({ acceptUrl: 'https://x' })
  assert.doesNotMatch(mail.subject, /undefined|null/)
  assert.doesNotMatch(mail.text, /undefined|null/)
  assert.match(mail.subject, /A parent/)
  assert.match(mail.text, /their child/)
  assert.match(mail.text, new RegExp(`${CO_GUARDIAN_INVITE_TTL_DAYS} days`))
})

console.log(`co-guardian invites — ${passed} total assertions passed`)
