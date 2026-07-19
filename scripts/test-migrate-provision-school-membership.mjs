#!/usr/bin/env node
/**
 * Unit tests for the pure planning logic in
 * scripts/migrate-provision-school-membership.mjs. No emulator / no
 * firebase-admin — just the deterministic decision function.
 *
 * Run: npm run test:migrate-school-membership  (also via npm run test:all)
 */

import assert from 'node:assert/strict'
import {
  resolveSchoolId,
  mapMembershipRole,
  planProvision,
  buildMembershipDoc,
  buildSchoolDoc,
} from './migrate-provision-school-membership.mjs'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}

// ── resolveSchoolId ──────────────────────────────────────────────
console.log('\nresolveSchoolId — prefers the teaching profile, trims, never guesses')

test('prefers teacherProfile.schoolId over users.schoolId', () => {
  assert.equal(resolveSchoolId({ schoolId: 'from_user' }, { schoolId: 'from_profile' }), 'from_profile')
})
test('falls back to users.schoolId when profile has none', () => {
  assert.equal(resolveSchoolId({ schoolId: 'from_user' }, null), 'from_user')
})
test('trims surrounding whitespace', () => {
  assert.equal(resolveSchoolId({ schoolId: '  school_x  ' }, null), 'school_x')
})
test('returns null when nothing is set (no guessing)', () => {
  assert.equal(resolveSchoolId({ role: 'teacher' }, null), null)
  assert.equal(resolveSchoolId(null, null), null)
})
test('rejects an empty / whitespace-only schoolId', () => {
  assert.equal(resolveSchoolId({ schoolId: '   ' }, null), null)
  assert.equal(resolveSchoolId({ schoolId: '' }, null), null)
})
test('rejects an over-long schoolId (>128 chars)', () => {
  assert.equal(resolveSchoolId({ schoolId: 'x'.repeat(129) }, null), null)
})

// ── mapMembershipRole ────────────────────────────────────────────
console.log('\nmapMembershipRole — platform admins are not school members')

test('teacher/learner/parent map to themselves', () => {
  assert.equal(mapMembershipRole('teacher'), 'teacher')
  assert.equal(mapMembershipRole('learner'), 'learner')
  assert.equal(mapMembershipRole('parent'), 'parent')
})
test('admin/superAdmin map to null (platform, not school)', () => {
  assert.equal(mapMembershipRole('admin'), null)
  assert.equal(mapMembershipRole('superAdmin'), null)
})
test('unknown/empty roles map to null (caller defaults to learner)', () => {
  assert.equal(mapMembershipRole('wizard'), null)
  assert.equal(mapMembershipRole(undefined), null)
})

// ── planProvision ────────────────────────────────────────────────
console.log('\nplanProvision — idempotent, no-guess, no auto-admin')

test('platform admin is never provisioned as a school member', () => {
  const p = planProvision({ uid: 'a', userDoc: { role: 'admin', schoolId: 's1' }, teacherProfile: null, schoolExists: true, membershipExists: false })
  assert.equal(p.status, 'platform')
  assert.equal(p.createMembership, false)
})

test('a user with no trusted schoolId is UNRESOLVED and left untouched', () => {
  const p = planProvision({ uid: 'b', userDoc: { role: 'teacher' }, teacherProfile: null, schoolExists: false, membershipExists: false })
  assert.equal(p.status, 'unresolved')
  assert.equal(p.createMembership, false)
  assert.equal(p.createSchool, false)
})

test('a teacher with a schoolId provisions membership (+ school when missing)', () => {
  const p = planProvision({ uid: 'c', userDoc: { role: 'teacher', schoolId: 's1' }, teacherProfile: null, schoolExists: false, membershipExists: false })
  assert.equal(p.status, 'provision')
  assert.equal(p.schoolId, 's1')
  assert.equal(p.role, 'teacher')
  assert.equal(p.createSchool, true)
  assert.equal(p.createMembership, true)
})

test('an existing membership is never overwritten (idempotent / resumable)', () => {
  const p = planProvision({ uid: 'c', userDoc: { role: 'teacher', schoolId: 's1' }, teacherProfile: null, schoolExists: true, membershipExists: true })
  assert.equal(p.status, 'skip')
  assert.equal(p.createMembership, false)
})

test('when the school already exists, only the membership is created', () => {
  const p = planProvision({ uid: 'd', userDoc: { role: 'learner', schoolId: 's1' }, teacherProfile: null, schoolExists: true, membershipExists: false })
  assert.equal(p.createSchool, false)
  assert.equal(p.createMembership, true)
  assert.equal(p.role, 'learner')
})

test('an unclassified role with a schoolId defaults to the least-privileged learner', () => {
  const p = planProvision({ uid: 'e', userDoc: { role: 'mystery', schoolId: 's1' }, teacherProfile: null, schoolExists: true, membershipExists: false })
  assert.equal(p.status, 'provision')
  assert.equal(p.role, 'learner')
})

test('the plan NEVER produces a school_admin (no auto-appointment)', () => {
  for (const role of ['teacher', 'learner', 'parent', 'mystery']) {
    const p = planProvision({ uid: 'f', userDoc: { role, schoolId: 's1' }, teacherProfile: null, schoolExists: true, membershipExists: false })
    assert.notEqual(p.role, 'school_admin')
  }
})

// ── doc builders ─────────────────────────────────────────────────
console.log('\ndoc builders — shape matches the membership rule')

test('buildMembershipDoc pins uid/schoolId/status and stamps provenance', () => {
  const d = buildMembershipDoc('u1', 's1', 'teacher', 0)
  assert.equal(d.uid, 'u1')
  assert.equal(d.schoolId, 's1')
  assert.equal(d.role, 'teacher')
  assert.equal(d.status, 'active')
  assert.deepEqual(d.classIds, [])
  assert.deepEqual(d.permissions, [])
  assert.match(d.addedBy, /migration/)
})

test('buildSchoolDoc defaults name to the id and marks active', () => {
  const s = buildSchoolDoc('kabulonga', 0)
  assert.equal(s.name, 'kabulonga')
  assert.equal(s.status, 'active')
  assert.match(s.createdBy, /migration/)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}: ${f.message}`))
  process.exit(1)
}
