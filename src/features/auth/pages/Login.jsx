import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { fetchSignInMethodsForEmail, signOut } from 'firebase/auth'
import { Mail, Eye, EyeOff } from 'lucide-react'
import { ArrowLeft } from '../../../shared/components/icons'
import { useAuth, SESSION_EXPIRED_KEY, hasAuthSessionHint } from '../../../contexts/AuthContext'
import { auth } from '../../../firebase/config'
import { resolvePostAuthPath } from '../../../utils/navigation'
import { isWithinVerificationGrace, needsEmailVerification as userNeedsVerification } from '../../../utils/verification'
import { friendlyAuthMessage } from '../../../utils/friendlyErrors'
import { assessAction, shouldBlock } from '../../../utils/recaptcha'
import { getResolver } from '../../../services/adminMfa'
import { isMfaRequiredError } from '../../../utils/mfaErrors'
import MfaChallenge from '../components/MfaChallenge'
import Logo from '../../../shared/components/Logo'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import GoogleSignInButton from '../components/GoogleSignInButton'
import AuthDivider from '../components/AuthDivider'
import SecurityReassurance from '../components/SecurityReassurance'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import FullScreenLoader from '../../../shared/components/FullScreenLoader'

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
    // `methods` is Firebase's array of provider IDs; 'google.com' here is the
    // GoogleAuthProvider.PROVIDER_ID constant, not a URL. Compare each entry
    // with exact equality so this can never degrade into a substring match.
    const hasGoogle = methods.some((method) => method === 'google.com')
    if (hasGoogle && !hasPassword) {
      return 'This email signs in with Google. Use "Continue with Google" above, or click "Forgot password?" to set up a password.'
    }
  } catch {
    /* enumeration protection or network error — fall back to default copy */
  }
  return null
}

const INPUT_CLASS =
  'w-full h-14 rounded-[14px] border border-[color:var(--input-border)] bg-[color:var(--input-bg)] ' +
  'text-[color:var(--text)] text-[16px] font-body px-4 outline-none transition-colors ' +
  'placeholder:text-[color:var(--text-muted)] focus:border-[var(--accent)] ' +
  'focus:ring-[3px] focus:ring-[var(--accent)]/20'

const LABEL_CLASS = 'block text-[15px] font-medium text-[color:var(--text)] mb-1.5'

