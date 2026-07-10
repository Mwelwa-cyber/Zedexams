/**
 * Regression tests for Login.jsx — guards against the "logs teachers out
 * every time they log in" bug (root cause: Login.handleSubmit called logout()
 * when ensureUserProfile returned null due to a transient network read error,
 * destroying a valid Firebase session).
 *
 * Key invariant: a null return from ensureUserProfile MUST NOT trigger
 * logout(). Firebase Auth succeeded; AuthContext's onSnapshot listener handles
 * profile population and profileIssue recovery concurrently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Stub Firebase so the component file tree can import without a real project.
// Login.jsx imports useAuth from AuthContext, which we mock below; but
// firebase/config.js (imported transitively) calls initializeApp + getAuth
// at module load time, which throws without valid env vars. The mock below
// short-circuits that entirely.
vi.mock('../../firebase/config', () => ({
  default: {},
  auth: {},
  db: {},
  googleProvider: {},
}))
vi.mock('firebase/auth', () => ({
  fetchSignInMethodsForEmail: vi.fn(),
}))

// Mock AuthContext so we fully control what useAuth() returns.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
  SESSION_EXPIRED_KEY: 'auth:sessionExpired',
  hasAuthSessionHint: vi.fn(() => false),
}))

// Capture navigate calls without a real router history stack.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useAuth, hasAuthSessionHint } from '../../contexts/AuthContext'
import Login from './Login'

// Minimal auth mock helpers
const mockLogout            = vi.fn()
const mockLogin             = vi.fn()
const mockLoginWithGoogle   = vi.fn()
const mockEnsureUserProfile = vi.fn()
const mockResetPassword     = vi.fn()

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    login:             mockLogin,
    loginWithGoogle:   mockLoginWithGoogle,
    logout:            mockLogout,
    resetPassword:     mockResetPassword,
    ensureUserProfile: mockEnsureUserProfile,
    ...overrides,
  })
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLogout.mockResolvedValue(undefined)
  mockResetPassword.mockResolvedValue(undefined)
  hasAuthSessionHint.mockReturnValue(false)
})

// ── Primary bug regression ────────────────────────────────────────────────────

describe('Login — session-preservation on transient profile read failure', () => {
  it('does NOT call logout() when ensureUserProfile returns null (transient network)', async () => {
    // Simulate: auth succeeds, but getDoc fails transiently → ensureUserProfile returns null
    mockLogin.mockResolvedValue({ user: { uid: 'uid-123' } })
    mockEnsureUserProfile.mockResolvedValue(null)
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'teacher@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockEnsureUserProfile).toHaveBeenCalledTimes(1))

    // The session must not be torn down — logout() must never be called
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('navigates to "/" when ensureUserProfile returns null (lets RootRedirect handle recovery)', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'uid-123' } })
    mockEnsureUserProfile.mockResolvedValue(null)
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'teacher@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    // getRoleLandingPath(null, '/') → '/' — the caller-supplied fallback
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('navigates to /teacher when ensureUserProfile succeeds for a teacher', async () => {
    const teacherProfile = { uid: 'uid-456', role: 'teacher' }
    mockLogin.mockResolvedValue({ user: { uid: 'uid-456' } })
    mockEnsureUserProfile.mockResolvedValue(teacherProfile)
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'teacher@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    expect(mockNavigate).toHaveBeenCalledWith('/teacher', { replace: true })
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('navigates to /dashboard for a learner with a valid profile', async () => {
    const learnerProfile = { uid: 'uid-789', role: 'learner' }
    mockLogin.mockResolvedValue({ user: { uid: 'uid-789' } })
    mockEnsureUserProfile.mockResolvedValue(learnerProfile)
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'learner@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    expect(mockLogout).not.toHaveBeenCalled()
  })
})

// ── Auth errors surface correctly (existing behaviour, must not regress) ──────

describe('Login — auth errors are displayed, never swallowed', () => {
  it('shows a friendly message when login() throws auth/invalid-credential', async () => {
    const authErr = Object.assign(new Error('wrong pw'), { code: 'auth/invalid-credential' })
    mockLogin.mockRejectedValue(authErr)
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'bad@email.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(screen.getByText(/wrong email or password/i)).toBeInTheDocument(),
    )
    // ensureUserProfile must never be called if auth itself failed
    expect(mockEnsureUserProfile).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockLogout).not.toHaveBeenCalled()
  })
})

// ── Google sign-in error surfacing (Android native flow) ──────────────────────
// Regression for the "Google sign-in failed" bug: the native flow used to throw
// auth/invalid-credential when no ID token came back, which the FRIENDLY map
// renders as "Wrong email or password" — a misleading message on a Google
// failure. The native flow now uses dedicated codes that map to actionable copy.
describe('Login — Google sign-in surfaces the real failure, not a password error', () => {
  it('shows the Google-specific message (not "wrong password") when no ID token is returned', async () => {
    const err = Object.assign(new Error('no id token'), { code: 'auth/google-no-id-token' })
    mockLoginWithGoogle.mockRejectedValue(err)
    setAuth()

    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    await waitFor(() =>
      expect(screen.getByText(/google sign-in could not be completed/i)).toBeInTheDocument(),
    )
    // The misleading password copy must NOT appear for a Google failure.
    expect(screen.queryByText(/wrong email or password/i)).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('stays silent when the user cancels the Google sheet (auth/cancelled-popup-request)', async () => {
    const err = Object.assign(new Error('cancelled'), { code: 'auth/cancelled-popup-request' })
    mockLoginWithGoogle.mockRejectedValue(err)
    setAuth()

    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    // Let the rejected promise settle, then assert no error banner appeared.
    await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalled())
    expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be completed/i)).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

// ── Session restoration ("logged out on refresh" regression) ─────────────────
// A page refresh used to strand an authenticated user on the login form: a
// route guard bounced them to /login while Firebase was still restoring the
// session, and Login never redirected them once restoration completed.
describe('Login — refresh/session-restoration behaviour', () => {
  it('shows the restoring-session loader (not the form) while auth resolves on a device with a session hint', () => {
    hasAuthSessionHint.mockReturnValue(true)
    setAuth({ loading: true, currentUser: null })

    renderLogin()

    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
  })

  it('shows the form immediately for a genuinely signed-out visitor (no hint), even while auth resolves', () => {
    hasAuthSessionHint.mockReturnValue(false)
    setAuth({ loading: true, currentUser: null })

    renderLogin()

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
  })

  it('redirects an already-authenticated user off the login page to their role landing', async () => {
    setAuth({
      loading: false,
      currentUser: { uid: 'uid-1' },
      userProfile: { id: 'uid-1', role: 'teacher' },
    })

    renderLogin()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/teacher', { replace: true }))
  })

  it('returns the user to the protected page they were bounced from (location.state.from)', async () => {
    setAuth({
      loading: false,
      currentUser: { uid: 'uid-1' },
      userProfile: { id: 'uid-1', role: 'teacher' },
    })

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/teacher/quiz-studio', search: '' } } }]}
      >
        <Login />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/teacher/quiz-studio', { replace: true }))
  })

  it('signing in from a bounced guard returns to the requested page, not the dashboard', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'uid-9' } })
    mockEnsureUserProfile.mockResolvedValue({ id: 'uid-9', role: 'learner' })
    setAuth()

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/quiz/123', search: '' } } }]}
      >
        <Login />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'l@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/quiz/123', { replace: true }))
  })
})
