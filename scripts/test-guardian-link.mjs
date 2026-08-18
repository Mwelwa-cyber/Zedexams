// The guardian↔learner LINK record: consent state, the derived learner
// state, and most-restrictive-wins permissions
// (functions/shared/guardian/guardianLinkCore.js).
//
// Plain `node` assertion script (see CLAUDE.md "Two test suites").
//
// What is worth testing here is not that the functions run — it is the
// handful of asymmetries the whole design rests on, each of which is a
// coin that could have landed the other way:
//
//   • approval is a DISJUNCTION over links (one yes is enough) while
//     restriction is a CONJUNCTION over approved links (one no is enough)
//   • an unrecognised consent state reads as pending, never approved
//   • a pending or withdrawn guardian sets no rules at all
//   • the legacy account-level `granted` still approves, and says so

import assert from 'node:assert/strict'
import {
  BOOLEAN_PERMISSION_KEYS,
  LINK_CONSENT,
  LINK_METHOD,
  describeConsentState,
  describeLinkMethod,
  guardianEmailKey,
  isLinkConsentState,
  isLinkMethod,
  isPermitted,
  linkId,
  normalizeLink,
  readLinkPermissions,
  resolveLinkConsent,
  resolveLinkPermissions,
} from '../functions/shared/guardian/guardianLinkCore.js'

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

/** A link, with the noise a real document carries left out. */
function link(parentUid, state, permissions = {}, extra = {}) {
  return {
    parentUid,
    learnerUid: 'kid',
    consent: {state, method: LINK_METHOD.FAMILY_CODE},
    permissions,
    ...extra,
  }
}

console.log('\nnormalizeLink — what a stored row means')

test('an unrecognised consent state reads as pending, not approved', () => {
  for (const bogus of ['granted', 'ok', 'APPROVED', 42, null, {}, undefined]) {
    const l = normalizeLink({parentUid: 'p', learnerUid: 'k', consent: {state: bogus}})
    assert.equal(l.state, LINK_CONSENT.PENDING, `state ${JSON.stringify(bogus)} must not approve`)
    assert.equal(l.hasConsentRecord, false)
  }
})

test('a link with no consent object at all is pending and says it has no record', () => {
  const l = normalizeLink({parentUid: 'p', learnerUid: 'k'})
  assert.equal(l.state, LINK_CONSENT.PENDING)
  assert.equal(l.hasConsentRecord, false, 'legacy links must be distinguishable from undecided ones')
})

test('a real approval is recorded as one', () => {
  const l = normalizeLink(link('p', LINK_CONSENT.APPROVED))
  assert.equal(l.state, LINK_CONSENT.APPROVED)
  assert.equal(l.hasConsentRecord, true)
  assert.equal(l.method, LINK_METHOD.FAMILY_CODE)
})

test('a garbage document does not throw and yields nothing usable', () => {
  for (const junk of [null, undefined, 'link', 7, []]) {
    const l = normalizeLink(junk)
    assert.equal(l.parentUid, null)
    assert.equal(l.state, LINK_CONSENT.PENDING)
  }
})

console.log('\nreadLinkPermissions — three-valued, and null is not false')

test('an absent or non-boolean permission is null, never false', () => {
  const p = readLinkPermissions({permissions: {askZed: 'yes', challenges: 1, leaderboard: null}})
  assert.equal(p.askZed, null, 'a string must not become a restriction nobody set')
  assert.equal(p.challenges, null)
  assert.equal(p.leaderboard, null)
})

test('dailyMinutes accepts only a finite non-negative number, floored', () => {
  assert.equal(readLinkPermissions({permissions: {dailyMinutes: 45.9}}).dailyMinutes, 45)
  assert.equal(readLinkPermissions({permissions: {dailyMinutes: 0}}).dailyMinutes, 0)
  assert.equal(readLinkPermissions({permissions: {dailyMinutes: -5}}).dailyMinutes, null)
  assert.equal(readLinkPermissions({permissions: {dailyMinutes: 'lots'}}).dailyMinutes, null)
  assert.equal(readLinkPermissions({permissions: {dailyMinutes: Infinity}}).dailyMinutes, null)
})

console.log('\nresolveLinkConsent — one yes is enough')

test('no links at all is not approved', () => {
  const r = resolveLinkConsent([])
  assert.equal(r.approved, false)
  assert.equal(r.source, 'none')
  assert.equal(r.state, LINK_CONSENT.PENDING)
})

test('one approved link approves the learner', () => {
  const r = resolveLinkConsent([link('mum', LINK_CONSENT.APPROVED)])
  assert.equal(r.approved, true)
  assert.equal(r.source, 'link')
  assert.deepEqual(r.approvedBy, ['mum'])
})

