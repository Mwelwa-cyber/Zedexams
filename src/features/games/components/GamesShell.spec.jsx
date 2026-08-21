/**
 * The games chrome's home button, by audience.
 *
 * `/games` and `/games/play/:id` are PUBLIC routes, so this header is drawn
 * for teachers as well as learners. The button was gated on being signed in
 * and pointed at `/dashboard` — a `<LearnerOnlyRoute>` page — so a signed-in
 * teacher got a button carrying their own first name that answered "Teacher
 * accounts stay in the teacher portal". Same defect as the learner tab bar,
 * on a different surface, and it survived the tab bar's fix because it is
 * ordinary page content rather than a nav registry.
 *
 * Asserted on the rendered href because the destination is now computed:
 * `test:learner-link-audience` scans for string literals and cannot see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../lib/gameSounds', () => ({ isMuted: () => true, toggleMute: vi.fn() }))

const mockAuth = { currentUser: null, userProfile: null, isAdmin: false, isTeacher: false }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

import GamesShell from './GamesShell'

function signedInAs(role, flags = {}) {
  mockAuth.currentUser = { uid: 'u1' }
  mockAuth.userProfile = { role, displayName: 'Chanda Mwale' }
  mockAuth.isAdmin = flags.isAdmin ?? false
  mockAuth.isTeacher = flags.isTeacher ?? false
}

function homeHref() {
  render(
    <MemoryRouter initialEntries={['/games']}>
      <GamesShell><div>PAGE</div></GamesShell>
    </MemoryRouter>,
  )
  return screen.getByRole('link', { name: /chanda/i }).getAttribute('href')
}

beforeEach(() => {
  mockAuth.currentUser = null
  mockAuth.userProfile = null
  mockAuth.isAdmin = false
  mockAuth.isTeacher = false
})

describe('GamesShell home button', () => {
  it('sends a teacher to the teacher portal, not to the refusal card', () => {
    signedInAs('teacher', { isTeacher: true })
    expect(homeHref()).toBe('/teacher')
  })

  it('leaves a learner on their dashboard', () => {
    signedInAs('learner')
    expect(homeHref()).toBe('/dashboard')
  })

  it('leaves an admin on the learner dashboard they can open', () => {
    // An admin passes LearnerOnlyRoute on role alone. Sending them to /admin
    // would eject them from a learner surface they reached deliberately.
    signedInAs('superAdmin', { isAdmin: true, isTeacher: true })
    expect(homeHref()).toBe('/dashboard')
  })

  it('offers a signed-out visitor sign-in rather than a dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/games']}>
        <GamesShell><div>PAGE</div></GamesShell>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /save scores/i })).toHaveAttribute('href', '/register')
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
  })
})
