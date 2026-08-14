import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../shared/components/Toast'
import { isPushSupported, pushPermission, requestPushPermission } from '../../utils/fcm'

// Per-variant "already asked here" flag so dismissing on one surface doesn't
// suppress the other (a shared account is one role in practice, but keeping the
// keys separate is harmless and future-proof).
const SEEN_KEY = {
  learner: 'zedexams:push-asked',
  teacher: 'zedexams:push-asked-teacher',
}

// Copy per audience. Learners get the streak-reminder framing; teachers get the
// "your generated work is ready / learners submitted" framing.
const COPY = {
  learner: {
    label: 'Daily reminders opt-in',
    icon: '🔔',
    title: 'Want a friendly daily nudge?',
    body: (streak) =>
      `Pako can remind you each day to keep your ${streak}-day streak alive. You can turn this off any time.`,
    accept: 'Yes, remind me',
  },
  teacher: {
    label: 'Notifications opt-in',
    icon: '🔔',
    title: 'Get notified on this device',
    body: () =>
      "We'll ping you when your generated materials are ready and when learners submit assigned work. Turn it off any time.",
    accept: 'Enable notifications',
  },
}

/**
 * Opt-in card for push notifications (audit A5.1).
 *
 * Browsers permanently remember a denied permission, so this prompt fires at
 * most ONCE per user per surface — only when:
 *   - the platform supports push (rules out Safari < 16.4; on Capacitor it uses
 *     the native plugin),
 *   - permission is still 'default' (never asked),
 *   - the per-variant localStorage "asked" flag is unset, and
 *   - (learner variant only) the learner has a streak ≥ 1 — a light intent
 *     signal so we ask engaged learners, including newer ones, without popping
 *     on a brand-new account's very first paint.
 *
 * `variant` selects learner vs teacher copy; `streak` is only read for the
 * learner variant. The card is dismissible without asking ("Not now" sets the
 * seen flag). On accept it reports honest feedback: success only when a token
 * actually mints (requestPushPermission returns 'granted'), otherwise a
 * "couldn't enable" toast — mirroring the settings panels.
 */
export default function PushPermissionPrompt({ streak = 0, variant = 'learner' }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const copy = COPY[variant] || COPY.learner
  const seenKey = SEEN_KEY[variant] || SEEN_KEY.learner

  // `null` until the effect runs so the first paint matches the hidden case —
  // avoids a flash of the card before localStorage is read.
  const [shouldShow, setShouldShow] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentUser) { setShouldShow(false); return }
    if (!isPushSupported()) { setShouldShow(false); return }
    if (variant === 'learner' && streak < 1) { setShouldShow(false); return }
    if (pushPermission() !== 'default') { setShouldShow(false); return }
    let seen = null
    try { seen = localStorage.getItem(seenKey) } catch { /* private mode */ }
    setShouldShow(seen !== 'shown')
  }, [currentUser, streak, variant, seenKey])

  if (!shouldShow) return null

  function markSeen() {
    try { localStorage.setItem(seenKey, 'shown') } catch { /* private mode */ }
    setShouldShow(false)
  }

  async function handleAccept() {
    setBusy(true)
    try {
      const result = await requestPushPermission(currentUser?.uid)
      if (result === 'granted') {
        toast.success('Notifications enabled on this device.')
      } else if (result === 'denied') {
        toast.error('Notifications were blocked. You can allow them in your device or browser settings.')
      } else {
        // 'error' (granted but no token) / 'unsupported' — permission wasn't the
        // blocker, so don't tell them to change settings.
        toast.error("Couldn't enable notifications on this device right now.")
      }
    } finally {
      setBusy(false)
      markSeen()
    }
  }

  return (
    <section
      role="region"
      aria-label={copy.label}
      className="theme-card theme-border rounded-radius-md border p-4 shadow-elev-sm flex flex-col sm:flex-row items-start sm:items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">{copy.icon}</span>
          {copy.title}
        </p>
        <p className="theme-text-muted text-xs mt-1 leading-snug">
          {copy.body(streak)}
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
          {busy ? 'Asking…' : copy.accept}
        </button>
      </div>
    </section>
  )
}
