import { describe, expect, it } from 'vitest'
import { normalizeRole, normalizeUserProfile } from './roles'

describe('normalizeRole', () => {
  it('collapses admin aliases to "admin"', () => {
    for (const alias of ['admin', 'administrator', 'superadmin', 'super_admin', 'super-admin']) {
      expect(normalizeRole(alias)).toBe('admin')
    }
  })

  it('collapses teacher aliases to "teacher"', () => {
    expect(normalizeRole('teacher')).toBe('teacher')
    expect(normalizeRole('educator')).toBe('teacher')
  })

  it('collapses learner aliases to "learner"', () => {
    for (const alias of ['learner', 'student', 'pupil']) {
      expect(normalizeRole(alias)).toBe('learner')
    }
  })

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeRole('  TEACHER  ')).toBe('teacher')
    expect(normalizeRole('Student')).toBe('learner')
  })

  it('returns null for empty / nullish input', () => {
    expect(normalizeRole('')).toBeNull()
    expect(normalizeRole(null)).toBeNull()
    expect(normalizeRole(undefined)).toBeNull()
  })

  it('passes unknown roles through untouched (lowercased)', () => {
    expect(normalizeRole('Parent')).toBe('parent')
  })
})

describe('normalizeUserProfile', () => {
  it('returns null when there is no data', () => {
    expect(normalizeUserProfile('uid', null)).toBeNull()
  })

  it('attaches the uid as id and normalises the role', () => {
    const out = normalizeUserProfile('uid-1', { role: 'Educator', name: 'Mr T' })
    expect(out).toMatchObject({ id: 'uid-1', role: 'teacher', name: 'Mr T' })
  })

  it('keeps grade for learners', () => {
    const out = normalizeUserProfile('uid-2', { role: 'student', grade: '7' })
    expect(out.grade).toBe('7')
  })

  it('clears grade for non-learners (no leaking a stale grade)', () => {
    expect(normalizeUserProfile('uid-3', { role: 'teacher', grade: '7' }).grade).toBeNull()
    expect(normalizeUserProfile('uid-4', { role: 'admin', grade: '5' }).grade).toBeNull()
  })

  it('defaults a learner with no grade to null', () => {
    expect(normalizeUserProfile('uid-5', { role: 'learner' }).grade).toBeNull()
  })
})
