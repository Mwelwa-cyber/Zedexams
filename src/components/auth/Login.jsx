import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'

const FRIENDLY = {
  'auth/invalid-credential':     'Wrong email or password. Please try again.',
  'auth/user-not-found':         'No account found with this email.',
  'auth/wrong-password':         'Wrong password. Please try again.',
  'auth/too-many-requests':      'Too many attempts — please wait a few minutes.',
  'auth/invalid-email':          'Please enter a valid email address.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
}

export default function Login() {
  const { login, resetPassword, userProfile, fetchUserProfile } = useAuth()
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cred = await login(email.trim(), password)
      const profile = userProfile ?? await fetchUserProfile(cred.user.uid)
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
            Grade 4–7 Exam Preparation
          </p>
        </div>

        {forgotMode ? (
          /* ── Forgot Password Flow ── */
          <div className="animate-slide-up">
            <button
              onClick={() => { setForgotMode(false); setResetSuccess(false); setResetError('') }}
              className="flex items-center gap-1.5 theme-text-muted text-sm font-bold mb-5 hover:theme-text transition-colors min-h-0 p-0 bg-transparent shadow-none"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
              Back to login
            </button>

            <h2 className="theme-text font-black text-xl mb-1">Reset Password</h2>
            <p className="theme-text-muted text-sm mb-5">
              Enter your email and we'll send you a reset link.
            </p>

            {resetSuccess ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                <div className="text-3xl mb-2">📬</div>
                <p className="text-green-800 font-black text-sm">Reset email sent!</p>
                <p className="text-green-600 text-xs mt-1">Check your inbox and follow the link to reset your password.</p>
                <button
                  onClick={() => { setForgotMode(false); setResetSuccess(false) }}
                  className="mt-4 text-green-700 font-black text-sm underline min-h-0 p-0 bg-transparent shadow-none"
                >
                  Back to login
                </button>
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
                  <p aria-live="polite" className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {resetError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-base py-3.5 rounded-2xl shadow-md transition-colors"
                >
                  {resetLoading ? 'Sending…' : 'Send Reset Link'}
                </button>
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
                  {showPw ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p aria-live="polite" className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-lg py-3.5 rounded-2xl shadow-md transition-colors"
            >
              {loading ? '⏳ Signing in…' : 'Sign In'}
            </button>
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
