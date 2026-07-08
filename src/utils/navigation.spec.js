import { describe, expect, it } from 'vitest'
import { getRoleLandingPath } from './navigation'

describe('getRoleLandingPath', () => {
  it('sends admins / super-admins to /admin', () => {
    expect(getRoleLandingPath({ role: 'admin' })).toBe('/admin')
    expect(getRoleLandingPath({ role: 'superAdmin' })).toBe('/admin')
    expect(getRoleLandingPath('admin')).toBe('/admin')
  })

  it('honours the isAdmin flag even without a matching role', () => {
    expect(getRoleLandingPath({ isAdmin: true })).toBe('/admin')
  })

  it('sends teachers to /teacher (role or isTeacher flag)', () => {
    expect(getRoleLandingPath({ role: 'teacher' })).toBe('/teacher')
    expect(getRoleLandingPath('teacher')).toBe('/teacher')
    expect(getRoleLandingPath({ isTeacher: true })).toBe('/teacher')
  })

  it('sends learners / students to /dashboard', () => {
    expect(getRoleLandingPath({ role: 'learner' })).toBe('/dashboard')
    expect(getRoleLandingPath({ role: 'student' })).toBe('/dashboard')
    expect(getRoleLandingPath('student')).toBe('/dashboard')
  })

  it('prioritises admin over teacher when both flags are set', () => {
    expect(getRoleLandingPath({ isAdmin: true, isTeacher: true })).toBe('/admin')
  })

  it('sends a parent to the family portal', () => {
    expect(getRoleLandingPath({ role: 'parent' })).toBe('/family')
    expect(getRoleLandingPath('parent')).toBe('/family')
    expect(getRoleLandingPath({ isParent: true })).toBe('/family')
  })

  it('falls back to /dashboard by default for unknown roles', () => {
    expect(getRoleLandingPath({ role: 'nonsense' })).toBe('/dashboard')
    expect(getRoleLandingPath(null)).toBe('/dashboard')
    expect(getRoleLandingPath(undefined)).toBe('/dashboard')
  })

  it('uses a caller-supplied fallback when the role is unknown', () => {
    expect(getRoleLandingPath(null, '/login')).toBe('/login')
    expect(getRoleLandingPath({ role: 'nonsense' }, '/')).toBe('/')
    // A recognised role ignores the fallback.
    expect(getRoleLandingPath({ role: 'teacher' }, '/login')).toBe('/teacher')
  })
})
