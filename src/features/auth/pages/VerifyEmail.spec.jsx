/**
 * Tests for the /verify-email gate page.
 *
 * Invariants:
 *   1. Renders ONLY for a signed-in, unverified user — verified users are
 *      redirected to state.from / their role landing, signed-out to /login,
 *      and the transient emailVerified===null state shows the loader (never
 *      a redirect, so refreshes don't bounce).
 *   2. "I have verified my email" runs the context's refreshEmailVerification
 *      (reload + token refresh + mirror write) and shows the not-verified-yet
 *      copy on failure.
 *   3. Resend has a 60s cooldown and maps auth/too-many-requests to friendly
 *      copy.
 *   4. "Use a different email" and "Sign out" both end the session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../../../contexts/AuthContext'
import VerifyEmail from './VerifyEmail'

const mockRefresh = vi.fn()
const mockResend = vi.fn()
const mockLogout = vi.fn()

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    currentUser: { uid: 'u1', email: 'amina@example.zm', emailVerified: false },
    userProfile: { id: 'u1', role: 'learner' },
    loading: false,
    emailVerified: false,
    refreshEmailVerification: mockRefresh,
    resendVerificationEmail: mockResend,
    logout: mockLogout,
    ...overrides,
  })
}

function LandingProbe() {
  return <div data-testid="landing" />
}

function FromProbe() {
  const location = useLocation()
  return <div data-testid="from-page">{location.pathname}</div>
}

function renderPage({ state } = {}) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/verify-email', state }]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/register" element={<div data-testid="register-page" />} />
        <Route path="/dashboard" element={<LandingProbe />} />
        <Route path="/teacher/quiz-studio" element={<FromProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // The page auto-polls on mount; default it to "still unverified".
  mockRefresh.mockResolvedValue(false)
  mockResend.mockResolvedValue(undefined)
  mockLogout.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VerifyEmail — guard block', () => {
  it('renders the gate for a signed-in unverified user, showing their email', () => {
    setAuth()
    renderPage()
    expect(screen.getByRole('heading', { name: /verify your email/i })).toBeInTheDocument()
    expect(screen.getByText(/amina@example\.zm/)).toBeInTheDocument()
  })

  it('redirects a signed-out visitor to /login', () => {
    setAuth({ currentUser: null, emailVerified: null })
    renderPage()
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  it('redirects a verified user to their role landing when there is no state.from', () => {
    setAuth({ currentUser: { uid: 'u1', emailVerified: true }, emailVerified: true })
    renderPage()
    expect(screen.getByTestId('landing')).toBeInTheDocument()
  })

  it('redirects a verified user back to state.from (deep-link survives verification)', () => {
    setAuth({ currentUser: { uid: 'u1', emailVerified: true }, emailVerified: true })
    renderPage({ state: { from: { pathname: '/teacher/quiz-studio' } } })
    expect(screen.getByTestId('from-page')).toHaveTextContent('/teacher/quiz-studio')
  })

  it('shows the loader (no redirect) while verification state is unknown', () => {
    setAuth({ emailVerified: null })
    renderPage()
    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })
})

describe('VerifyEmail — actions', () => {
  it('"I have verified" → refresh returns false → shows the not-verified-yet copy', async () => {
    setAuth()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /i have verified my email/i }))
    await waitFor(() => {
      expect(screen.getByText(/has not been verified yet/i)).toBeInTheDocument()
    })
  })

  it('resend sends the email and starts the 60s cooldown', async () => {
    setAuth()
    renderPage()
    const resend = screen.getByRole('button', { name: /resend verification email/i })
    fireEvent.click(resend)
    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resend verification email \(\d+s\)/i })).toBeDisabled()
    })
    expect(screen.getByText(/sent!/i)).toBeInTheDocument()
  })

  it('maps auth/too-many-requests to friendly copy', async () => {
    setAuth()
    mockResend.mockRejectedValue({ code: 'auth/too-many-requests' })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }))
    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeInTheDocument()
    })
  })

  it('"Use a different email" signs out and goes to /register', async () => {
    setAuth()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /use a different email/i }))
    await waitFor(() => expect(mockLogout).toHaveBeenCalled())
    expect(screen.getByTestId('register-page')).toBeInTheDocument()
  })

  it('"Sign out" signs out and goes to /login', async () => {
    setAuth()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    await waitFor(() => expect(mockLogout).toHaveBeenCalled())
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  it('auto-polls verification on mount (zero-click cross-tab flow)', async () => {
    setAuth()
    renderPage()
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })
})