export default function Login() {
  const {
    login, loginWithGoogle, resetPassword, ensureUserProfile,
    currentUser, userProfile, authReady, profileIssue,
    needsEmailVerification,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Where to send the user after sign-in. A route guard that bounced them
  // here stashes the page they were trying to open in location.state.from —
  // honour it so a refresh of /teacher/quiz-studio lands back on
  // /teacher/quiz-studio, not the generic dashboard. Falls back to the
  // role landing page when they came to /login directly, and ALSO when the
  // stashed page belongs to a portal this account can't open: the stash
  // records what the browser asked for, so a teacher following a learner's
  // /notes/:id link would otherwise be signed in and dropped on a learner
  // route. resolvePostAuthPath discards those.
  const fromPath = location.state?.from
    ? `${location.state.from.pathname || ''}${location.state.from.search || ''}` || null
    : null
  // `/dashboard` is the fallback, not `/`. Sending a signed-in user to `/`
  // meant a second hop through RootRedirect to work out the same answer, and
  // that hop is a window in which a slow profile read renders the public
  // marketing page to somebody who just signed in. resolvePostAuthPath still
  // owns the role correction, so a teacher whose stashed `from` is a
  // learner-only path lands on /teacher rather than being bounced.
  const postLoginPath = (profile) => resolvePostAuthPath(profile, fromPath, '/dashboard')

  // A user who is ALREADY signed in has no business on the login form —
  // this is what makes the "bounced to /login while Firebase was still
  // restoring the session" case self-heal: the moment restoration completes,
  // they're sent straight back to where they were.
  useEffect(() => {
    // `authReady`, not `authLoading`. The restoration watchdog drops
    // `authLoading` without knowing who the user is, so gating on it let this
    // effect run — and decline to redirect — while Firebase was still
    // restoring, which is what left a signed-in learner sitting on the sign-in
    // form after a cold load bounced them here.
    if (!authReady || !currentUser) return
    // Unverified email/password session — the verification gate, not the
    // dashboard, is where they continue. Carry fromPath through so verifying
    // returns them to the page they originally wanted.
    if (needsEmailVerification && !isWithinVerificationGrace(userProfile)) {
      navigate('/verify-email', { replace: true, state: location.state })
      return
    }
    if (profileIssue) {
      // Signed in but the profile couldn't be read — let RootRedirect show
      // the recovery screen rather than stranding them on the login form.
      navigate('/', { replace: true })
      return
    }
    if (userProfile) navigate(postLoginPath(userProfile), { replace: true })
    // `postLoginPath` is recreated every render and would re-run this effect on
    // each one; it is a pure function of `fromPath`, which IS declared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, currentUser, userProfile, profileIssue, fromPath, navigate, needsEmailVerification, location.state])

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError]         = useState('')
  // Move keyboard/screen-reader focus to the alert when an error lands so
  // assistive tech announces it and a keyboard user isn't left hunting.
  const errorRef = useRef(null)
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])
  // Firebase multi-factor resolver, set when a first-factor sign-in throws
  // auth/multi-factor-auth-required. Held in component state ONLY (never
  // serialised) — a refresh clears it and drops the user back to the form.
  const [mfaResolver, setMfaResolver] = useState(null)
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

  // Shared post-first-factor tail: resolve the profile, honour the verification
  // gate, then land the user. Used by the email/password flow, the Google flow,
  // AND the MFA challenge's onSuccess so all three continue identically.
  async function completePostLogin(cred) {
    const profile = await ensureUserProfile(cred.user)
    // Unverified email/password account (no grace window): continue at the
    // verification gate. location.state.from rides along so verifying lands
    // them on the page they originally asked for.
    if (userNeedsVerification(cred.user) && !isWithinVerificationGrace(profile)) {
      navigate('/verify-email', { replace: true, state: location.state })
      return
    }
    // A null profile after a successful auth is almost always a transient
    // read failure on a flaky network (Zambia), NOT a missing profile.
    // AuthContext's onSnapshot listener runs concurrently and will populate the
    // profile — or surface profileIssue — on its own.
    //
    // With no profile there is no role, so there is nothing to land ON. `/` is
    // the destination on purpose: RootRedirect owns the recovery screen and
    // re-decides the moment the profile arrives. Sending them to the learner
    // landing instead would guess at a role we do not have — and guess wrong
    // for every teacher and admin.
    if (!profile) {
      navigate('/', { replace: true })
      return
    }
    navigate(postLoginPath(profile), { replace: true })
  }

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
      await completePostLogin(cred)
    } catch (err) {
      // MFA-enrolled account: the first factor succeeded but Firebase needs the
      // second factor. Switch to the challenge instead of showing an error.
      if (isMfaRequiredError(err)) {
        setMfaResolver(getResolver(err))
        return
      }
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
      await completePostLogin(cred)
    } catch (err) {
      if (err.code === 'auth/cancelled-popup-request') return
      // MFA-enrolled Google admin: show the second-factor challenge.
      if (isMfaRequiredError(err)) {
        setMfaResolver(getResolver(err))
        return
      }
      // Log the raw code+message so an unmapped failure (e.g. a native Google
      // Play Services error) is diagnosable from the device console / Sentry
      // rather than hidden behind the generic fallback copy.
      console.error('[Google sign-in]', err?.code, err?.message)
      setError(friendlyAuthMessage(err.code, { online: navigator.onLine, fallback: 'Google sign-in failed. Please try again.' }))
    } finally { setGoogleLoading(false) }
  }

  // MFA challenge completed → continue the normal role/route resolution.
  async function handleMfaSuccess(cred) {
    setMfaResolver(null)
    try {
      await completePostLogin(cred)
    } catch {
      // A profile read hiccup post-MFA is handled by RootRedirect; land there.
      navigate('/', { replace: true })
    }
  }

  // Cancel the challenge: abandon the half-completed sign-in and return to the
  // form. signOut clears any partial state Firebase may hold.
  async function handleMfaCancel() {
    setMfaResolver(null)
    try { await signOut(auth) } catch { /* already signed out */ }
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

  // A first factor completed but Firebase requires the authenticator code —
  // show the second-factor challenge in place of the form.
  if (mfaResolver) {
    return <MfaChallenge resolver={mfaResolver} onSuccess={handleMfaSuccess} onCancel={handleMfaCancel} />
  }

  // This device has a known signed-in session that Firebase is still
  // restoring — hold on the branded loader rather than flashing the sign-in
  // form at a user who never signed out. A genuinely signed-out visitor has
  // no hint and falls straight through to the form.
  // Two cases, one screen:
  //   • auth is still resolving on a device with a known session — the old
  //     condition, kept;
  //   • auth HAS resolved and there is a live user — the redirect effect above
  //     is about to fire, and the form must not flash in the meantime. Without
  //     this an authenticated user saw the sign-in form for a frame on every
  //     bounce through /login.
  if (!authReady && !currentUser && hasAuthSessionHint()) {
    return <FullScreenLoader label="Restoring your session…" />
  }
  if (authReady && currentUser) {
    return <FullScreenLoader label="Taking you back…" />
  }

  return (
    <div
      className="auth-page min-h-screen flex items-start sm:items-center justify-center px-4 py-6 sm:p-8 overflow-y-auto"
    >
      <SeoHelmet
        title="Sign in"
        description="Sign in to your ZedExams account."
        path="/login"
        noIndex
      />

      <div className="bg-white rounded-[24px] sm:rounded-[28px] shadow-[0_8px_30px_rgba(17,24,39,0.07)] w-full max-w-[480px] px-6 sm:px-8 pt-8 pb-7 animate-scale-in motion-reduce:animate-none">
        {/* Logo — the asset itself carries the "Practise smart." tagline, so
            it must never be repeated as separate text below. */}
        <div className="flex justify-center">
          <Logo variant="full" size="lg" />
        </div>

        {forgotMode ? (
          /* ── Forgot Password Flow ── */
          <div className="animate-slide-up motion-reduce:animate-none mt-4">
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
              <h2 className="text-[24px] font-bold text-[color:var(--text)]">Reset password</h2>
              <p className="text-[15px] text-[color:var(--text-muted)] mt-1">Enter your email and we'll send you a reset link.</p>
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
              <form onSubmit={handleResetPassword} className="space-y-4" aria-busy={resetLoading}>
                <div>
                  <label htmlFor="reset-email" className={LABEL_CLASS}>Email address</label>
                  <div className="relative">
                    <input
                      id="reset-email"
                      name="resetEmail"
                      type="email"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      required
                      placeholder="you@email.com"
                      autoComplete="email"
                      inputMode="email"
                      spellCheck={false}
                      autoCapitalize="none"
                      className={`${INPUT_CLASS} pr-12`}
                    />
                    <Mail size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" aria-hidden="true" />
                  </div>
                </div>
                {resetError && (
                  <p role="alert" tabIndex={-1} className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm outline-none" style={{ borderColor: 'var(--danger-fg)' }}>
                    {resetError}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={resetLoading}
                  className="min-h-[58px] rounded-[16px] text-[17px]"
                >
                  {resetLoading ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            )}
          </div>
        ) : (
          /* ── Login Form ── */
          <>
            <div className="text-center mt-3 mb-6">
              <h1 className="text-[30px] sm:text-[32px] font-bold text-[color:var(--text)] tracking-tight">Welcome back</h1>
              <p className="text-[17px] sm:text-[18px] text-[color:var(--text-muted)] mt-1">Sign in to your account</p>
            </div>

            {sessionExpired && (
              <p
                aria-live="polite"
                className="text-[14px] text-center rounded-xl px-4 py-2.5 mb-4 bg-amber-50 text-amber-800 border border-amber-200"
              >
                Your session ended for security. Please sign in again to continue.
              </p>
            )}

            <div className="animate-slide-up motion-reduce:animate-none space-y-3.5">
              <GoogleSignInButton
                onClick={handleGoogleSignIn}
                loading={googleLoading}
                disabled={loading}
              />
            </div>

            <AuthDivider />

            <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up motion-reduce:animate-none" aria-busy={loading}>
              <div>
                <label htmlFor="login-email" className={LABEL_CLASS}>Email address</label>
                <div className="relative">
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="you@email.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    autoCapitalize="none"
                    className={`${INPUT_CLASS} pr-12`}
                  />
                  <Mail size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" aria-hidden="true" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className={`${LABEL_CLASS} mb-0`}>Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setResetEmail(email) }}
                    className="text-[14px] font-medium text-[var(--accent)] hover:opacity-75 bg-transparent shadow-none px-1 py-2 min-h-[44px] inline-flex items-center rounded-lg"
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
                    className={`${INPUT_CLASS} pr-14`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    onMouseDown={e => e.preventDefault()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-11 h-11 rounded-xl text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors bg-transparent shadow-none p-0 min-h-0"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    aria-pressed={showPw}
                  >
                    {showPw
                      ? <EyeOff size={20} aria-hidden="true" />
                      : <Eye size={20} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {error && (
                <p
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm outline-none"
                  style={{ borderColor: 'var(--danger-fg)' }}
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                className="min-h-[58px] rounded-[16px] text-[17px]"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </>
        )}

        <p className="text-center text-[15px] text-[color:var(--text-muted)] mt-6">
          New to ZedExams?{' '}
          <Link
            to="/register"
            className="text-[var(--accent)] font-semibold hover:underline rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent)]/30 inline-flex min-h-[44px] items-center px-1"
          >
            Create a free account
          </Link>
        </p>

        <SecurityReassurance />
      </div>
    </div>
  )
}
