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
    expect(isLearnerOnlyPath('/daily')).toBe(true)
    // `/exam/:id` is no longer learner-only: the Daily Exam rotation was
    // replaced by the Daily Quiz and the path is now a plain redirect into
    // /daily, so treating it as learner-only would discard a destination a
    // teacher is entitled to. `/exam-results/:id` IS still learner-only —
    // a learner's past attempts outlived the mechanism that produced them.
    expect(isLearnerOnlyPath('/exam/42')).toBe(false)
    expect(isLearnerOnlyPath('/exam-results/42')).toBe(true)
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

  it('discards a SHARED page the teacher portal does not own', () => {
    // The reported bug: "every time I log in to the teacher's portal, it
    // brings me to this page" — /profile, under the learner Navbar (Notes,
    // Lessons, Practise), on a page whose own back link read "Back to
    // Teacher". ProtectedRoute stashes the page you asked for and Login
    // honours the stash; /profile is NOT in LEARNER_ONLY_SEGMENTS (an admin
    // and a learner both render it), so the learner-only correction above
    // never fired and the teacher was returned there on every sign-in.
    expect(resolvePostAuthPath(teacher, '/profile')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/profile?tab=badges')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/my-badges')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/my-subscription')).toBe('/teacher')
    expect(resolvePostAuthPath(teacher, '/ask-a-grown-up')).toBe('/teacher')
  })

  it('discards rather than maps — sign-in opens the dashboard, not the equivalent page', () => {
    // PortalRouteGuard sends a teacher from /profile to /settings/profile
    // mid-session, because there they asked for that page. Sign-in is the one
    // moment when the account's own home is what was asked for, so the stash
    // is dropped rather than translated.
    expect(resolvePostAuthPath(teacher, '/profile')).not.toBe('/settings/profile')
  })

  it('leaves a teacher on the shared surfaces their portal does own', () => {
    // /settings is role-branched into TeacherSettings inside TeacherLayout,
    // and /offline renders in the teacher shell too — both are the teacher's
    // own pages, so a stash pointing at either is honoured.
    expect(resolvePostAuthPath(teacher, '/settings/profile')).toBe('/settings/profile')
    expect(resolvePostAuthPath(teacher, '/settings')).toBe('/settings')
    expect(resolvePostAuthPath(teacher, '/offline')).toBe('/offline')
    // The past-paper archive is deliberately open to teachers.
    expect(resolvePostAuthPath(teacher, '/papers/g7-science')).toBe('/papers/g7-science')
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
    // /profile IS the learner's own page — the cross-portal check must not
    // widen into "shared pages are nobody's".
    expect(resolvePostAuthPath(learner, '/profile')).toBe('/profile')
  })

  it('leaves admin behaviour unchanged — admins pass through the learner portal', () => {
    expect(resolvePostAuthPath({ role: 'admin' }, '/notes/abc')).toBe('/notes/abc')
    // A teacher-flagged admin is an admin first, exactly as getRoleLandingPath reads it.
    expect(resolvePostAuthPath({ isAdmin: true, isTeacher: true }, '/notes/abc')).toBe('/notes/abc')
    // …including on the shared surfaces the teacher table names. AuthContext
    // sets isTeacher true for super-admins, so a check that asked about
    // teachers first would move every admin into the teacher shell.
    expect(resolvePostAuthPath({ role: 'admin' }, '/profile')).toBe('/profile')
    expect(resolvePostAuthPath({ isAdmin: true, isTeacher: true }, '/profile')).toBe('/profile')
  })

  it('discards a learner destination for a parent who cannot open the learner portal', () => {
    // The reported bug, from the family side: a parent opened a learner
    // /notes/:id link, signed in, and was sent straight back to it — where the
    // guard refused them with a card about teacher accounts. This function
    // used to leave a parent's stash alone on the grounds that plan state was
    // invisible here; it is not, and reading it is what keeps this answer and
    // the guard's answer the same one.
    expect(resolvePostAuthPath({ role: 'parent' }, '/notes/y5YBurkQOKGkVp3ju7IN?mode=revise')).toBe('/family')
    expect(resolvePostAuthPath({ role: 'parent' }, '/dashboard')).toBe('/family')
  })

  it('still returns a parent to the family page they were bounced from', () => {
    expect(resolvePostAuthPath({ role: 'parent' }, '/family/account/billing')).toBe('/family/account/billing')
    expect(resolvePostAuthPath({ role: 'parent' }, '/papers/g7-science')).toBe('/papers/g7-science')
  })

  it('honours a learner destination for a parent whose plan opens the learner portal', () => {
    // The same predicate LearnerOnlyRoute reads: a premium guardian passes the
    // guard, so sending them to their landing page instead would strand them
    // away from a page that would have opened.
    const premiumParent = {
      role: 'parent',
      subscriptionStatus: 'active',
      subscriptionExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }
    expect(resolvePostAuthPath(premiumParent, '/notes/abc')).toBe('/notes/abc')
  })

  it('discards a learner destination for a role it does not recognise', () => {
    // Not a judgement about that role — the guard refuses it, so landing them
    // there would be a sign-in that ends on a refusal card.
    expect(resolvePostAuthPath({ role: 'nonsense' }, '/notes/abc', '/')).toBe('/')
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
    // And the same for a parent, whose landing page is /family.
    for (const from of ['/notes/x', '/exams', '/my-results', '/family/children', null]) {
      const target = resolvePostAuthPath({ role: 'parent' }, from, '/')
      expect(isLearnerOnlyPath(target)).toBe(false)
    }
  })
})
