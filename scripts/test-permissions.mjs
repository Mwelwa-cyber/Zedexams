#!/usr/bin/env node
/**
 * Unit tests for src/utils/permissions.js.
 *
 * This is the single source of truth that every admin gate in the app
 * funnels through. A regression here would either lock super admins out
 * of the admin portal or — worse — silently downgrade a flag a non-admin
 * already had granted on their profile. Both have happened during past
 * refactors; pin the behaviour.
 *
 * Pure-Node test, no Firebase emulator needed. Wired into npm run test:all.
 */

import assert from 'node:assert/strict'

import {
  SUPER_ADMIN_ROLES,
  isSuperAdmin,
  isAdminRole,
  adminPermissionFlags,
  resolvePermissionFlags,
} from '../src/utils/permissions.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function section(label) {
  console.log(`\n${label}`)
}

// ── SUPER_ADMIN_ROLES ───────────────────────────────────────────

section('SUPER_ADMIN_ROLES — constant shape')

test('contains both legacy admin and new superAdmin role', () => {
  assert.deepEqual([...SUPER_ADMIN_ROLES], ['admin', 'superAdmin'])
})

test('is frozen (cannot be mutated at runtime)', () => {
  assert.throws(() => { SUPER_ADMIN_ROLES.push('rogue') })
  assert.equal(SUPER_ADMIN_ROLES.length, 2)
})

// ── isSuperAdmin ────────────────────────────────────────────────

section('isSuperAdmin — accepts both bare role string and profile object')

test('returns true for role string "admin"', () => {
  assert.equal(isSuperAdmin('admin'), true)
})

test('returns true for role string "superAdmin"', () => {
  assert.equal(isSuperAdmin('superAdmin'), true)
})

test('returns true for profile object { role: "admin" }', () => {
  assert.equal(isSuperAdmin({ role: 'admin' }), true)
})

test('returns true for profile object { role: "superAdmin" }', () => {
  assert.equal(isSuperAdmin({ role: 'superAdmin' }), true)
})

test('returns false for role string "teacher"', () => {
  assert.equal(isSuperAdmin('teacher'), false)
})

test('returns false for role string "learner"', () => {
  assert.equal(isSuperAdmin('learner'), false)
})

test('returns false for null', () => {
  assert.equal(isSuperAdmin(null), false)
})

test('returns false for undefined', () => {
  assert.equal(isSuperAdmin(undefined), false)
})

test('returns false for an empty object (no role)', () => {
  assert.equal(isSuperAdmin({}), false)
})

test('returns false for a profile with an unrecognised role', () => {
  // Defence-in-depth: a typo like "Admin" (capitalised) must not be
  // accepted. Roles are case-sensitive throughout the app.
  assert.equal(isSuperAdmin({ role: 'Admin' }), false)
  assert.equal(isSuperAdmin({ role: 'ADMIN' }), false)
})

test('does not falsely match arbitrary truthy values', () => {
  assert.equal(isSuperAdmin(1), false)
  assert.equal(isSuperAdmin(true), false)
  assert.equal(isSuperAdmin([]), false)
})

test('isAdminRole is the same function as isSuperAdmin (readability alias)', () => {
  assert.equal(isAdminRole, isSuperAdmin)
})

// ── adminPermissionFlags ────────────────────────────────────────

section('adminPermissionFlags — canonical super-admin capability set')

test('returns every gate set to true', () => {
  const flags = adminPermissionFlags()
  assert.deepEqual(flags, {
    canAccessAllGrades: true,
    canAccessAllSubjects: true,
    canCreateContent: true,
    canPublishContent: true,
    canAssignQuizzes: true,
    canManageUsers: true,
    canViewReports: true,
  })
})

test('returns a fresh object each call (no shared mutable reference)', () => {
  const a = adminPermissionFlags()
  const b = adminPermissionFlags()
  assert.notEqual(a, b, 'callers must be able to mutate without affecting other callers')
  a.canManageUsers = false
  assert.equal(b.canManageUsers, true, 'mutating one copy must not leak into another')
})

// ── resolvePermissionFlags ──────────────────────────────────────

