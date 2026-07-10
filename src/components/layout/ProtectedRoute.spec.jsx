/**
 * Regression tests for ProtectedRoute — the "refreshing logs me out" bug.
 *
 * Invariants locked down here:
 *   1. While AuthContext is still restoring the session (loading === true),
 *      the guard shows the branded loader and NEVER redirects to /login,
 *      even though currentUser is still null on those first frames.
 *   2. A genuinely signed-out visit redirects to /login carrying the
 *      requested URL in location.state.from so Login can send them back.
 *   3. A transient profile failure (profileIssue) renders the recovery
 *      screen IN PLACE — the URL is preserved and the session untouched.
 *   4. Role gating still bounces an under-privileged user to their landing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

// MissingProfileRecovery pulls more of AuthContext than the guard needs —
// stub it to a marker so these tests stay focused on the guard's branching.
vi.mock('../auth/MissingProfileRecovery', () => ({
  default: () => <div data-testid="profile-recovery" />,
}))

import { useAuth } from '../../contexts/AuthContext'
import ProtectedRoute from './ProtectedRoute'

function LoginProbe() {
  const location = useLocation()
  return <div data-testid="login-page">{JSON.stringify(location.state)}</div>
}

function renderGuard(ui, { path = '/teacher/quiz-studio' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/dashboard" element={<div data-testid="learner-landing" />} />
        <Route path={path} element={ui} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProtectedRoute', () => {
  it('holds on the loader while the session is restoring — no /login redirect', () => {
    useAuth.mockReturnValue({ currentUser: null, userProfile: null, loading: true, profileIssue: null })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
  })

  it('redirects a genuinely signed-out user to /login with the requested route in state.from', () => {
    useAuth.mockReturnValue({ currentUser: null, userProfile: null, loading: false, profileIssue: null })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    const login = screen.getByTestId('login-page')
    expect(JSON.parse(login.textContent).from.pathname).toBe('/teacher/quiz-studio')
  })

  it('renders the profile-recovery screen in place on a transient profile failure — URL preserved, no redirect', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1' },
      userProfile: null,
      loading: false,
      profileIssue: 'unreadable',
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByTestId('profile-recovery')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })

  it('renders the page for an authenticated user with a sufficient role', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1' },
      userProfile: { id: 'u1', role: 'teacher' },
      loading: false,
      profileIssue: null,
    })

    renderGuard(
      <ProtectedRoute requiredRole="teacher"><div data-testid="page" /></ProtectedRoute>,
    )

    expect(screen.getByTestId('page')).toBeInTheDocument()
  })

  it('waits on the workspace loader when a role is required but the profile has not loaded yet', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1' },
      userProfile: null,
      loading: false,
      profileIssue: null,
    })

    renderGuard(
      <ProtectedRoute requiredRole="teacher"><div data-testid="page" /></ProtectedRoute>,
    )

    expect(screen.getByText(/loading your workspace/i)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })

  it('bounces an under-privileged role to its own landing page, not /login', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1' },
      userProfile: { id: 'u1', role: 'learner' },
      loading: false,
      profileIssue: null,
    })

    renderGuard(
      <ProtectedRoute requiredRole="admin"><div data-testid="page" /></ProtectedRoute>,
    )

    expect(screen.getByTestId('learner-landing')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })
})