test('a second guardian who has not clicked yet does NOT un-approve the child', () => {
  const r = resolveLinkConsent([
    link('mum', LINK_CONSENT.APPROVED),
    link('dad', LINK_CONSENT.PENDING),
  ])
  assert.equal(r.approved, true, 'approval is a disjunction — one adult saying yes is enough')
  assert.equal(r.pending, 1)
})

test('a stranger who typed a family code cannot put an approved child into limited mode', () => {
  // The whole reason approval is a disjunction. If it were a conjunction,
  // anyone who guessed a code would hold a veto over the child's account.
  const r = resolveLinkConsent([
    link('mum', LINK_CONSENT.APPROVED),
    link('stranger', LINK_CONSENT.PENDING),
  ])
  assert.equal(r.approved, true)
})

test('withdrawal by the only guardian drops the learner, and reports WHY', () => {
  const r = resolveLinkConsent([link('mum', LINK_CONSENT.WITHDRAWN)])
  assert.equal(r.approved, false)
  assert.equal(r.state, LINK_CONSENT.WITHDRAWN, 'the child is owed "turned off", not "still waiting"')
  assert.equal(r.withdrawn, 1)
})

test('withdrawal by one of two guardians leaves the child approved', () => {
  const r = resolveLinkConsent([
    link('mum', LINK_CONSENT.WITHDRAWN),
    link('dad', LINK_CONSENT.APPROVED),
  ])
  assert.equal(r.approved, true)
  assert.deepEqual(r.approvedBy, ['dad'])
})

test('a withdrawn link plus a pending one reads as pending, not withdrawn', () => {
  // Somebody is actively being asked, so "waiting" is the true sentence.
  const r = resolveLinkConsent([
    link('mum', LINK_CONSENT.WITHDRAWN),
    link('dad', LINK_CONSENT.PENDING),
  ])
  assert.equal(r.state, LINK_CONSENT.PENDING)
})

test('the pre-links account grant still approves, and is labelled as legacy', () => {
  const r = resolveLinkConsent([], {accountStatus: 'granted'})
  assert.equal(r.approved, true, 'the live approved learner base must not go limited on deploy')
  assert.equal(r.source, 'account', 'a caller must be able to tell a derived approval from a real one')
})

test('a link approval outranks the account field as the reported source', () => {
  const r = resolveLinkConsent([link('mum', LINK_CONSENT.APPROVED)], {accountStatus: 'granted'})
  assert.equal(r.source, 'link')
})

test('every non-granted account status leaves the answer to the links', () => {
  for (const status of ['pending', 'denied', 'expired', 'unknown', undefined, null, 'GRANTED']) {
    const r = resolveLinkConsent([], {accountStatus: status})
    assert.equal(r.approved, false, `accountStatus ${JSON.stringify(status)} must not approve`)
  }
})

test('approvedBy is sorted, so the answer is the same on every read', () => {
  const a = resolveLinkConsent([link('zoe', LINK_CONSENT.APPROVED), link('abe', LINK_CONSENT.APPROVED)])
  const b = resolveLinkConsent([link('abe', LINK_CONSENT.APPROVED), link('zoe', LINK_CONSENT.APPROVED)])
  assert.deepEqual(a.approvedBy, b.approvedBy)
  assert.deepEqual(a.approvedBy, ['abe', 'zoe'])
})

console.log('\nresolveLinkPermissions — most restrictive wins')

test('one guardian saying no beats another saying yes', () => {
  const p = resolveLinkPermissions([
    link('mum', LINK_CONSENT.APPROVED, {askZed: true}),
    link('dad', LINK_CONSENT.APPROVED, {askZed: false}),
  ])
  assert.equal(p.askZed, false)
})

test('order does not change the answer', () => {
  const yes = link('mum', LINK_CONSENT.APPROVED, {askZed: true})
  const no = link('dad', LINK_CONSENT.APPROVED, {askZed: false})
  assert.equal(resolveLinkPermissions([yes, no]).askZed, false)
  assert.equal(resolveLinkPermissions([no, yes]).askZed, false)
})

test('yes beats "has not looked" — null is not a restriction', () => {
  const p = resolveLinkPermissions([
    link('mum', LINK_CONSENT.APPROVED, {askZed: true}),
    link('dad', LINK_CONSENT.APPROVED, {}),
  ])
  assert.equal(p.askZed, true)
})

test('nobody having looked resolves to null, not false', () => {
  const p = resolveLinkPermissions([link('mum', LINK_CONSENT.APPROVED, {})])
  for (const key of BOOLEAN_PERMISSION_KEYS) assert.equal(p[key], null)
  assert.equal(p.dailyMinutes, null)
})

test('a PENDING guardian sets no rules', () => {
  // Somebody who has not said they are this child's parent does not get
  // to restrict them — otherwise typing a code is a way to switch off a
  // stranger's Ask Zed.
  const p = resolveLinkPermissions([
    link('mum', LINK_CONSENT.APPROVED, {askZed: true}),
    link('stranger', LINK_CONSENT.PENDING, {askZed: false}),
  ])
  assert.equal(p.askZed, true)
})

