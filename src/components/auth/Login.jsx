import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchSignInMethodsForEmail } from 'firebase/auth'
import { ArrowLeft, EnvelopeIcon as Mail } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { auth } from '../../firebase/config'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import GoogleSignInButton from './GoogleSignInButton'
import SeoHelmet from '../seo/SeoHelmet'

const FRIENDLY = {
  'auth/invalid-credential':     'Wrong email or password. Please try again.',
  'auth/user-not-found':         'No account found with this email.',
  'auth/wrong-password':         'Wrong password. Please try again.',
  'auth/too-many-requests':      'Too many attempts — please wait a few minutes.',
  'auth/invalid-email':          'Please enter a valid email address.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/operation-not-allowed':  'Email and password sign-in is not available right now.',
  'auth/popup-closed-by-user':   'Google sign-in was cancelled.',
  'auth/popup-blocked':          'Your browser blocked the Google sign-in popup. Please allow popups and try again.',
  'auth/account-exists-with-different-credential':
                                 'An account already exists with this email. Sign in with the original method.',
}

// Firebase silently replaces an email/password account's password provider
// with Google's when the email was unverified and the same Google email is
// later used to sign in. After that, the password no longer works. When a
// password sign-in fails, look up which providers actually exist for the
// email so we can tell the user to use Google or reset to set a new password.
const PASSWORD_FAILURE_CODES = new Set([
  'auth/invalid-credential',
  'auth/wrong-password',
  'auth/user-not-found',
])

async function diagnosePasswordFailure(email) {
  const trimmed = email.trim()
  if (!trimmed) return null
  try {
    const methods = await fetchSignInMethodsForEmail(auth, trimmed)
    if (!methods || methods.length === 0) return null
    const hasPassword = methods.includes('password')
    const hasGoogle = methods.includes('google.com')
    if (hasGoogle && !hasPassword) {
      return 'This email signs in with Google. Use "Continue with Google" above, or click "Forgot password?" to set up a password.'
    }
  } catch {
    /* enumeration protection or network error — fall back to default copy */
  }
  return null
}

const INPUT_CLASS =
  'w-full h-[46px] rounded-[10px] border-[1.5px] border-[#2A2A3C] bg-white ' +
  'text-[#1A1F2E] text-sm font-body px-3.5 outline-none transition-colors ' +
  'placeholder:text-[#B0AEBB] focus:border-[var(--accent)] ' +
  'focus:ring-[3px] focus:ring-black/5'

