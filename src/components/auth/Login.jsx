import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { fetchSignInMethodsForEmail, signOut } from 'firebase/auth'
import { Mail, Eye, EyeOff } from 'lucide-react'
import { ArrowLeft } from '../ui/icons'
import { useAuth, SESSION_EXPIRED_KEY, hasAuthSessionHint } from '../../contexts/AuthContext'
import { auth } from '../../firebase/config'
import { resolvePostAuthPath } from '../../utils/navigation'
import { isWithinVerificationGrace, needsEmailVerification as userNeedsVerification } from '../../utils/verification'
import { friendlyAuthMessage } from '../../utils/friendlyErrors'
import { assessAction, shouldBlock } from '../../utils/recaptcha'
import { getResolver } from '../../services/adminMfa'
import { isMfaRequiredError } from '../../utils/mfaErrors'
import MfaChallenge from './MfaChallenge'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import GoogleSignInButton from './GoogleSignInButton'
import PasskeySignInButton from './PasskeySignInButton'
import AuthDivider from './AuthDivider'
import SecurityReassurance from './SecurityReassurance'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import { isPasskeySupported, signInWithPasskey, mapPasskeyError } from '../../services/passkeyService'
import SeoHelmet from '../seo/SeoHelmet'
import FullScreenLoader from '../ui/FullScreenLoader'

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
    currentUser, userProfile, loading: authLoading, profileIssue,
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
  const postLoginPath = (profile) => resolvePostAuthPath(profile, fromPath, '/')

  // A user who is ALREADY signed in has no business on the login form —
  // this is what makes the "bounced to /login while Firebase was still
  // restoring the session" case self-heal: the moment restoration completes,
  // they're sent straight back to where they were.
  useEffect(() => {
    if (authLoading || !currentUser) return
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
    if (userProfile) navigate(resolvePostAuthPath(userProfile, fromPath, '/'), { replace: true })
  }, [authLoading, currentUser, userProfile, profileIssue, fromPath, navigate, needsEmailVerification, location.state])

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [error, setError]         = useState('')
  // Neutral (non-error) notice — e.g. the user dismissed the passkey prompt.
  const [notice, setNotice]       = useState('')
  // Move keyboard/screen-reader focus to the alert when an error lands so
  // assistive tech announces it and a keyboard user isn't left hunting.
  const errorRef = useRef(null)
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])
  // Staged rollout: the passkey option only renders when the platform flag
  // is on. Support detection keeps the page working on browsers without
  // WebAuthn — they see a short pointer to the other methods instead.
  const { settings: platformSettings } = usePlatformSettings()
  const passkeysEnabled = platformSettings?.featureFlags?.passkeyAuthenticationEnabled === true
  const passkeySupported = isPasskeySupported()
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
    // profile — or surface profileIssue — on its own. Navigate and let
    // RootRedirect / MissingProfileRecovery handle any profileIssue state.
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

  async function handlePasskeySignIn() {
    setError('')
    setNotice('')
    setPasskeyLoading(true)
    try {
      const cred = await signInWithPasskey()
      await completePostLogin(cred)
    } catch (err) {
      const mapped = mapPasskeyError(err)
      if (mapped.cancelled) {
        // Dismissing the OS prompt is a normal outcome, not a system error.
        setNotice(mapped.message)
      } else {
        console.error('[Passkey sign-in]', mapped.code)
        setError(mapped.message)
      }
    } finally { setPasskeyLoading(false) }
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
  if (authLoading && !currentUser && hasAuthSessionHint()) {
    return <FullScreenLoader label="Restoring your session…" />
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
              {passkeysEnabled && passkeySupported && (
                <PasskeySignInButton
                  onClick={handlePasskeySignIn}
                  loading={passkeyLoading}
                  disabled={loading || googleLoading}
                />
              )}
              {passkeysEnabled && !passkeySupported && (
                <p className="text-[13px] text-[color:var(--text-muted)] text-center">
                  Passkeys are not supported on this browser. Use Google or your password to sign in.
                </p>
              )}
              {notice && (
                <p aria-live="polite" className="text-[14px] text-center rounded-xl px-4 py-2.5 bg-[color:var(--bg-subtle)] text-[color:var(--text-muted)] border border-[color:var(--border)]">
                  {notice}
                </p>
              )}
              <GoogleSignInButton
                onClick={handleGoogleSignIn}
                loading={googleLoading}
                disabled={loading || passkeyLoading}
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
