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
vi.mock('../../../firebase/config', () => ({
  default: {},
  auth: {},
  db: {},
  googleProvider: {},
}))
vi.mock('firebase/auth', () => ({
  fetchSignInMethodsForEmail: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
}))

// The MFA service loads firebase/functions at module init (getFunctions), which
// needs a real app — stub it so Login's transitive import doesn't blow up.
vi.mock('../../../services/adminMfa', () => ({
  getResolver: vi.fn(),
  findTotpHint: vi.fn(),
  completeTotpSignIn: vi.fn(),
  recordMfaEnrollmentEvent: vi.fn(),
}))

// Mock AuthContext so we fully control what useAuth() returns.
vi.mock('../../../contexts/AuthContext', () => ({
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

import { useAuth, hasAuthSessionHint } from '../../../contexts/AuthContext'
import { getResolver, findTotpHint } from '../../../services/adminMfa'
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

// ── MFA challenge ─────────────────────────────────────────────────────────────

describe('Login — MFA-enrolled admin', () => {
  it('shows the two-step verification challenge when the first factor needs a second factor', async () => {
    const err = new Error('mfa required'); err.code = 'auth/multi-factor-auth-required'
    mockLogin.mockRejectedValue(err)
    getResolver.mockReturnValue({ hints: [{ factorId: 'totp', uid: 'h1' }], session: {} })
    findTotpHint.mockReturnValue({ factorId: 'totp', uid: 'h1' })
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@zedexams.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByText(/two-step verification/i)).toBeInTheDocument())
    // The credential-preserving invariant still holds: no logout on the MFA hop.
    expect(mockLogout).not.toHaveBeenCalled()
  })
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

  it('sends an unverified email/password sign-in to /verify-email (not the dashboard)', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'uid-123', emailVerified: false } })
    mockEnsureUserProfile.mockResolvedValue({ id: 'uid-123', role: 'learner' })
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'new@user.zm' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/verify-email', expect.objectContaining({ replace: true }))
    })
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('lets an unverified user INSIDE a grace window continue to the dashboard', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'uid-123', emailVerified: false } })
    mockEnsureUserProfile.mockResolvedValue({
      id: 'uid-123',
      role: 'learner',
      verificationGraceUntil: { toMillis: () => Date.now() + 86_400_000 },
    })
    setAuth()

    renderLogin()

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'legacy@user.zm' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalledWith('/verify-email', expect.anything())
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
    setAuth({ authReady: false, currentUser: null })

    renderLogin()

    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
  })

  it('shows the form immediately for a genuinely signed-out visitor (no hint), even while auth resolves', () => {
    hasAuthSessionHint.mockReturnValue(false)
    setAuth({ authReady: false, currentUser: null })

    renderLogin()

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
  })

  it('redirects once auth is ready even though the watchdog already dropped loading', async () => {
    // The incident, from Login's side. The old effect gated on `loading`, which
    // the restoration watchdog drops on a timer without knowing who the user
    // is — so an authenticated learner bounced here by a guard sat on the
    // sign-in form with a perfectly good session. `authReady` is the gate now.
    setAuth({
      loading: false,
      authReady: true,
      currentUser: { uid: 'uid-1' },
      userProfile: { id: 'uid-1', role: 'learner' },
    })

    renderLogin()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }))
    // …and the form must never have flashed underneath it.
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
  })

  it('never shows the sign-in form to a user who is already authenticated', () => {
    setAuth({
      authReady: true,
      currentUser: { uid: 'uid-1' },
      userProfile: null,
    })

    renderLogin()

    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
  })

  it('holds rather than deciding while auth is unresolved on a hinted device', () => {
    hasAuthSessionHint.mockReturnValue(true)
    setAuth({ loading: false, authReady: false, currentUser: null })

    renderLogin()

    // `loading` is already false here — the watchdog gave up — and that must
    // not be enough to show the form to someone who never signed out.
    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('redirects an already-authenticated user off the login page to their role landing', async () => {
    setAuth({
      authReady: true,
      currentUser: { uid: 'uid-1' },
      userProfile: { id: 'uid-1', role: 'teacher' },
    })

    renderLogin()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/teacher', { replace: true }))
  })

  it('returns the user to the protected page they were bounced from (location.state.from)', async () => {
    setAuth({
      authReady: true,
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

  it('does not return a teacher to a learner-only page they were bounced from', async () => {
    // The stash records what the BROWSER asked for. A teacher who opened a
    // /notes/:id link (bookmark, shared link, restored tab) was bounced to
    // /login, signed in, and was sent straight back — landing on the learner
    // route's "Teacher accounts stay in the teacher portal" card. The
    // destination is now checked against the role first.
    setAuth({
      authReady: true,
      currentUser: { uid: 'uid-1' },
      userProfile: { id: 'uid-1', role: 'teacher' },
    })

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/notes/FEBUorwhAV471eyS9WdB', search: '' } } }]}
      >
        <Login />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/teacher', { replace: true }))
    expect(mockNavigate).not.toHaveBeenCalledWith('/notes/FEBUorwhAV471eyS9WdB', { replace: true })
  })

  it('does not return a parent to a learner-only page they were bounced from', async () => {
    // Same shape from the family side, and the one that was reported: a
    // guardian opened a learner /notes/:id link, signed in, and landed on the
    // refusal card every time — which read "Teacher accounts stay in the
    // teacher portal" at an account that is not a teacher's.
    setAuth({
      authReady: true,
      currentUser: { uid: 'uid-p' },
      userProfile: { id: 'uid-p', role: 'parent' },
    })

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/notes/y5YBurkQOKGkVp3ju7IN', search: '?mode=revise' } } }]}
      >
        <Login />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/family', { replace: true }))
    expect(mockNavigate).not.toHaveBeenCalledWith('/notes/y5YBurkQOKGkVp3ju7IN?mode=revise', { replace: true })
  })

  it('does not send a teacher to a learner page after signing in with the form either', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'uid-t' } })
    mockEnsureUserProfile.mockResolvedValue({ id: 'uid-t', role: 'teacher' })
    setAuth()

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/notes/abc', search: '' } } }]}
      >
        <Login />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 't@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/teacher', { replace: true }))
    expect(mockNavigate).not.toHaveBeenCalledWith('/notes/abc', { replace: true })
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

// ── Redesign copy + structure ─────────────────────────────────────────────────
describe('Login — redesigned page content', () => {
  it('renders the create-account prompt with the required wording', () => {
    setAuth()
    renderLogin()

    expect(screen.getByText(/new to zedexams\?/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Create a free account' })
    expect(link).toHaveAttribute('href', '/register')
  })

  it('renders the security reassurance strip with accurate wording', () => {
    setAuth()
    renderLogin()

    expect(screen.getByText('Secure')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Trusted')).toBeInTheDocument()
    expect(screen.getByText('Your details stay private')).toBeInTheDocument()
  })

  it('never duplicates the tagline — it is baked into the logo asset', () => {
    setAuth()
    renderLogin()

    // The logo image itself carries "Practise smart." — rendering it again as
    // text would show the tagline twice on the page.
    expect(screen.queryByText('Practise smart.')).not.toBeInTheDocument()
    expect(screen.getByAltText('ZedExams')).toBeInTheDocument()
  })

  it('exposes a password visibility toggle with accessible labels (no emoji)', () => {
    setAuth()
    renderLogin()

    const toggle = screen.getByRole('button', { name: 'Show password' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'text')
  })

  it('moves focus to the error alert when a sign-in error lands', async () => {
    const authErr = Object.assign(new Error('bad'), { code: 'auth/invalid-credential' })
    mockLogin.mockRejectedValue(authErr)
    setAuth()

    renderLogin()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'a@b.zm' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    // Wait for the FOCUS, not for the alert. Focus is moved by an effect that
    // runs after the alert mounts (Login.jsx's `if (error) errorRef.current
    // ?.focus()`), so waiting only for the element to exist leaves a window
    // where it is present and not yet focused — which is the window a busy CI
    // runner lands in.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })
})

// ── Verification resilience (App Check / reCAPTCHA remediation) ───────────────
// Guards the launch-blocker fixes: an in-flight sign-in must not be double-
// submitted, and a recoverable verification failure must let the user retry
// WITHOUT losing what they typed — and never leave a floating rejection.
describe('Login — verification resilience (duplicate submit + retry)', () => {
  it('does not double-submit while a sign-in is in flight', async () => {
    // login() stays pending so the button is disabled for the second click.
    let resolveLogin
    mockLogin.mockImplementation(() => new Promise((res) => { resolveLogin = res }))
    mockEnsureUserProfile.mockResolvedValue({ id: 'u', role: 'learner' })
    setAuth()

    renderLogin()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'teacher@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pass123' } })

    const btn = screen.getByRole('button', { name: /sign in/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    // Second click on the now-disabled button must be a no-op.
    fireEvent.click(btn)
    expect(mockLogin).toHaveBeenCalledTimes(1)

    // Settle so no unhandled-rejection warning leaks out of the test.
    resolveLogin({ user: { uid: 'u', emailVerified: true } })
    await waitFor(() => expect(mockEnsureUserProfile).toHaveBeenCalled())
  })

  it('preserves credentials and allows a retry after a recoverable failure', async () => {
    const recoverable = Object.assign(new Error('network'), { code: 'auth/network-request-failed' })
    mockLogin
      .mockRejectedValueOnce(recoverable)
      .mockResolvedValueOnce({ user: { uid: 'u', emailVerified: true } })
    mockEnsureUserProfile.mockResolvedValue({ id: 'u', role: 'learner' })
    setAuth()

    renderLogin()
    const email = screen.getByLabelText(/email address/i)
    const password = screen.getByLabelText(/^password$/i)
    fireEvent.change(email, { target: { value: 'teacher@school.com' } })
    fireEvent.change(password, { target: { value: 'pass123' } })

    const btn = screen.getByRole('button', { name: /sign in/i })
    fireEvent.click(btn)

    // After the recoverable failure the button re-enables for a retry…
    await waitFor(() => expect(btn).not.toBeDisabled())
    // …and the entered credentials are still there (never wiped on error).
    expect(email.value).toBe('teacher@school.com')
    expect(password.value).toBe('pass123')
    expect(mockNavigate).not.toHaveBeenCalled()

    // Retrying without re-typing succeeds.
    fireEvent.click(btn)
    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
  })
})
