import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { resolvePostAuthPath } from '../../../utils/navigation'
import { friendlyVerificationError } from '../../../utils/verification'
import Logo from '../../../shared/components/Logo'
import Button from '../../../shared/components/Button'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import FullScreenLoader from '../../../shared/components/FullScreenLoader'

// Silent focus/visibility re-checks are throttled so switching tabs
// repeatedly doesn't hammer the Auth server.
const AUTO_CHECK_THROTTLE_MS = 10_000

/**
 * The verification gate for unverified email/password accounts. Every route
 * guard funnels unverified users here; this page redirects verified users
 * away, so the two can never loop. Renders without a Firestore profile on
 * purpose — a user whose profile read failed must still be able to verify,
 * resend, or sign out.
 */
export default function VerifyEmail() {
  const {
    currentUser, userProfile, loading, authReady, emailVerified,
    refreshEmailVerification, resendVerificationEmail, logout,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [feedback, setFeedback] = useState(null) // { kind: 'ok'|'err'|'info', text }
  const lastAutoCheckRef = useRef(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  // Zero-click flow: the user verifies in another tab (or on their phone) and
  // comes back — re-check on mount and whenever the page regains focus.
  const silentCheck = useCallback(() => {
    const now = Date.now()
    if (now - lastAutoCheckRef.current < AUTO_CHECK_THROTTLE_MS) return
    lastAutoCheckRef.current = now
    refreshEmailVerification().catch(() => null)
  }, [refreshEmailVerification])

  useEffect(() => {
    if (!currentUser || emailVerified !== false) return
    silentCheck()
    const onFocus = () => silentCheck()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [currentUser, emailVerified, silentCheck])

  // ── Guard block: this page renders ONLY for signed-in, unverified users ──
  if (!authReady || loading || (currentUser && emailVerified === null)) {
    return <FullScreenLoader label="Restoring your session…" />
  }
  if (!currentUser) return <Navigate to="/login" replace />
  if (emailVerified) {
    // Same rule as Login: the stashed page is honoured only when this account
    // can actually open it, so verifying never lands a teacher on a learner
    // route they were bounced from.
    const from = location.state?.from
    const fromPath = from ? `${from.pathname || ''}${from.search || ''}` || null : null
    return <Navigate to={resolvePostAuthPath(userProfile, fromPath, '/')} replace />
  }

  async function handleConfirmVerified() {
    setChecking(true)
    setFeedback(null)
    try {
      const verified = await refreshEmailVerification()
      // On success the guard block above redirects on the next render.
      if (!verified) {
        setFeedback({
          kind: 'err',
          text: 'Your email has not been verified yet. Open the verification email and click the verification link, then try again.',
        })
      }
    } catch (err) {
      setFeedback({ kind: 'err', text: friendlyVerificationError(err) })
    } finally {
      setChecking(false)
    }
  }

  async function handleResend() {
    setResending(true)
    setFeedback(null)
    try {
      await resendVerificationEmail()
      setCooldown(60)
      setFeedback({
        kind: 'ok',
        text: `Sent! Check ${currentUser.email || 'your inbox'} — and the spam or junk folder.`,
      })
    } catch (err) {
      setFeedback({ kind: 'err', text: friendlyVerificationError(err) })
    } finally {
      setResending(false)
    }
  }

  async function handleChangeEmail() {
    // An unverified account can't prove it owns the old address, so the safe
    // "change email" is: sign out and register again with the right one.
    // (In-place verifyBeforeUpdateEmail is a possible future enhancement.)
    await logout()
    navigate('/register', { replace: true })
  }

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  const busy = checking || resending

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative overflow-y-auto"
      style={{
        backgroundColor: 'var(--zt-surface)',
        '--accent': '#B44F2D',
        '--accent-bg': '#F8EADF',
        '--accent-fg': '#83372C',
      }}
    >
      <SeoHelmet
        title="Verify your email"
        description="Confirm your email address to start using ZedExams."
        path="/verify-email"
        noIndex
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
      </div>

      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[520px] px-5 sm:px-8 pt-9 pb-8 animate-scale-in relative z-10">
        <div className="flex flex-col items-center mb-2.5 gap-1">
          <Logo variant="full" size="md" />
          <p className="text-[12px] text-[#6E7280] font-body">Practise smart.</p>
        </div>

        <div className="text-center mb-6 animate-slide-up">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-bg)]">
            <span aria-hidden="true" className="text-2xl">✉️</span>
          </div>
          <h1 className="text-[20px] font-bold text-[#1A1F2E]">Verify your email</h1>
          <p className="text-[13px] text-[#6E7280] mt-2 leading-relaxed">
            We sent a verification link to
            {' '}
            <span className="font-semibold text-[#1A1F2E] break-all">
              {currentUser.email || 'your email address'}
            </span>
            .
          </p>
          <p className="text-[13px] text-[#6E7280] mt-2 leading-relaxed">
            Open the email and click the link, then come back here. If you
            can&apos;t find it, check your <strong>spam or junk</strong> folder.
          </p>
        </div>

        {feedback && (
          <p
            aria-live="polite"
            className={`text-[13px] rounded-xl px-4 py-3 mb-4 border ${
              feedback.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {feedback.text}
          </p>
        )}

        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={checking}
            disabled={busy}
            onClick={handleConfirmVerified}
          >
            {checking ? 'Checking…' : 'I have verified my email'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={resending}
            disabled={busy || cooldown > 0}
            onClick={handleResend}
          >
            {resending
              ? 'Sending…'
              : cooldown > 0
                ? `Resend verification email (${cooldown}s)`
                : 'Resend verification email'}
          </Button>
        </div>

        <div className="flex items-center justify-center gap-4 mt-6 text-[12.5px]">
          <button
            type="button"
            onClick={handleChangeEmail}
            disabled={busy}
            className="text-[var(--accent)] font-semibold hover:underline bg-transparent shadow-none p-0 min-h-0 disabled:opacity-50"
          >
            Use a different email
          </button>
          <span aria-hidden="true" className="text-[#ddd]">|</span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={busy}
            className="text-[#6E7280] font-semibold hover:underline bg-transparent shadow-none p-0 min-h-0 disabled:opacity-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
