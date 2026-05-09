import { useEffect, useState } from 'react'
import { sendEmailVerification } from 'firebase/auth'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Inline reminder banner for unverified email accounts (audit A8).
 *
 * The verification email already fires once at register time
 * (AuthContext.register → sendEmailVerification). It can quietly fail
 * (Firebase rate limits, transient outage), the user might lose the
 * email, or they might confuse it for spam. Without a visible "resend"
 * button anywhere, those users get stuck.
 *
 * The banner:
 *   - Renders only when the signed-in user's `emailVerified` is false.
 *     Google-sign-in accounts always come back true, so they never see
 *     this — only direct email/password signups do.
 *   - "Resend" calls sendEmailVerification with a 60-second client-side
 *     cooldown so a frustrated user can't spam the SDK (which would
 *     start returning auth/too-many-requests anyway).
 *   - "Dismiss" is per-session — no localStorage. We *want* the nudge
 *     to come back every fresh visit until they verify.
 *   - "I just verified" runs reload() on the auth user so the badge
 *     vanishes the second they tap the link in another tab and come
 *     back; otherwise emailVerified stays stale until next sign-in.
 */
export default function VerifyEmailBanner() {
  const { currentUser } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  const [busyResend, setBusyResend] = useState(false)
  const [busyRefresh, setBusyRefresh] = useState(false)
  const [feedback, setFeedback] = useState(null) // {kind, text}
  // Number of seconds the resend button stays disabled after a click.
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  if (!currentUser || currentUser.emailVerified || dismissed) return null

  async function handleResend() {
    setBusyResend(true)
    setFeedback(null)
    try {
      await sendEmailVerification(currentUser)
      setFeedback({
        kind: 'ok',
        text: `Sent! Check ${currentUser.email || 'your inbox'} (and the spam folder).`,
      })
      setCooldown(60)
    } catch (err) {
      // Firebase returns auth/too-many-requests if you spam the SDK.
      // Surface the real cause so the user knows it isn't a typo on
      // their end.
      const msg = err?.code === 'auth/too-many-requests'
        ? 'Too many requests — try again in a minute.'
        : 'Couldn\'t send right now. Please try again shortly.'
      setFeedback({ kind: 'err', text: msg })
    } finally {
      setBusyResend(false)
    }
  }

  async function handleAlreadyVerified() {
    setBusyRefresh(true)
    setFeedback(null)
    try {
      await currentUser.reload()
      // After reload, emailVerified updates in-place. The next render
      // sees the new value via the auth state subscription and hides
      // this banner automatically.
      if (!currentUser.emailVerified) {
        setFeedback({
          kind: 'err',
          text: "We don't see a verification yet — check the link in your email and click it again.",
        })
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Refresh failed — try again.' })
    } finally {
      setBusyRefresh(false)
    }
  }

  const cooldownLabel = cooldown > 0 ? ` (${cooldown}s)` : ''

  return (
    <section
      role="region"
      aria-label="Email verification reminder"
      className="theme-card theme-border rounded-radius-md border p-4 shadow-elev-sm flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">✉️</span>
          Confirm your email
        </p>
        <p className="theme-text-muted text-xs mt-1 leading-snug">
          We sent a verification link to{' '}
          <span className="font-bold theme-text">
            {currentUser.email || 'your email address'}
          </span>
          . Click it so we know it's really you.
        </p>
        {feedback && (
          <p
            role="status"
            className={`text-xs mt-2 font-bold ${
              feedback.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={handleAlreadyVerified}
          disabled={busyRefresh || busyResend}
          className="rounded-full border-2 theme-border theme-text-muted bg-transparent px-3 py-1.5 text-xs font-bold hover:theme-bg-subtle hover:theme-text disabled:opacity-50"
        >
          {busyRefresh ? 'Checking…' : 'I just verified'}
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={busyResend || busyRefresh || cooldown > 0}
          className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-bold shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {busyResend ? 'Sending…' : `Resend${cooldownLabel}`}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss verification reminder"
          className="rounded-full theme-text-muted hover:theme-text px-2 py-1.5 text-xs font-bold disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </section>
  )
}
