import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../hooks/useSubscriptionReminder'
import { reminderCopy } from '../../utils/subscriptionStatus'
import { isReminderSuppressedPath } from '../../utils/reminderVisibility'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Sparkles, CheckCircleIcon, X } from '../ui/icons'

// In-session guard: once the popup has appeared this visit it never reopens,
// even before the Firestore snooze write lands. The Firestore
// reminderDismissedUntil field carries the "once per day" promise across
// sessions and devices.
const SESSION_SHOWN_KEY = 'zedexams.subReminderPopup.shown'

function shownThisSession() {
  try { return sessionStorage.getItem(SESSION_SHOWN_KEY) === '1' } catch { return false }
}
function markShownThisSession() {
  try { sessionStorage.setItem(SESSION_SHOWN_KEY, '1') } catch { /* ignore */ }
}

/**
 * Once-a-day upgrade/renew popup shown after login for Free and Expired users.
 * Eligibility (status + Firestore snooze) lives in useSubscriptionReminder;
 * this component owns presentation and the session guard. Pro / Trial users
 * never see it, so upgrading removes it automatically.
 */
export default function SubscriptionReminderPopup() {
  const { userProfile } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const {
    status, audience, benefits, popupEligible,
    snoozeReminders, recordReminderShown,
  } = useSubscriptionReminder()

  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) return undefined
    if (!userProfile) return undefined
    if (!popupEligible) return undefined
    if (shownThisSession()) return undefined
    if (isReminderSuppressedPath(pathname)) return undefined

    // Small delay so the popup lands after the dashboard paints rather than
    // racing the first frame.
    const t = setTimeout(() => {
      if (shownThisSession()) return
      markShownThisSession()
      setOpen(true)
      recordReminderShown()
    }, 900)
    return () => clearTimeout(t)
    // recordReminderShown is intentionally omitted: it derives from a
    // non-memoized context fn (new identity each render), and including it
    // would reset the 900ms timer on every parent re-render. It's only
    // called once behind the shownThisSession guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userProfile, popupEligible, pathname])

  // Esc + scroll lock while open.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') handleDismiss() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const copy = reminderCopy(status, audience)
  const expired = copy.tone === 'expired'

  function handleDismiss() {
    setOpen(false)
    snoozeReminders()
  }

  function handleUpgrade() {
    setOpen(false)
    snoozeReminders()
    navigate('/my-subscription')
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sub-reminder-popup-title"
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={handleDismiss}
        aria-hidden="true"
      />
      <div className="relative theme-card w-full rounded-t-3xl border theme-border shadow-2xl animate-scale-in overflow-hidden sm:max-w-md sm:rounded-3xl">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 min-h-0 rounded-full bg-transparent p-1.5 theme-text-muted shadow-none hover:theme-text"
        >
          <Icon as={X} size="md" />
        </button>

        <div
          className={`px-6 pt-7 pb-6 text-center text-white ${
            expired ? 'bg-red-500' : 'theme-accent-fill theme-on-accent'
          }`}
        >
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 text-3xl">
            <span aria-hidden="true">{copy.emoji}</span>
          </div>
          <p className="text-xs font-black uppercase tracking-widest opacity-90">{copy.badge}</p>
          <h2 id="sub-reminder-popup-title" className="mt-1 text-xl font-black leading-tight">
            {copy.title}
          </h2>
          <p className="mt-1.5 text-sm font-bold opacity-90">{copy.body}</p>
        </div>

        <div className="px-6 py-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-black theme-text">
            <Icon as={Sparkles} size="sm" strokeWidth={2.1} className="theme-accent-text" />
            {audience === 'teacher' ? 'Pro unlocks for teachers' : 'Pro unlocks for learners'}
          </p>
          <ul className="space-y-2">
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm font-bold theme-text">
                <Icon as={CheckCircleIcon} size="sm" strokeWidth={2.1} className="mt-0.5 flex-shrink-0 text-green-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={handleUpgrade}>
              {copy.cta}
            </Button>
            <Button variant="ghost" size="md" onClick={handleDismiss}>
              Maybe later
            </Button>
          </div>
          <p className="mt-3 text-center text-xs theme-text-muted">
            We&apos;ll only remind you once a day.
          </p>
        </div>
      </div>
    </div>
  )
}