section('resolvePermissionFlags — never downgrades, always upgrades for admins')

test('admin profile gets the full set even when stored flags are missing', () => {
  const resolved = resolvePermissionFlags({ role: 'admin' })
  assert.deepEqual(resolved, adminPermissionFlags())
})

test('superAdmin profile gets the full set even when stored flags are missing', () => {
  const resolved = resolvePermissionFlags({ role: 'superAdmin' })
  assert.deepEqual(resolved, adminPermissionFlags())
})

test('admin profile is not downgraded when stored flags are explicitly false', () => {
  // Regression guard: PR #512 super-admin meter bypass leans on this
  // — a future tweak that "respects" stored false values would lock
  // every super admin out of every gate the moment a profile saved
  // them as false.
  const resolved = resolvePermissionFlags({
    role: 'admin',
    canAccessAllGrades: false,
    canAccessAllSubjects: false,
    canCreateContent: false,
    canPublishContent: false,
    canAssignQuizzes: false,
    canManageUsers: false,
    canViewReports: false,
  })
  assert.deepEqual(resolved, adminPermissionFlags())
})

test('learner profile with no flags resolves to all false', () => {
  const resolved = resolvePermissionFlags({ role: 'learner' })
  assert.deepEqual(resolved, {
    canAccessAllGrades: false,
    canAccessAllSubjects: false,
    canCreateContent: false,
    canPublishContent: false,
    canAssignQuizzes: false,
    canManageUsers: false,
    canViewReports: false,
  })
})

test('teacher profile preserves explicitly granted flags', () => {
  const resolved = resolvePermissionFlags({
    role: 'teacher',
    canCreateContent: true,
    canPublishContent: true,
    canAssignQuizzes: true,
  })
  assert.equal(resolved.canCreateContent, true)
  assert.equal(resolved.canPublishContent, true)
  assert.equal(resolved.canAssignQuizzes, true)
  assert.equal(resolved.canManageUsers, false, 'unset flag must default to false')
  assert.equal(resolved.canViewReports, false)
})

test('non-admin truthy-but-not-true flag is rejected (must be strictly true)', () => {
  // The implementation uses `=== true` precisely so that a stored value
  // of "true", 1, or "yes" doesn't accidentally grant a permission.
  const resolved = resolvePermissionFlags({
    role: 'teacher',
    canManageUsers: 'true',
    canViewReports: 1,
  })
  assert.equal(resolved.canManageUsers, false, 'string "true" must not grant the flag')
  assert.equal(resolved.canViewReports, false, 'numeric 1 must not grant the flag')
})

test('null/undefined profile resolves to all false (no crash)', () => {
  // Auth context can briefly hand resolvePermissionFlags a null user
  // during sign-out — must not throw.
  const resolvedNull = resolvePermissionFlags(null)
  const resolvedUndef = resolvePermissionFlags(undefined)
  for (const flag of Object.keys(adminPermissionFlags())) {
    assert.equal(resolvedNull[flag], false, `null profile leaked ${flag}=true`)
    assert.equal(resolvedUndef[flag], false, `undefined profile leaked ${flag}=true`)
  }
})

test('admin role wins even if the profile also carries explicit flags', () => {
  // Spread-after ensures admin defaults override the resolved-base. This
  // pins the "admin always gets everything" contract regardless of
  // what's stored on Firestore.
  const resolved = resolvePermissionFlags({
    role: 'admin',
    canManageUsers: false,
    canViewReports: false,
  })
  assert.equal(resolved.canManageUsers, true)
  assert.equal(resolved.canViewReports, true)
})

test('unrecognised role does NOT grant admin flags (typo-safety)', () => {
  // A typo like "Admin" or "owner" must not silently elevate the user.
  for (const fakeRole of ['Admin', 'owner', 'staff', 'super', '']) {
    const resolved = resolvePermissionFlags({ role: fakeRole, canManageUsers: true })
    assert.equal(resolved.canManageUsers, true, 'explicit grant should still pass through')
    assert.equal(resolved.canAccessAllGrades, false, `role "${fakeRole}" must not get admin defaults`)
  }
})

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
