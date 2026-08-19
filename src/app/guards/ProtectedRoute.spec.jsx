/**
 * Regression tests for ProtectedRoute — the "refreshing logs me out" bug.
 *
 * Invariants locked down here:
 *   1. While AuthContext is still restoring the session (loading === true),
 *      the guard shows the branded loader and NEVER redirects to /login,
 *      even though currentUser is still null on those first frames.
 *   1b. And — the sharper version of the same rule — it never redirects while
 *      `authReady` is false, whatever `loading` says. The restoration watchdog
 *      drops `loading` on a timer without knowing who the user is, so
 *      `loading === false && currentUser === null` is NOT evidence of a
 *      signed-out visitor. Deciding on that pair is what left a learner with a
 *      valid refresh token stranded on /login after a cold load.
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
vi.mock('./MissingProfileRecovery', () => ({
  default: () => <div data-testid="profile-recovery" />,
}))

// The grace-window banner has its own spec; a marker keeps this one focused.
vi.mock('../../components/ui/VerifyEmailBanner', () => ({
  default: () => <div data-testid="verify-banner" />,
}))

import { useAuth } from '../../contexts/AuthContext'
import ProtectedRoute from './ProtectedRoute'

function LoginProbe() {
  const location = useLocation()
  return <div data-testid="login-page">{JSON.stringify(location.state)}</div>
}

function VerifyEmailProbe() {
  const location = useLocation()
  return <div data-testid="verify-email-page">{JSON.stringify(location.state)}</div>
}

function renderGuard(ui, { path = '/teacher/quiz-studio' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/verify-email" element={<VerifyEmailProbe />} />
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
    useAuth.mockReturnValue({ currentUser: null, userProfile: null, loading: true, authReady: false, profileIssue: null })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
  })

  // ── The cold-load wedge ────────────────────────────────────────────────
  // This is the incident. The restoration watchdog drops `loading` after its
  // window WITHOUT knowing who the user is, so a returning learner holding a
  // valid refresh token was seen as `loading === false && currentUser === null`
  // — indistinguishable from signed out — and bounced to /login, where they
  // stayed. `authReady` is the only signal that separates "Firebase said no
  // user" from "Firebase has not said anything yet".
  it('never redirects to /login before Firebase has emitted, even once loading has been dropped', () => {
    useAuth.mockReturnValue({
      currentUser: null,
      userProfile: null,
      loading: false,      // the watchdog gave up…
      authReady: false,    // …but Firebase never actually spoke
      profileIssue: null,
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
  })

  it('holds the loader while auth is unresolved even with a role required', () => {
    useAuth.mockReturnValue({
      currentUser: null,
      userProfile: null,
      loading: false,
      authReady: false,
      profileIssue: null,
    })

    renderGuard(
      <ProtectedRoute requiredRole="teacher"><div data-testid="page" /></ProtectedRoute>,
    )

    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
  })

  it('redirects a genuinely signed-out user to /login with the requested route in state.from', () => {
    useAuth.mockReturnValue({ currentUser: null, userProfile: null, loading: false, authReady: true, profileIssue: null })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    const login = screen.getByTestId('login-page')
    expect(JSON.parse(login.textContent).from.pathname).toBe('/teacher/quiz-studio')
  })

  it('renders the profile-recovery screen in place on a transient profile failure — URL preserved, no redirect', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1' },
      userProfile: null,
      loading: false,
      authReady: true,
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
      authReady: true,
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
      authReady: true,
      profileIssue: null,
    })

    renderGuard(
      <ProtectedRoute requiredRole="teacher"><div data-testid="page" /></ProtectedRoute>,
    )

    expect(screen.getByText(/preparing your dashboard/i)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })

  it('redirects an unverified email/password user to /verify-email with state.from', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1', emailVerified: false },
      userProfile: { id: 'u1', role: 'learner' },
      loading: false,
      authReady: true,
      profileIssue: null,
      needsEmailVerification: true,
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    const verify = screen.getByTestId('verify-email-page')
    expect(JSON.parse(verify.textContent).from.pathname).toBe('/teacher/quiz-studio')
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
  })

  it('holds on the loader (not a redirect) while an unverified user’s profile is still loading — grace unknown', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1', emailVerified: false },
      userProfile: null,
      loading: false,
      authReady: true,
      profileIssue: null,
      needsEmailVerification: true,
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByTestId('verify-email-page')).not.toBeInTheDocument()
  })

  it('lets a grace-window user through WITH the persistent verify banner', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1', emailVerified: false },
      userProfile: {
        id: 'u1',
        role: 'learner',
        verificationGraceUntil: { toMillis: () => Date.now() + 86_400_000 },
      },
      loading: false,
      authReady: true,
      profileIssue: null,
      needsEmailVerification: true,
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByTestId('page')).toBeInTheDocument()
    expect(screen.getByTestId('verify-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('verify-email-page')).not.toBeInTheDocument()
  })

  it('blocks a user whose grace window has expired', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1', emailVerified: false },
      userProfile: {
        id: 'u1',
        role: 'learner',
        verificationGraceUntil: { toMillis: () => Date.now() - 1000 },
      },
      loading: false,
      authReady: true,
      profileIssue: null,
      needsEmailVerification: true,
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByTestId('verify-email-page')).toBeInTheDocument()
  })

  it('verified users never see the verify gate or banner', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1', emailVerified: true },
      userProfile: { id: 'u1', role: 'learner' },
      loading: false,
      authReady: true,
      profileIssue: null,
      needsEmailVerification: false,
    })

    renderGuard(<ProtectedRoute><div data-testid="page" /></ProtectedRoute>)

    expect(screen.getByTestId('page')).toBeInTheDocument()
    expect(screen.queryByTestId('verify-banner')).not.toBeInTheDocument()
  })

  it('bounces an under-privileged role to its own landing page, not /login', () => {
    useAuth.mockReturnValue({
      currentUser: { uid: 'u1' },
      userProfile: { id: 'u1', role: 'learner' },
      loading: false,
      authReady: true,
      profileIssue: null,
    })

    renderGuard(
      <ProtectedRoute requiredRole="admin"><div data-testid="page" /></ProtectedRoute>,
    )

    expect(screen.getByTestId('learner-landing')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })
})
