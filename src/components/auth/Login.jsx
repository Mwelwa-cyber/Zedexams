import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchSignInMethodsForEmail } from 'firebase/auth'
import { ArrowLeft, EnvelopeIcon as Mail } from '../ui/icons'
import { useAuth, SESSION_EXPIRED_KEY } from '../../contexts/AuthContext'
import { auth } from '../../firebase/config'
import { getRoleLandingPath } from '../../utils/navigation'
import { friendlyAuthMessage } from '../../utils/friendlyErrors'
import { assessAction, shouldBlock } from '../../utils/recaptcha'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import GoogleSignInButton from './GoogleSignInButton'
import SeoHelmet from '../seo/SeoHelmet'

// Auth-error copy now lives centrally in src/utils/friendlyErrors.js
// (friendlyAuthMessage) so Login + Register share one source of truth — see
// that module for the full per-code map, including the native Google
// sign-in failure modes surfaced from AuthContext.signInWithGoogleNative.

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
  const { login, loginWithGoogle, resetPassword, ensureUserProfile } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError]         = useState('')
  // True when AuthContext force-expired a stale/revoked session and bounced
  // the user here. Read-once breadcrumb so a normal visit to /login stays
  // clean. Cleared immediately so a refresh doesn't re-show it.
  const [sessionExpired] = useState(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
        sessionStorage.removeItem(SESSION_EXPIRED_KEY)
        return true
      }
    } catch { /* private mode / quota — no notice, no harm */ }
    return false
  })

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
      // reCAPTCHA Enterprise bot check (native Android only — no-op on web,
      // which is covered by App Check). Fail-open: only a definitive 'block'
      // verdict stops sign-in; a null token or any assessment error proceeds.
      if (shouldBlock(await assessAction('login'))) {
        setError('We could not verify this request. Please try again in a moment.')
        return
      }
      const cred = await login(email.trim(), password)
      const profile = await ensureUserProfile(cred.user)
      // A null profile after a successful auth is almost always a transient
      // read failure on a flaky network (Zambia), NOT a missing profile.
      // AuthContext's onSnapshot listener (subscribeProfile) runs concurrently
      // and will populate the profile — or surface profileIssue — on its own.
      // Calling logout() here would destroy a perfectly valid Firebase session.
      // Navigate to "/" and let RootRedirect / MissingProfileRecovery handle
      // the profileIssue state (they already do: 'unreadable' shows Repair,
      // 'missing' shows Bootstrap + Sign Out). Only hard-fail if Firebase Auth
      // itself threw (caught below).
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      let message = friendlyAuthMessage(err.code, { online: navigator.onLine })
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
      const cred = await loginWithGoogle()
      const profile = await ensureUserProfile(cred.user)
      // Same reasoning as handleSubmit: a null profile is most likely a
      // transient network read failure, not a genuinely missing profile.
      // Do not call logout() — the Firebase session is valid. Navigate to "/"
      // and let RootRedirect / MissingProfileRecovery handle the profileIssue.
      navigate(getRoleLandingPath(profile, '/'), { replace: true })
    } catch (err) {
      if (err.code === 'auth/cancelled-popup-request') return
      // Log the raw code+message so an unmapped failure (e.g. a native Google
      // Play Services error) is diagnosable from the device console / Sentry
      // rather than hidden behind the generic fallback copy.
      console.error('[Google sign-in]', err?.code, err?.message)
      setError(friendlyAuthMessage(err.code, { online: navigator.onLine, fallback: 'Google sign-in failed. Please try again.' }))
    } finally { setGoogleLoading(false) }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    setResetError('')
    setResetLoading(true)
    try {
      await resetPassword(resetEmail.trim())
      // Always show the same neutral confirmation — the server never
      // reveals whether an account exists for this email (anti-
      // enumeration), so the UI must not either.
      setResetSuccess(true)
    } catch (err) {
      // Only genuinely-bad input gets a specific message; everything
      // else is generic so we don't leak account existence.
      setResetError(
        err.code === 'functions/invalid-argument' || err.code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : 'Failed to send reset email. Please try again.',
      )
    } finally { setResetLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative overflow-y-auto"
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

      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[520px] px-5 sm:px-8 pt-9 pb-8 animate-scale-in relative z-10">
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
                <p className="text-success text-display-md">Check your inbox</p>
                <p className="text-success text-body-sm mt-1 opacity-80">If an account exists for that email, we&apos;ve sent a link to reset your password.</p>
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

            {sessionExpired && (
              <p
                aria-live="polite"
                className="text-[13px] text-center rounded-xl px-4 py-2.5 mb-4 bg-amber-50 text-amber-800 border border-amber-200"
              >
                Your session ended for security. Please sign in again to continue.
              </p>
            )}

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
