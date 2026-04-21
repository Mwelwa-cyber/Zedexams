import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, EnvelopeIcon as Mail } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

const FRIENDLY = {
  'auth/invalid-credential':     'Wrong email or password. Please try again.',
  'auth/user-not-found':         'No account found with this email.',
  'auth/wrong-password':         'Wrong password. Please try again.',
  'auth/too-many-requests':      'Too many attempts — please wait a few minutes.',
  'auth/invalid-email':          'Please enter a valid email address.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/operation-not-allowed':  'Email and password sign-in is not available right now.',
}

export default function Login() {
  const { login, logout, resetPassword, ensureUserProfile } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Forgot password flow
  const [forgotMode, setForgotMode]       = useState(false)
  const [resetEmail, setResetEmail]       = useState('')
  const [resetLoading, setResetLoading]   = useState(false)
  const [resetSuccess, setResetSuccess]   = useState(false)
  const [resetError, setResetError]       = useState('')

  useEffect(() => {
    document.title = 'Sign In — ZedExams'
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cred = await login(email.trim(), password)
      const profile = await ensureUserProfile(cred.user)
      if (!profile) {
        try { await logout() } catch { /* ignore secondary failure */ }
        setError('Your account signed in, but we could not finish restoring your ZedExams profile. Please try again or contact support.')
        return
      }
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      setError(FRIENDLY[err.code] ?? 'Login failed. Please try again.')
    } finally { setLoading(false) }
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
    <div className="min-h-screen theme-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
      </div>

      <div className="theme-card rounded-3xl shadow-xl border theme-border w-full max-w-sm p-8 sm:p-10 animate-scale-in relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <div className="mb-1">
            <Logo variant="full" size="xl" />
          </div>
          <p className="theme-text-muted text-sm font-bold tracking-wide mt-1">
            Grade 4–6 Exam Preparation
          </p>
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
              Back to login
            </Button>

            <h2 className="text-display-md theme-text mb-1">Reset Password</h2>
            <p className="theme-text-muted text-body-sm mb-5">
              Enter your email and we'll send you a reset link.
            </p>

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
                  Back to login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label htmlFor="reset-email" className="block text-sm font-bold theme-text mb-1">Email Address</label>
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
                    className="w-full border-2 rounded-xl px-4 py-3 text-base focus:outline-none transition-colors theme-input focus:border-green-500"
                  />
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
                  {resetLoading ? 'Sending…' : 'Send Reset Link'}
                </Button>
              </form>
            )}
          </div>
        ) : (
          /* ── Login Form ── */
          <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up">
            <div>
              <label htmlFor="login-email" className="block text-sm font-bold theme-text mb-1">Email</label>
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
                className="w-full border-2 rounded-xl px-4 py-3 text-base focus:outline-none transition-colors theme-input focus:border-green-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="login-password" className="block text-sm font-bold theme-text">Password</label>
                <button
                  type="button"
                  onClick={() => { setForgotMode(true); setResetEmail(email) }}
                  className="text-xs font-bold text-green-600 hover:text-green-700 hover:underline min-h-0 p-0 bg-transparent shadow-none"
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
                  className="w-full border-2 rounded-xl px-4 py-3 pr-11 text-base focus:outline-none transition-colors theme-input focus:border-green-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 theme-text-muted hover:theme-text transition-colors min-h-0 p-0 bg-transparent shadow-none"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  <Icon as={showPw ? EyeOff : Eye} size="md" />
                </button>
              </div>
            </div>

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
        )}

        <p className="text-center text-sm theme-text-muted mt-6">
          No account?{' '}
          <Link to="/register" className="text-green-600 font-black hover:underline">
            Register free
          </Link>
        </p>
      </div>
    </div>
  )
}
