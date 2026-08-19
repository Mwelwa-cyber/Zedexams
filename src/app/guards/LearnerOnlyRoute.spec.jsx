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
    // Default to "Firebase has spoken" — the cases that need the opposite say
    // so explicitly, and there is a test below for each.
    authReady: true,
    isAdmin: false,
    isLearner: false,
    isTeacher: false,
    isParent: false,
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

  it('shows no verdict at all before Firebase has emitted', () => {
    // Every role flag this guard reads is derived from a profile that cannot
    // exist yet, so all of them are false while auth is unresolved — which
    // reads identically to "a teacher". Without an `authReady` gate a learner
    // cold-loading their own dashboard would be told teacher accounts stay in
    // the teacher portal.
    setAuth({ loading: false, authReady: false, userProfile: null })
    renderGuard()
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
    expect(screen.queryByText(/teacher accounts stay/i)).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
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

  // ── The blocked account is told the truth about ITSELF ─────────────
  // The card was written for a teacher and shown to everyone the guard turns
  // away, so a parent opening a learner link was told their account was a
  // teacher's — and handed a button to a portal it cannot open.
  it('tells a blocked parent about the family portal, not the teacher portal', () => {
    setAuth({ userProfile: { role: 'parent' }, isParent: true })
    renderGuard()

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
    expect(screen.queryByText(/teacher accounts stay in the teacher portal/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to family portal/i })).toBeInTheDocument()
  })

  it('sends a blocked parent to the family portal — the place the button names', () => {
    setAuth({ userProfile: { role: 'parent' }, isParent: true })
    renderGuard()

    screen.getByRole('button', { name: /back to family portal/i }).click()

    // Previously this navigated to /teacher, where ProtectedRoute read the
    // real role and moved them to /family: the destination was right by
    // accident and the label was wrong on purpose.
    expect(mockNavigate).toHaveBeenCalledWith('/family')
    expect(mockNavigate).toHaveBeenCalledTimes(1)
  })

  it('gives a role it does not recognise a way out that is not a learner route', () => {
    setAuth({ userProfile: { role: 'nonsense' } })
    renderGuard()

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
    screen.getByRole('button', { name: /back to home/i }).click()
    // Not /dashboard — that is a learner route, and the button would land
    // straight back on this card.
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})