export default function Login() {
  const { login, loginWithGoogle, logout, resetPassword, ensureUserProfile } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [remember, setRemember]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError]         = useState('')

  // Forgot password flow
  const [forgotMode, setForgotMode]       = useState(false)
  const [resetEmail, setResetEmail]       = useState('')
  const [resetLoading, setResetLoading]   = useState(false)
  const [resetSuccess, setResetSuccess]   = useState(false)
  const [resetError, setResetError]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cred = await login(email.trim(), password, { remember })
      const profile = await ensureUserProfile(cred.user)
      if (!profile) {
        try { await logout() } catch { /* ignore secondary failure */ }
        setError('Your account signed in, but we could not finish restoring your ZedExams profile. Please try again or contact support.')
        return
      }
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      let message = FRIENDLY[err.code] ?? 'Login failed. Please try again.'
      if (PASSWORD_FAILURE_CODES.has(err.code)) {
        const hint = await diagnosePasswordFailure(email)
        if (hint) message = hint
      }
      setError(message)
    } finally { setLoading(false) }
  }

  async function handleGoogleSignIn() {
    setError('')
    setGoogleLoading(true)
    try {
      const cred = await loginWithGoogle({ remember })
      const profile = await ensureUserProfile(cred.user)
      if (!profile) {
        try { await logout() } catch { /* ignore secondary failure */ }
        setError('Signed in with Google, but we could not finish setting up your ZedExams profile. Please try again or contact support.')
        return
      }
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      if (err.code === 'auth/cancelled-popup-request') return
      setError(FRIENDLY[err.code] ?? 'Google sign-in failed. Please try again.')
    } finally { setGoogleLoading(false) }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    setResetError('')
    setResetLoading(true)
    try {
      await resetPassword(resetEmail.trim())
      setResetSuccess(true)
    } catch (err) {
      setResetError(
        err.code === 'auth/user-not-found'   ? 'No account found with that email.' :
        err.code === 'auth/invalid-email'    ? 'Please enter a valid email address.' :
        'Failed to send reset email. Please try again.'
      )
    } finally { setResetLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{
        backgroundColor: '#FDF6EC',
        '--accent': '#EA580C',
        '--accent-bg': '#FFEDD5',
        '--accent-fg': '#9A3412',
      }}
    >
      <SeoHelmet
        title="Sign in"
        description="Sign in to your ZedExams account."
        path="/login"
        noIndex
      />
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
      </div>

      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[400px] sm:max-w-[520px] px-8 pt-9 pb-8 animate-scale-in relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-2.5 gap-1">
          <Logo variant="full" size="md" />
          <p className="text-[12px] text-[#999] font-body">Practise smart.</p>
        </div>

        {forgotMode ? (
          /* ── Forgot Password Flow ── */
          <div className="animate-slide-up">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Icon as={ArrowLeft} size="sm" />}
              onClick={() => { setForgotMode(false); setResetSuccess(false); setResetError('') }}
              className="mb-5"
            >
              Back to sign in
            </Button>

            <div className="text-center mb-6">
              <h2 className="text-[20px] font-bold text-[#1A1F2E]">Reset password</h2>
              <p className="text-[13px] text-[#888] mt-1">Enter your email and we'll send you a reset link.</p>
            </div>

            {resetSuccess ? (
              <div className="bg-success-subtle border rounded-2xl p-5 text-center" style={{ borderColor: 'var(--success-fg)' }}>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
                  <Icon as={Mail} size="lg" className="text-success" label="Email sent" />
                </div>
                <p className="text-success text-display-md">Reset email sent!</p>
                <p className="text-success text-body-sm mt-1 opacity-80">Check your inbox and follow the link to reset your password.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setForgotMode(false); setResetSuccess(false) }}
                  className="mt-4"
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label htmlFor="reset-email" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Email address</label>
                  <div className="relative">
                    <input
                      id="reset-email"
                      name="resetEmail"
                      type="email"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      required
                      placeholder="your@email.com"
                      autoComplete="email"
                      inputMode="email"
                      spellCheck={false}
                      autoCapitalize="none"
                      className={`${INPUT_CLASS} pr-11`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aaa] text-[15px] leading-none pointer-events-none" aria-hidden="true">✉</span>
                  </div>
                </div>
                {resetError && (
                  <p aria-live="polite" className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm" style={{ borderColor: 'var(--danger-fg)' }}>
                    {resetError}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={resetLoading}
                >
                  {resetLoading ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            )}
          </div>
        ) : (
          /* ── Login Form ── */
          <>
            <div className="text-center mb-6">
              <h2 className="text-[20px] font-bold text-[#1A1F2E]">Welcome back</h2>
              <p className="text-[13px] text-[#888] mt-1">Sign in to your account</p>
            </div>

            <div className="animate-slide-up">
              <GoogleSignInButton
                onClick={handleGoogleSignIn}
                loading={googleLoading}
                disabled={loading}
              />
              <div className="flex items-center gap-3 my-4" aria-hidden="true">
                <span className="h-px flex-1 bg-[#E4E9F0]" />
                <span className="text-[11px] uppercase tracking-[1px] text-[#aaa] font-medium">or</span>
                <span className="h-px flex-1 bg-[#E4E9F0]" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up">
              <div>
                <label htmlFor="login-email" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">Email address</label>
                <div className="relative">
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="your@email.com"
                    autoComplete="username"
                    inputMode="email"
                    spellCheck={false}
                    autoCapitalize="none"
                    className={`${INPUT_CLASS} pr-11`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aaa] text-[15px] leading-none pointer-events-none" aria-hidden="true">✉</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-[13px] font-medium text-[#1A1F2E]">Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setResetEmail(email) }}
                    className="text-[12.5px] font-medium text-[var(--accent)] hover:opacity-75 bg-transparent shadow-none p-0 min-h-0"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className={`${INPUT_CLASS} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    onMouseDown={e => e.preventDefault()}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-lg text-[15px] leading-none select-none text-[#aaa] hover:text-[#1A1F2E] transition-transform active:scale-90 bg-transparent shadow-none p-0 min-h-0"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    aria-pressed={showPw}
                  >
                    <span aria-hidden="true">{showPw ? '🙈' : '👁'}</span>
                  </button>
                </div>
              </div>

              <label
                htmlFor="login-remember"
                className="flex items-center gap-2 text-[13px] text-[#1A1F2E] select-none cursor-pointer"
              >
                <input
                  id="login-remember"
                  name="remember"
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-[1.5px] border-[#2A2A3C] text-[var(--accent)] accent-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
                />
                Remember me on this device
              </label>

              {error && (
                <p aria-live="polite" className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm" style={{ borderColor: 'var(--danger-fg)' }}>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </>
        )}

        <p className="text-center text-[13px] text-[#888] mt-5">
          No account?{' '}
          <Link to="/register" className="text-[var(--accent)] font-semibold hover:underline">
            Create one free
          </Link>
        </p>
      </div>
    </div>
  )
}
