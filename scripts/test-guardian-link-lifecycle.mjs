// The link lifecycle: the child's confirmation, the guardian's withdrawal,
// and the child's unlink request
// (functions/guardianLink/guardianLinkDecisions.js).
//
// Plain `node` assertion script (see CLAUDE.md "Two test suites").
//
// The asymmetry this file exists to pin: a child CAN reject a link and
// CANNOT unlink a confirmed one. That is a deliberate, uncomfortable
// choice — a child who can quietly drop supervision is a child who can be
// talked into dropping it — and it is the kind of rule a later change
// would soften into "just delete it" without noticing what it was for.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildConfirmationPrompt,
  buildUnlinkRequestEmail,
  decideUnlinkRequest,
  decideWithdrawal,
} = require('../functions/guardianLink/guardianLinkDecisions.js')

const {
  LINK_CONSENT,
  normalizeLink,
  resolveLinkConsent,
} = await import('../functions/shared/guardian/guardianLinkCore.js')

// The decisions take their vocabulary by injection so they stay
// synchronous CommonJS. Handing them the REAL core is the point — a stub
// would let the decisions and the vocabulary drift apart, which is the one
// failure injection makes possible.
const deps = { normalizeLink, resolveLinkConsent, LINK_CONSENT }

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const link = (parentUid, state, learnerUid = 'kid') => ({
  parentUid,
  learnerUid,
  consent: { state, method: 'family_code' },
})

// NOTE: the child's accept/decline moved to `respondToFamilyLink`
// (functions/familyPortal.js), which owns the `status` flag. The
// decision function that used to be tested here went with the duplicate
// callable it served. What remains below is everything `status` cannot
// express — withdrawal, and the child's ASK to be unlinked.

console.log('\ndecideWithdrawal — the guardian leaves')

test('a guardian can withdraw their own link', () => {
  const v = decideWithdrawal({
    links: [link('mum', LINK_CONSENT.APPROVED)], guardianUid: 'mum', deps,
  })
  assert.equal(v.ok, true)
  assert.equal(v.childStillApproved, false)
})

test('withdrawing the ONLY approval drops the child to limited mode', () => {
  const v = decideWithdrawal({
    links: [link('mum', LINK_CONSENT.APPROVED), link('stranger', LINK_CONSENT.PENDING)],
    guardianUid: 'mum',
    deps,
  })
  assert.equal(v.childStillApproved, false, 'a pending link is not a standing approval')
})

test('withdrawing one of TWO approvals leaves the child approved', () => {
  // Taking Ask Zed away from a child because their father closed his
  // account is a bug the family would experience as a punishment.
  const v = decideWithdrawal({
    links: [link('mum', LINK_CONSENT.APPROVED), link('dad', LINK_CONSENT.APPROVED)],
    guardianUid: 'dad',
    deps,
  })
  assert.equal(v.ok, true)
  assert.equal(v.childStillApproved, true)
  assert.equal(v.remainingGuardians, 1)
})

test('the answer is computed on the WOULD-BE set, before anything is written', () => {
  // The caller needs to know it is about to limit a child before it does.
  const links = [link('mum', LINK_CONSENT.APPROVED)]
  const v = decideWithdrawal({ links, guardianUid: 'mum', deps })
  assert.equal(v.childStillApproved, false)
  assert.equal(
    normalizeLink(links[0]).state, LINK_CONSENT.APPROVED,
    'the input must not have been mutated',
  )
})

test('somebody with no link cannot withdraw', () => {
  const v = decideWithdrawal({
    links: [link('mum', LINK_CONSENT.APPROVED)], guardianUid: 'nobody', deps,
  })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'not-linked')
})

test('withdrawing twice is refused rather than re-fired', () => {
  const v = decideWithdrawal({
    links: [link('mum', LINK_CONSENT.WITHDRAWN)], guardianUid: 'mum', deps,
  })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'already-withdrawn')
})

console.log('\ndecideUnlinkRequest — the child asks, and is not obeyed')

test('a confirmed guardian can only be REQUESTED to be removed', () => {
  const v = decideUnlinkRequest({
    links: [link('mum', LINK_CONSENT.APPROVED)],
    learnerUid: 'kid',
    guardianUid: 'mum',
    openRequests: [],
    deps,
  })
  assert.equal(v.ok, true)
  assert.equal(v.action, 'request', 'never "remove" — a human decides')
})

test('a PENDING link is refused here and routed to plain rejection', () => {
  // Nothing has been granted yet, so there is nothing to negotiate.
  // Routing it through a request would make refusing a stranger SLOWER
  // than accepting one.
  const v = decideUnlinkRequest({
    links: [link('stranger', LINK_CONSENT.PENDING)],
    learnerUid: 'kid',
    guardianUid: 'stranger',
    openRequests: [],
    deps,
  })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'use-reject')
})

test('asking twice does not file a second ticket', () => {
  const v = decideUnlinkRequest({
    links: [link('mum', LINK_CONSENT.APPROVED)],
    learnerUid: 'kid',
    guardianUid: 'mum',
    openRequests: [{ id: 'r1' }],
    deps,
  })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'already-asked')
})

test('you cannot ask to remove a guardian you do not have', () => {
  const v = decideUnlinkRequest({
    links: [], learnerUid: 'kid', guardianUid: 'mum', openRequests: [], deps,
  })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'not-linked')
})

test('THE ASYMMETRY: a child may decline, and may not unlink', () => {
  // Stated once, as a test, because it is the rule most likely to be
  // "simplified" later by somebody who reads the two paths as duplicates.
  // Before confirmation the child decides alone — that half now lives in
  // respondToFamilyLink('decline'). After confirmation they do not, and
  // that half is here.
  const unlink = decideUnlinkRequest({
    links: [link('x', LINK_CONSENT.APPROVED)],
    learnerUid: 'kid', guardianUid: 'x', openRequests: [], deps,
  })
  assert.equal(unlink.action, 'request', 'after confirmation a child cannot unlink alone')
  assert.notEqual(unlink.action, 'delete')
})

console.log('\ncopy')

test('the confirmation prompt NAMES the adult', () => {
  // "Somebody wants to be your guardian" is a question nobody can answer.
  assert.match(buildConfirmationPrompt({ guardianName: 'Mrs Banda' }), /Mrs Banda/)
  assert.match(buildConfirmationPrompt({ guardianName: 'Mrs Banda' }), /your grown-up/i)
})

test('an unnamed adult produces a question the child can still act on', () => {
  const prompt = buildConfirmationPrompt({})
  assert.ok(prompt.length > 0)
  assert.doesNotMatch(prompt, /undefined|null/)
})

test('the unlink email is explicit that NOBODY has been removed', () => {
  const mail = buildUnlinkRequestEmail({ childName: 'Chanda' })
  assert.match(mail.text.replace(/\s+/g, ' '), /NOT removed anyone/)
  assert.match(mail.text, /116/, 'Childline must be in the message a family is arguing over')
})

test('every email survives a missing child name', () => {
  for (const mail of [buildUnlinkRequestEmail({})]) {
    assert.doesNotMatch(mail.subject + mail.text, /undefined|null/)
  }
})

console.log(`\n${passed} guardian-link-lifecycle assertions passed`)
