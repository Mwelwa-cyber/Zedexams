import { describe, expect, it } from 'vitest'
import { getRoleLandingPath, isLearnerOnlyPath, resolvePostAuthPath } from './navigation'

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

describe('isLearnerOnlyPath', () => {
  it('recognises learner routes, with params and query strings', () => {
    expect(isLearnerOnlyPath('/notes')).toBe(true)
    expect(isLearnerOnlyPath('/notes/FEBUorwhAV471eyS9WdB')).toBe(true)
    expect(isLearnerOnlyPath('/notes/abc?insights=1')).toBe(true)
    expect(isLearnerOnlyPath('/quiz/123')).toBe(true)
    expect(isLearnerOnlyPath('/exam/42')).toBe(true)
    expect(isLearnerOnlyPath('/dashboard')).toBe(true)
  })

  it('leaves teacher, admin, family and public paths alone', () => {
    expect(isLearnerOnlyPath('/teacher')).toBe(false)
    expect(isLearnerOnlyPath('/teacher/assessment-papers/abc/edit')).toBe(false)
    expect(isLearnerOnlyPath('/admin/papers')).toBe(false)
    expect(isLearnerOnlyPath('/family')).toBe(false)
    expect(isLearnerOnlyPath('/papers/g7-science')).toBe(false)
    expect(isLearnerOnlyPath('/pricing')).toBe(false)
  })

  it('does not match a segment that merely starts with a learner segment', () => {
    expect(isLearnerOnlyPath('/notesomething')).toBe(false)
    expect(isLearnerOnlyPath('/quizzical')).toBe(false)
  })

  it('classifies nothing for values that are not in-app paths', () => {
    expect(isLearnerOnlyPath('')).toBe(false)
    expect(isLearnerOnlyPath(null)).toBe(false)
    expect(isLearnerOnlyPath(undefined)).toBe(false)
    expect(isLearnerOnlyPath('https://example.com/notes/1')).toBe(false)
  })
})

describe('resolvePostAuthPath', () => {
  const teacher = { role: 'teacher' }
  const learner = { role: 'learner' }

  it('discards a learner destination for a teacher and lands them in their portal', () => {
    // The reported bug: a teacher opened /notes/:id (bookmark, shared link,
    // restored tab), was bounced to /login, signed in — and was sent right
    // back to the learner route, where the guard blocked them.
    expect(resolvePostAuthPath(teacher, '/notes/FEBUorwhAV471eyS9WdB')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/notes/abc?insights=1')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/lessons/l1')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/quiz/123')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/dashboard')).toBe('/teacher')
  })

  it('still returns a teacher to the teacher page they were bounced from', () => {
    expect(resolvePostAuthPath(teacher, '/teacher/assessment-papers/abc/edit?step=quiz'))
      .toBe('/teacher/assessment-papers/abc/edit?step=quiz')
    expect(resolvePostAuthPath(teacher, '/teacher/attendance')).toBe('/teacher/attendance')
  })

  it('leaves learner behaviour unchanged', () => {
    expect(resolvePostAuthPath(learner, '/notes/abc')).toBe('/notes/abc')
    expect(resolvePostAuthPath(learner, '/quiz/123')).toBe('/quiz/123')
    expect(resolvePostAuthPath(learner, null)).toBe('/dashboard')
  })

  it('leaves admin behaviour unchanged — admins pass through the learner portal', () => {
    expect(resolvePostAuthPath({ role: 'admin' }, '/notes/abc')).toBe('/notes/abc')
    // A teacher-flagged admin is an admin first, exactly as getRoleLandingPath reads it.
    expect(resolvePostAuthPath({ isAdmin: true, isTeacher: true }, '/notes/abc')).toBe('/notes/abc')
  })

  it('leaves a parent destination to the route guard, which knows the plan', () => {
    // canAccessLearnerPortal depends on subscription state this function
    // cannot see, so a parent's stashed page is never second-guessed here.
    expect(resolvePostAuthPath({ role: 'parent' }, '/notes/abc')).toBe('/notes/abc')
  })

  it('falls back to the role landing page when there is no stashed page', () => {
    expect(resolvePostAuthPath(teacher, null, '/')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '', '/')).toBe('/teacher')
    expect(resolvePostAuthPath(undefined, null, '/')).toBe('/')
  })

  it('discards a stale or hostile stash rather than navigating to it', () => {
    // A `from` is only ever an in-app path. Anything else — a protocol-relative
    // URL that would leave the site, an absolute URL, a non-string — is dropped.
    expect(resolvePostAuthPath(learner, '//evil.example.com')).toBe('/dashboard')
    expect(resolvePostAuthPath(learner, '/\\evil.example.com')).toBe('/dashboard')
    expect(resolvePostAuthPath(learner, 'https://evil.example.com')).toBe('/dashboard')
    expect(resolvePostAuthPath(learner, 'notes/abc')).toBe('/dashboard')
    expect(resolvePostAuthPath(learner, { pathname: '/notes/abc' })).toBe('/dashboard')
  })

  it('never returns a destination that would bounce again — no redirect loop', () => {
    // Whatever comes back for a teacher is either their own portal or a
    // non-learner path, so the next guard has no reason to move them again.
    for (const from of ['/notes/x', '/exams', '/my-results', '/teacher/help', null]) {
      const target = resolvePostAuthPath(teacher, from, '/')
      expect(isLearnerOnlyPath(target)).toBe(false)
    }
  })
})
