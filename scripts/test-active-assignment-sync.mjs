// Tests for the active-assignment cross-device sync decision core.
// Run: npm run test:active-assignment-sync
import assert from 'node:assert/strict'
import {
  planRemoteAdoption,
  REMOTE_ACTIVE_ASSIGNMENT_EVENT,
} from '../src/utils/activeAssignmentSyncCore.js'
import { dashboardAdoptionPlan } from '../src/features/teacherHome/lib/dashboardAssignmentAdoption.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    throw err
  }
}

const ACTIVE = { grade: 'G5', subject: 'mathematics', curriculumType: 'cbc', isActive: true }

test('empty remote id → none (never clears a local pick)', () => {
  assert.deepEqual(planRemoteAdoption({ remoteId: '', localId: 'a1' }), { action: 'none' })
  assert.deepEqual(planRemoteAdoption({ remoteId: undefined, localId: 'a1' }), { action: 'none' })
  assert.deepEqual(planRemoteAdoption({ remoteId: '   ', localId: '' }), { action: 'none' })
})

test('remote equals local → none (in sync; own-write echo is silent)', () => {
  assert.deepEqual(planRemoteAdoption({ remoteId: 'a1', localId: 'a1' }), { action: 'none' })
  assert.deepEqual(planRemoteAdoption({ remoteId: ' a1 ', localId: 'a1' }), { action: 'none' })
})

test('remote differs, assignment not yet fetched → fetch', () => {
  assert.deepEqual(planRemoteAdoption({ remoteId: 'a2', localId: 'a1' }), { action: 'fetch', id: 'a2' })
  // A device with no local pick still validates before adopting.
  assert.deepEqual(planRemoteAdoption({ remoteId: 'a2', localId: '' }), { action: 'fetch', id: 'a2' })
})

test('fetched assignment missing (null) → ignore, never adopt a dangling id', () => {
  assert.deepEqual(planRemoteAdoption({ remoteId: 'a2', localId: 'a1', assignment: null }), { action: 'ignore' })
})

test('deactivated assignment → ignore', () => {
  const plan = planRemoteAdoption({ remoteId: 'a2', localId: 'a1', assignment: { ...ACTIVE, isActive: false } })
  assert.deepEqual(plan, { action: 'ignore' })
})

test('assignment with no grade and no subject → ignore (no usable seed)', () => {
  const plan = planRemoteAdoption({ remoteId: 'a2', localId: 'a1', assignment: { curriculumType: 'cbc', isActive: true } })
  assert.deepEqual(plan, { action: 'ignore' })
})

test('valid active assignment → adopt with the selector seed', () => {
  const plan = planRemoteAdoption({ remoteId: 'a2', localId: 'a1', assignment: ACTIVE })
  assert.equal(plan.action, 'adopt')
  assert.equal(plan.id, 'a2')
  assert.deepEqual(plan.seed, { curriculum: 'cbc', grade: 'G5', subject: 'mathematics' })
})

test('legacy curriculum value normalizes into the seed', () => {
  const plan = planRemoteAdoption({
    remoteId: 'a2',
    localId: '',
    assignment: { grade: 'G7', subject: 'english', curriculumType: 'previous', isActive: true },
  })
  assert.equal(plan.action, 'adopt')
  assert.deepEqual(plan.seed, { curriculum: 'previous', grade: 'G7', subject: 'english' })
  // Unknown curriculum values fall back to cbc (normalizeCurriculumType).
  const junk = planRemoteAdoption({
    remoteId: 'a3',
    localId: '',
    assignment: { grade: 'G7', subject: 'english', curriculumType: 'martian', isActive: true },
  })
  assert.equal(junk.seed.curriculum, 'cbc')
})

test('isActive defaults to true for legacy assignment docs missing the flag', () => {
  const plan = planRemoteAdoption({
    remoteId: 'a2',
    localId: 'a1',
    assignment: { grade: 'G4', subject: 'science' },
  })
  assert.equal(plan.action, 'adopt')
})

test('non-object assignment shapes → ignore, never throw', () => {
  for (const bad of ['x', 42, true]) {
    assert.deepEqual(planRemoteAdoption({ remoteId: 'a2', localId: 'a1', assignment: bad }), { action: 'ignore' })
  }
})

test('event name is the stable public contract', () => {
  assert.equal(REMOTE_ACTIVE_ASSIGNMENT_EVENT, 'zedexams:active-assignment-remote-change')
})

// ── dashboardAdoptionPlan (the dashboard's decision table) ──────────────────

const KNOWN = ['a1', 'a2']

test('cross-tab pick of a KNOWN assignment → silent adoption (no notice)', () => {
  assert.deepEqual(dashboardAdoptionPlan({ id: 'a2', source: 'cross-tab', knownIds: KNOWN }), { action: 'adopt-silent' })
})

test('cross-tab pick of an UNKNOWN assignment (created after this tab loaded) → ignore', () => {
  // Keep the current valid assignment; never clear the selector, never guess,
  // never write back. The next mount loads the latest list.
  assert.deepEqual(dashboardAdoptionPlan({ id: 'a-new', source: 'cross-tab', knownIds: KNOWN }), { action: 'ignore' })
})

test('cross-tab: deleted-before-resolution / other-teacher assignment ids are also unknown → ignore', () => {
  assert.deepEqual(dashboardAdoptionPlan({ id: 'a-deleted', source: 'cross-tab', knownIds: [] }), { action: 'ignore' })
})

test('remote change to a known assignment → adopt with notice, no reload', () => {
  assert.deepEqual(dashboardAdoptionPlan({ id: 'a1', source: 'remote', knownIds: KNOWN }), { action: 'adopt-notice', reload: false })
})

test('remote change to an unknown assignment → adopt with notice + one list reload', () => {
  // The sync listener already validated it against Firestore; only the
  // mount-time list is stale, so a targeted refresh resolves the selector.
  assert.deepEqual(dashboardAdoptionPlan({ id: 'a-new', source: 'remote', knownIds: KNOWN }), { action: 'adopt-notice', reload: true })
})

test('malformed / empty ids → ignore, never an empty selector state', () => {
  assert.deepEqual(dashboardAdoptionPlan({ id: '', source: 'cross-tab', knownIds: KNOWN }), { action: 'ignore' })
  assert.deepEqual(dashboardAdoptionPlan({ id: '   ', source: 'remote', knownIds: KNOWN }), { action: 'ignore' })
  assert.deepEqual(dashboardAdoptionPlan({ id: 42, source: 'cross-tab', knownIds: KNOWN }), { action: 'ignore' })
  assert.deepEqual(dashboardAdoptionPlan(), { action: 'ignore' })
})

test('no plan ever writes back or clears: the only actions are ignore/adopt-silent/adopt-notice', () => {
  for (const source of ['cross-tab', 'remote']) {
    for (const id of ['a1', 'a-new', '']) {
      const plan = dashboardAdoptionPlan({ id, source, knownIds: KNOWN })
      assert.ok(['ignore', 'adopt-silent', 'adopt-notice'].includes(plan.action), `${source}/${id} → ${plan.action}`)
    }
  }
})

console.log(`\n─── ${passed} tests · ${passed} passed · 0 failed ───`)
