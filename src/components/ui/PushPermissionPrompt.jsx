import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { isPushSupported, pushPermission, requestPushPermission } from '../../utils/fcm'

const SEEN_KEY = 'zedexams:push-asked'

/**
 * Opt-in card for daily-reminder push notifications (audit A5.1).
 *
 * Browsers permanently remember a denied permission, so this prompt
 * fires at most ONCE per user — only when:
 *   - The browser supports web push (rules out Capacitor + Safari < 16.4)
 *   - Notification.permission is still 'default' (never asked)
 *   - localStorage flag `push-asked` is unset (we haven't asked here)
 *   - The learner has a streak ≥ 2 (high-intent moment — they came
 *     back a second day, so a daily reminder is likely welcome)
 *
 * `streak` is read from the host page (passed as a prop) rather than
 * fetched here, so this component is reusable on any surface that
 * already has the value.
 *
 * The card is dismissible without asking — "Not now" closes it and
 * sets the seen flag so the user isn't pestered. They can still enable
 * notifications later via browser settings if they change their mind.
 */
export default function PushPermissionPrompt({ streak = 0 }) {
  const { currentUser } = useAuth()

  // `null` until effect runs so the SSR-style first paint matches the
  // hidden case — avoids a flash of the card before localStorage is
  // read.
  const [shouldShow, setShouldShow] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentUser) { setShouldShow(false); return }
    if (!isPushSupported()) { setShouldShow(false); return }
    if (streak < 2) { setShouldShow(false); return }
    if (pushPermission() !== 'default') { setShouldShow(false); return }
    let seen = null
    try { seen = localStorage.getItem(SEEN_KEY) } catch { /* private mode */ }
    setShouldShow(seen !== 'shown')
  }, [currentUser, streak])

  if (!shouldShow) return null

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, 'shown') } catch { /* private mode */ }
    setShouldShow(false)
  }

  async function handleAccept() {
    setBusy(true)
    try {
      await requestPushPermission(currentUser?.uid)
    } finally {
      setBusy(false)
      markSeen()
    }
  }

  return (
    <section
      role="region"
      aria-label="Daily reminders opt-in"
      className="theme-card theme-border rounded-radius-md border p-4 shadow-elev-sm flex flex-col sm:flex-row items-start sm:items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">🔔</span>
          Want a friendly daily nudge?
        </p>
        <p className="theme-text-muted text-xs mt-1 leading-snug">
          Pako can remind you each day to keep your {streak}-day streak alive. You can turn this off any time in your browser.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={markSeen}
          disabled={busy}
          className="rounded-full border-2 theme-border theme-text-muted bg-transparent px-3 py-1.5 text-xs font-bold hover:theme-bg-subtle hover:theme-text disabled:opacity-50"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={busy}
          className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-bold shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Asking…' : 'Yes, remind me'}
        </button>
      </div>
    </section>
  )
}