test('a WITHDRAWN guardian sets no rules', () => {
  const p = resolveLinkPermissions([
    link('ex', LINK_CONSENT.WITHDRAWN, {askZed: false, dailyMinutes: 5}),
    link('mum', LINK_CONSENT.APPROVED, {askZed: true}),
  ])
  assert.equal(p.askZed, true, "an ex-guardian's rules must not outlive their access")
  assert.equal(p.dailyMinutes, null)
})

test('no approved links means no permissions resolve at all', () => {
  const p = resolveLinkPermissions([link('mum', LINK_CONSENT.PENDING, {askZed: false})])
  assert.equal(p.askZed, null)
})

test('the smallest daily limit wins', () => {
  const p = resolveLinkPermissions([
    link('mum', LINK_CONSENT.APPROVED, {dailyMinutes: 60}),
    link('dad', LINK_CONSENT.APPROVED, {dailyMinutes: 30}),
  ])
  assert.equal(p.dailyMinutes, 30)
})

test('a guardian who set no limit is not treated as having set infinity', () => {
  const p = resolveLinkPermissions([
    link('mum', LINK_CONSENT.APPROVED, {dailyMinutes: 30}),
    link('dad', LINK_CONSENT.APPROVED, {}),
  ])
  assert.equal(p.dailyMinutes, 30, 'an absent limit must not loosen a stated one')
})

test('a limit of zero survives — it is a real answer, not a falsy blank', () => {
  const p = resolveLinkPermissions([
    link('mum', LINK_CONSENT.APPROVED, {dailyMinutes: 0}),
    link('dad', LINK_CONSENT.APPROVED, {dailyMinutes: 45}),
  ])
  assert.equal(p.dailyMinutes, 0)
})

console.log('\nisPermitted — the guardian and the child both get a veto')

test("a guardian's no wins over the child's yes", () => {
  const links = [link('mum', LINK_CONSENT.APPROVED, {askZed: false})]
  assert.equal(isPermitted(links, 'askZed', true), false)
})

test("a guardian's yes does not override a child who switched it off", () => {
  const links = [link('mum', LINK_CONSENT.APPROVED, {askZed: true})]
  assert.equal(isPermitted(links, 'askZed', false), false, 'permitting is not requiring')
})

test('dailyMinutes is refused by name rather than answered as a boolean', () => {
  const links = [link('mum', LINK_CONSENT.APPROVED, {dailyMinutes: 0})]
  assert.equal(isPermitted(links, 'dailyMinutes'), true, 'a quantity is not this function’s question')
})

test('an unknown permission key is not silently governed', () => {
  assert.equal(isPermitted([], 'teleportation'), true)
})

console.log('\nguardianEmailKey — the convergence point')

test('case and surrounding space fold to one key', () => {
  assert.equal(guardianEmailKey('  Mum@Example.COM '), 'mum@example.com')
})

test('a child naming an address and a parent signing up with it converge', () => {
  assert.equal(guardianEmailKey('Mum@Example.com'), guardianEmailKey('mum@example.com '))
})

test('Gmail dot folding is deliberately NOT applied', () => {
  // On a provider that treats them as different people, folding these
  // would attach a child to a stranger.
  assert.notEqual(guardianEmailKey('m.banda@example.com'), guardianEmailKey('mbanda@example.com'))
})

test('anything not shaped like an address yields null, never a blank key', () => {
  for (const bad of ['', '   ', 'mum', 'mum@', '@example.com', 'mum@example', null, 7, {}]) {
    assert.equal(guardianEmailKey(bad), null, `${JSON.stringify(bad)} must not become a claim key`)
  }
})

console.log('\nvocabulary + copy')

test('only the three consent states and two methods are recognised', () => {
  assert.equal(isLinkConsentState('approved'), true)
  assert.equal(isLinkConsentState('denied'), false)
  assert.equal(isLinkMethod('email_link'), true)
  assert.equal(isLinkMethod('sms'), false)
})

test('linkId is the id the collection is already full of', () => {
  assert.equal(linkId('p1', 'k1'), 'p1_k1')
})

test('every state and method has a human sentence', () => {
  for (const s of Object.values(LINK_CONSENT)) {
    assert.notEqual(describeConsentState(s), 'Unknown')
  }
  for (const m of Object.values(LINK_METHOD)) {
    assert.notEqual(describeLinkMethod(m), 'Linked')
  }
  assert.equal(describeConsentState('nonsense'), 'Unknown')
})

console.log(`\n${passed} guardian-link assertions passed`)
if (process.exitCode) {
  console.error('guardian-link tests FAILED')
} 
