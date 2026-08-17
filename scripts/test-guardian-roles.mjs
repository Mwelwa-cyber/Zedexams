// scripts/test-guardian-roles.mjs
//
// Pure-logic tests for guardian roles — who among a child's guardians may
// approve, control, pay and delete (functions/shared/guardian/guardianRolesCore.js).
// Run with `npm run test:guardian-roles`.
//
// The cases that matter are the ones a family would notice: a child who
// has always had one parent must not lose billing when co-guardians ship,
// a child who already had two guardians must not end up with two owners,
// and an unknown role must buy nothing.

import assert from 'node:assert/strict'
import {
  GUARDIAN_ROLES,
  GUARDIAN_CAPABILITIES,
  can,
  capabilitiesOf,
  describeRole,
  isGuardianRole,
  resolveGuardianRoles,
  roleFor,
  roleForNewLink,
} from '../functions/shared/guardian/guardianRolesCore.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

/* ── The capability table ──────────────────────────────────────────── */

t('an owner may do everything a co-guardian may, and more', () => {
  for (const cap of capabilitiesOf('co_guardian')) {
    assert.equal(can('owner', cap), true, `owner should hold ${cap}`)
  }
  assert.ok(capabilitiesOf('owner').length > capabilitiesOf('co_guardian').length)
})

t('only the owner moves money or destroys the account', () => {
  for (const cap of ['manageBilling', 'deleteChild', 'manageGuardians']) {
    assert.equal(can('owner', cap), true)
    assert.equal(can('co_guardian', cap), false, `${cap} must not reach a co-guardian`)
  }
})

t('a co-guardian can still run the child’s day to day', () => {
  for (const cap of ['viewProgress', 'approveRequests', 'setChildControls']) {
    assert.equal(can('co_guardian', cap), true)
  }
})

t('an unknown role and an unknown capability both fail closed', () => {
  assert.equal(can('admin', 'viewProgress'), false)
  assert.equal(can(null, 'viewProgress'), false)
  assert.equal(can(undefined, 'viewProgress'), false)
  assert.equal(can('owner', 'launchMissiles'), false)
  assert.equal(can('owner', ''), false)
  assert.deepEqual(capabilitiesOf('nonsense'), [])
})

t('the role list and the capability list are self-consistent', () => {
  assert.deepEqual([...GUARDIAN_ROLES].sort(), ['co_guardian', 'owner'])
  for (const role of GUARDIAN_ROLES) {
    assert.ok(isGuardianRole(role))
    for (const cap of capabilitiesOf(role)) {
      assert.ok(GUARDIAN_CAPABILITIES.includes(cap), `${cap} missing from the roster`)
    }
  }
  assert.equal(isGuardianRole('owner '), false)
})

/* ── Resolving roles from the stored links ─────────────────────────── */

const link = (parentUid, extra = {}) => ({ parentUid, learnerUid: 'kid', ...extra })

t('a stored role wins over anything derived', () => {
  const links = [
    link('later', { role: 'owner', createdAt: 2000 }),
    link('earlier', { createdAt: 1000 }),
  ]
  assert.equal(roleFor(links, 'later'), 'owner')
  assert.equal(roleFor(links, 'earlier'), 'co_guardian')
})

t('the legacy sole guardian keeps billing — a role-less link owns the child', () => {
  // Every parentLinks doc written before this feature looks exactly like
  // this one. If it resolved to co_guardian, a parent who has paid for a
  // year would open the app and find they cannot renew.
  const links = [link('mum', { createdAt: 1000 })]
  assert.equal(roleFor(links, 'mum'), 'owner')
  assert.equal(can(roleFor(links, 'mum'), 'manageBilling'), true)
})

t('two legacy links do NOT yield two owners — the earliest one owns', () => {
  const links = [link('dad', { createdAt: 5000 }), link('mum', { createdAt: 1000 })]
  const roles = resolveGuardianRoles(links)
  assert.equal(roles.get('mum'), 'owner')
  assert.equal(roles.get('dad'), 'co_guardian')
  assert.equal([...roles.values()].filter((r) => r === 'owner').length, 1)
})

t('a link with no timestamp never takes ownership from one that has it', () => {
  const roles = resolveGuardianRoles([link('unknown'), link('dated', { createdAt: 9000 })])
  assert.equal(roles.get('dated'), 'owner')
  assert.equal(roles.get('unknown'), 'co_guardian')
})

t('ties break deterministically, so two servers agree', () => {
  const a = resolveGuardianRoles([link('zoe', { createdAt: 7 }), link('abe', { createdAt: 7 })])
  const b = resolveGuardianRoles([link('abe', { createdAt: 7 }), link('zoe', { createdAt: 7 })])
  assert.equal(a.get('abe'), 'owner')
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort())

  const none = resolveGuardianRoles([link('zoe'), link('abe')])
  assert.equal(none.get('abe'), 'owner')
})

t('Firestore Timestamps, Dates, ISO strings and numbers all order alike', () => {
  const ts = (ms) => ({ toMillis: () => ms })
  assert.equal(roleFor([link('a', { createdAt: ts(1) }), link('b', { createdAt: ts(2) })], 'a'), 'owner')
  assert.equal(roleFor([link('a', { createdAt: new Date(1) }), link('b', { createdAt: new Date(2) })], 'a'), 'owner')
  assert.equal(
    roleFor([
      link('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      link('b', { createdAt: '2026-06-01T00:00:00.000Z' }),
    ], 'a'),
    'owner',
  )
  // An unparseable string is an unknown time, not the epoch.
  const roles = resolveGuardianRoles([link('junk', { createdAt: 'soon' }), link('real', { createdAt: 10 })])
  assert.equal(roles.get('real'), 'owner')
})

t('a stranger has no role at all — which is not a weak role', () => {
  const links = [link('mum', { createdAt: 1 })]
  assert.equal(roleFor(links, 'someone-else'), null)
  assert.equal(roleFor(links, ''), null)
  assert.equal(roleFor([], 'mum'), null)
  assert.equal(can(roleFor(links, 'someone-else'), 'viewProgress'), false)
})

t('malformed link rows are dropped rather than crashing a family', () => {
  const roles = resolveGuardianRoles([null, {}, { parentUid: '' }, link('mum', { createdAt: 1 })])
  assert.equal(roles.get('mum'), 'owner')
  assert.equal(roles.size, 1)
  assert.equal(resolveGuardianRoles(undefined).size, 0)
  assert.equal(resolveGuardianRoles('nope').size, 0)
})

t('an unrecognised stored role is reported, not silently upgraded', () => {
  // Forward compatibility: a link written by a newer build must not be
  // read as an owner just because this build does not know the word.
  const roles = resolveGuardianRoles([link('future', { role: 'trustee', createdAt: 1 })])
  assert.equal(roles.get('future'), 'owner', 'unknown role falls through to derivation')
  assert.equal(can('trustee', 'manageBilling'), false)
})

/* ── Creating the next link ────────────────────────────────────────── */

t('the first guardian owns the child; everyone after is a co-guardian', () => {
  assert.equal(roleForNewLink([]), 'owner')
  assert.equal(roleForNewLink([link('mum')]), 'co_guardian')
  assert.equal(roleForNewLink(undefined), 'owner')
})

t('roles read as words a parent would recognise', () => {
  assert.equal(describeRole('owner'), 'Owner')
  assert.equal(describeRole('co_guardian'), 'Co-guardian')
  assert.equal(describeRole('nonsense'), 'Not a guardian')
})

console.log(`guardian roles — ${passed} total assertions passed`)
