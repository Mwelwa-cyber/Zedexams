import { useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { resolveSubscriptionStatus } from '../engines/payment-engine/subscriptionStatus'

// How long the Welcome-Back popup stays snoozed after a dismissal. ~60h (2.5
// days) so a Free user is nudged every few days rather than every login —
// contextual, not nagging. Persisted to Firestore (reminderDismissedUntil) so
// the cadence holds across sessions and devices.
const SNOOZE_HOURS = 60

// A brand-new account never sees the Welcome-Back popup: greeting someone who
// just registered with "Welcome Back!" is jarring, and their first session is
// already the one place the status banner + in-page upgrade prompts pile up.
// Let them explore first; the nudge starts on day two.
const MIN_ACCOUNT_AGE_HOURS = 24

function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Single hook every reminder surface reads from. Resolves the four-state
 * subscription status for the right audience and exposes the once-a-day
 * dismissal state backed by the user's Firestore profile.
 *
 * ── The popup this cadence was built for is gone ────────────────────────
 *
 * `popupEligible`, `snoozeReminders` and `recordReminderShown` existed for the
 * mount-time "Welcome Back / Your Premium has ended" interstitial, which was
 * deleted outright. The three live consumers left — SubscriptionStatusBanner,
 * SubscriptionReminderCard and the teacher SubscriptionPanel — read only the
 * resolved status. The snooze primitives are kept because the cadence they
 * encode (a nudge every ~2.5 days, never in the first 24 hours) is the same
 * cadence the notification centre needs for renewal messages, and re-deriving
 * it from scratch later is how two different answers to "how often" appear.
 * Nothing may reintroduce a mount-time modal on top of them; the interruption
 * budget in src/services/entitlements is where that decision now lives.
 *
 * @param {object} [opts]
 * @param {'learner'|'teacher'} [opts.audience] force an audience (defaults to role)
 */
export function useSubscriptionReminder(opts = {}) {
  const { userProfile, updateProfileFields } = useAuth()
  const audience = opts.audience

  const status = useMemo(
    () => resolveSubscriptionStatus(userProfile, { audience }),
    [userProfile, audience],
  )

  const dismissedUntil = toDate(userProfile?.reminderDismissedUntil)
  const isSnoozed = !!dismissedUntil && dismissedUntil > new Date()

  // First-session guard: accounts younger than MIN_ACCOUNT_AGE_HOURS are never
  // popup-eligible. A missing createdAt (legacy profile) counts as old — the
  // guard exists to protect genuinely-new users, not to silence the nudge.
  const createdAt = toDate(userProfile?.createdAt)
  const isNewAccount =
    !!createdAt && Date.now() - createdAt.getTime() < MIN_ACCOUNT_AGE_HOURS * 60 * 60 * 1000

  // The login popup may show when the user still needs reminding AND they
  // haven't snoozed it today AND the account isn't brand-new. Pro / Trial
  // users never qualify (shouldRemind is false), which is how upgrading
  // silently removes every reminder.
  const popupEligible = status.shouldRemind && !isSnoozed && !isNewAccount

  // Snooze the popup for the rest of the day and record that we showed it.
  // Writes only the two reminder fields, which the Firestore self-update rule
  // permits (they're not on the subscription blocklist).
  const snoozeReminders = useCallback(async () => {
    const until = new Date(Date.now() + SNOOZE_HOURS * 60 * 60 * 1000)
    try {
      await updateProfileFields({
        reminderDismissedUntil: until,
        lastPaymentReminderShownAt: new Date(),
      })
    } catch (err) {
      // Non-fatal — the in-session guard still prevents re-showing this visit.
      console.warn('[subscriptionReminder] snooze failed:', err)
    }
  }, [updateProfileFields])

  // Record that a reminder was surfaced (used by the popup on first show) so
  // analytics / future cadence logic has a timestamp without snoozing.
  const recordReminderShown = useCallback(async () => {
    try {
      await updateProfileFields({ lastPaymentReminderShownAt: new Date() })
    } catch (err) {
      console.warn('[subscriptionReminder] record-shown failed:', err)
    }
  }, [updateProfileFields])

  return {
    ...status,
    dismissedUntil,
    isSnoozed,
    isNewAccount,
    popupEligible,
    snoozeReminders,
    recordReminderShown,
  }
}
