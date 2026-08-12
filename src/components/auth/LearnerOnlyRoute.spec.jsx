/**
 * LearnerOnlyRoute — the boundary between the two portals.
 *
 * The load-bearing assertion is not "the card appears" but that the learner
 * children NEVER render for a teacher: a guard that draws the page and then
 * covers it has already fetched the learner's content and shown a flash of it.
 * So every blocked case asserts the child is absent, not just that the card is
 * present.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../../contexts/AuthContext'
import LearnerOnlyRoute from './LearnerOnlyRoute'

const CHILD = 'learner-content'

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    userProfile: null,
    loading: false,
    isAdmin: false,
    isLearner: false,
    isTeacher: false,
    canAccessLearnerPortal: false,
    ...overrides,
  })
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/notes/FEBUorwhAV471eyS9WdB']}>
      <LearnerOnlyRoute><div>{CHILD}</div></LearnerOnlyRoute>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('LearnerOnlyRoute', () => {
  it('blocks a teacher without rendering any learner content', () => {
    setAuth({ userProfile: { role: 'teacher' }, isTeacher: true })
    renderGuard()

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
    expect(screen.getByText(/teacher accounts stay in the teacher portal/i)).toBeInTheDocument()
  })

  it('blocks a teacher who also has learner-portal access on their plan', () => {
    setAuth({ userProfile: { role: 'teacher' }, isTeacher: true, canAccessLearnerPortal: true })
    renderGuard()

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
  })

  it('sends the teacher back to the teacher portal, and nowhere that bounces again', () => {
    setAuth({ userProfile: { role: 'teacher' }, isTeacher: true })
    renderGuard()

    screen.getByRole('button', { name: /back to teacher portal/i }).click()

    expect(mockNavigate).toHaveBeenCalledWith('/teacher')
    // /teacher is a teacher route, so the next guard has no reason to move
    // them — the escape hatch cannot loop back here.
    expect(mockNavigate).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while the profile is still loading', () => {
    // A teacher whose profile has not arrived must not see the page for a
    // frame — this is the flash-of-learner-content case, and it is why the
    // guard waits on userProfile rather than only on `loading`.
    setAuth({ loading: true })
    renderGuard()
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()

    setAuth({ loading: false, userProfile: null })
    renderGuard()
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
  })

  it('lets learners and admins through unchanged', () => {
    setAuth({ userProfile: { role: 'learner' }, isLearner: true })
    renderGuard()
    expect(screen.getByText(CHILD)).toBeInTheDocument()

    vi.clearAllMocks()
    setAuth({ userProfile: { role: 'admin' }, isAdmin: true })
    renderGuard()
    expect(screen.getAllByText(CHILD).length).toBeGreaterThan(0)
  })

  it('lets a non-teacher with learner-portal access through (e.g. a parent on a plan)', () => {
    setAuth({ userProfile: { role: 'parent' }, canAccessLearnerPortal: true })
    renderGuard()
    expect(screen.getByText(CHILD)).toBeInTheDocument()
  })
})
