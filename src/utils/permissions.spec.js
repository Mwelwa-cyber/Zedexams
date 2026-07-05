import { describe, expect, it } from 'vitest'
import {
  SUPER_ADMIN_ROLES,
  isSuperAdmin,
  isAdminRole,
  adminPermissionFlags,
  resolvePermissionFlags,
} from './permissions'

// permissions.js is the single authority every admin gate funnels through
// (see the module header). It is dependency-free and pure, so the whole
// contract is unit-testable here. These tests pin the security-relevant
// behaviour: which roles count as admin, the fixed admin capability set,
// and the "never downgrade a flag the profile already grants" rule.

describe('SUPER_ADMIN_ROLES', () => {
  it('contains exactly the two admin roles and is frozen', () => {
    expect(SUPER_ADMIN_ROLES).toEqual(['admin', 'superAdmin'])
    expect(Object.isFrozen(SUPER_ADMIN_ROLES)).toBe(true)
  })
})

describe('isSuperAdmin', () => {
  it('accepts a bare role string', () => {
    expect(isSuperAdmin('admin')).toBe(true)
    expect(isSuperAdmin('superAdmin')).toBe(true)
  })

  it('accepts a user/profile object and reads .role', () => {
    expect(isSuperAdmin({ role: 'admin' })).toBe(true)
    expect(isSuperAdmin({ role: 'superAdmin' })).toBe(true)
  })

  it('rejects every non-admin role', () => {
    expect(isSuperAdmin('learner')).toBe(false)
    expect(isSuperAdmin('teacher')).toBe(false)
    expect(isSuperAdmin('parent')).toBe(false)
    expect(isSuperAdmin({ role: 'teacher' })).toBe(false)
  })

  it('is case-sensitive — "Admin"/"SUPERADMIN" are NOT admin', () => {
    expect(isSuperAdmin('Admin')).toBe(false)
    expect(isSuperAdmin('SUPERADMIN')).toBe(false)
    expect(isSuperAdmin('superadmin')).toBe(false)
  })

  it('is safe for null / undefined / empty / roleless input', () => {
    expect(isSuperAdmin(null)).toBe(false)
    expect(isSuperAdmin(undefined)).toBe(false)
    expect(isSuperAdmin('')).toBe(false)
    expect(isSuperAdmin({})).toBe(false)
    expect(isSuperAdmin({ role: null })).toBe(false)
  })

  it('exposes isAdminRole as the same function', () => {
    expect(isAdminRole).toBe(isSuperAdmin)
  })
})

describe('adminPermissionFlags', () => {
  it('grants the full capability set, all true', () => {
    expect(adminPermissionFlags()).toEqual({
      canAccessAllGrades: true,
      canAccessAllSubjects: true,
      canCreateContent: true,
      canPublishContent: true,
      canAssignQuizzes: true,
      canManageUsers: true,
      canViewReports: true,
    })
  })

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = adminPermissionFlags()
    a.canManageUsers = false
    expect(adminPermissionFlags().canManageUsers).toBe(true)
  })
})

describe('resolvePermissionFlags', () => {
  it('gives super admins the full set regardless of stored flags', () => {
    const flags = resolvePermissionFlags({ role: 'admin' })
    expect(flags).toEqual(adminPermissionFlags())
  })

  it('grants admins the full set even if their profile stores false flags', () => {
    const flags = resolvePermissionFlags({
      role: 'superAdmin',
      canManageUsers: false,
      canPublishContent: false,
    })
    expect(flags.canManageUsers).toBe(true)
    expect(flags.canPublishContent).toBe(true)
  })

  it('defaults every flag to false for a bare non-admin profile', () => {
    expect(resolvePermissionFlags({ role: 'teacher' })).toEqual({
      canAccessAllGrades: false,
      canAccessAllSubjects: false,
      canCreateContent: false,
      canPublishContent: false,
      canAssignQuizzes: false,
      canManageUsers: false,
      canViewReports: false,
    })
  })

  it('keeps a non-admin flag that the profile explicitly grants (true)', () => {
    const flags = resolvePermissionFlags({
      role: 'teacher',
      canCreateContent: true,
      canViewReports: true,
    })
    expect(flags.canCreateContent).toBe(true)
    expect(flags.canViewReports).toBe(true)
    // untouched flags stay false
    expect(flags.canManageUsers).toBe(false)
  })

  it('treats only strict boolean true as a grant (truthy strings do not count)', () => {
    const flags = resolvePermissionFlags({
      role: 'teacher',
      canManageUsers: 'yes',
      canViewReports: 1,
    })
    expect(flags.canManageUsers).toBe(false)
    expect(flags.canViewReports).toBe(false)
  })

  it('is safe for null / undefined input', () => {
    const empty = {
      canAccessAllGrades: false,
      canAccessAllSubjects: false,
      canCreateContent: false,
      canPublishContent: false,
      canAssignQuizzes: false,
      canManageUsers: false,
      canViewReports: false,
    }
    expect(resolvePermissionFlags(null)).toEqual(empty)
    expect(resolvePermissionFlags(undefined)).toEqual(empty)
  })
})
