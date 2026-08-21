/**
 * PortalRouteGuard — a session never renders another portal's screen.
 *
 * The load-bearing assertion is that the other portal's page NEVER renders,
 * not merely that a redirect eventually happens: a guard that draws the
 * learner Navbar and then navigates away has already shown a teacher the
 * learner header, which is what the report was about. So every redirected
 * case asserts the child is absent.
 *
 * Rendered through a real <Routes> table rather than by reading the resolver,
 * because the mapping already has a pure test (`test:portal-redirects`) and
 * what this file is for is the wiring: the guard reads AuthContext's resolved
 * flags, sits above the table, and actually lands somewhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../../contexts/AuthContext'
import PortalRouteGuard from './PortalRouteGuard'

const LEARNER_PROFILE = 'shared-profile-page-under-the-learner-navbar'
const TEACHER_PROFILE = 'teacher-settings-profile-panel'
const FAMILY_ACCOUNT = 'family-account-screen'
const TEACHER_HOME = 'teacher-dashboard'

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    userProfile: null,
    isAdmin: false,
    isTeacher: false,
    isParent: false,
    ...overrides,
  })
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PortalRouteGuard>
        <Routes>
          <Route path="/profile" element={<div>{LEARNER_PROFILE}</div>} />
          <Route path="/settings/profile" element={<div>{TEACHER_PROFILE}</div>} />
          <Route path="/family/account" element={<div>{FAMILY_ACCOUNT}</div>} />
          <Route path="/teacher" element={<div>{TEACHER_HOME}</div>} />
        </Routes>
      </PortalRouteGuard>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('PortalRouteGuard', () => {
  it('never renders the shared /profile page for a teacher', () => {
    setAuth({ userProfile: { role: 'teacher' }, isTeacher: true })
    renderAt('/profile')

    expect(screen.queryByText(LEARNER_PROFILE)).not.toBeInTheDocument()
    expect(screen.getByText(TEACHER_PROFILE)).toBeInTheDocument()
  })

  it('never renders it for a parent either', () => {
    setAuth({ userProfile: { role: 'parent' }, isParent: true })
    renderAt('/profile')

    expect(screen.queryByText(LEARNER_PROFILE)).not.toBeInTheDocument()
    expect(screen.getByText(FAMILY_ACCOUNT)).toBeInTheDocument()
  })

  it('leaves a learner on their own profile', () => {
    setAuth({ userProfile: { role: 'learner' } })
    renderAt('/profile')

    expect(screen.getByText(LEARNER_PROFILE)).toBeInTheDocument()
  })

  it('leaves an admin on it — including one AuthContext also flags as a teacher', () => {
    // isTeacher is true for every super-admin (AuthContext), so a guard that
    // asked about teachers first would move every admin into the teacher
    // shell. Admins keep the learner surfaces on purpose: support.
    setAuth({ userProfile: { role: 'superAdmin' }, isAdmin: true, isTeacher: true })
    renderAt('/profile')

    expect(screen.getByText(LEARNER_PROFILE)).toBeInTheDocument()
  })

  it('leaves a teacher on a teacher route', () => {
    setAuth({ userProfile: { role: 'teacher' }, isTeacher: true })
    renderAt('/teacher')

    expect(screen.getByText(TEACHER_HOME)).toBeInTheDocument()
  })

  it('does not redirect the destination it just sent a teacher to', () => {
    // The loop the pure test asserts, proved through the router: landing on
    // /settings/profile must be somewhere a teacher can stay.
    setAuth({ userProfile: { role: 'teacher' }, isTeacher: true })
    renderAt('/settings/profile')

    expect(screen.getByText(TEACHER_PROFILE)).toBeInTheDocument()
  })

  it('renders as-is while the profile is still loading', () => {
    // Redirecting on an absent profile would bounce every signed-out visitor
    // off the public routes in the maps on the first frame.
    setAuth({ userProfile: null, isTeacher: true })
    renderAt('/profile')

    expect(screen.getByText(LEARNER_PROFILE)).toBeInTheDocument()
  })
})
