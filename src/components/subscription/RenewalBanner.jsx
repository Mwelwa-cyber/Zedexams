import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { daysUntilExpiry, PLANS } from '../../utils/subscriptionConfig'
import Button from '../ui/Button'

// How early to start nudging. 7 days is enough lead time for a parent
// to top up via Mobile Money without feeling spammed; under that and the
// urgency lands. Anything beyond 7 and the user just dismisses out of
// reflex.
const NUDGE_WINDOW_DAYS = 7
// Session-scoped dismiss key. We don't persist this to Firestore — the
// next reload (or next session) re-shows the banner, which is what we
// want: a learner who closed the tab without renewing should see it
// again when they come back.
const DISMISS_KEY = 'zedexams.renewalBanner.dismissedFor'

function tone(daysLeft) {
  if (daysLeft <= 1) {
    return {
      bg: 'bg-red-50 border-red-300',
      icon: '⚠️',
      verb: 'expires today',
      btn: 'Renew now',
    }
  }
  if (daysLeft <= 3) {
    return {
      bg: 'bg-orange-50 border-orange-300',
      icon: '⏰',
      verb: `expires in ${daysLeft} days`,
      btn: 'Renew now',
    }
  }
  return {
    bg: 'bg-amber-50 border-amber-300',
    icon: '🔔',
    verb: `expires in ${daysLeft} days`,
    btn: 'Renew',
  }
}

/**
 * Soft renewal nudge for learners within 7 days of subscription expiry.
 * Renders inline above the dashboard (not a modal — modal nags are
 * easy to develop banner-blindness toward). Dismissable per session.
 *
 * Wires the existing UpgradeModal — caller passes `onRenewClick` which
 * should setShowUpgrade(true) on the parent so the modal opens
 * pre-loaded with the user's current plan.
 */
export default function RenewalBanner({ onRenewClick }) {
  const { userProfile } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  const daysLeft = daysUntilExpiry(userProfile)
  const currentPlanId = userProfile?.subscriptionPlan
  const currentPlan = currentPlanId ? PLANS[currentPlanId] : null

  // Dismissal is keyed on the current expiry timestamp so granting a
  // renewal (which moves the expiry forward) resets the suppression.
  const expiryKey = (() => {
    const expiry = userProfile?.subscriptionExpiry
    if (!expiry) return ''
    return typeof expiry?.toDate === 'function'
      ? expiry.toDate().toISOString()
      : String(expiry)
  })()

  useEffect(() => {
    if (!expiryKey) return
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === expiryKey)
    } catch {
      setDismissed(false)
    }
  }, [expiryKey])

  if (daysLeft == null) return null
  if (daysLeft > NUDGE_WINDOW_DAYS) return null
  if (daysLeft <= 0) return null
  if (dismissed) return null

  const t = tone(daysLeft)
  const planName = currentPlan?.name || 'Your subscription'
  const priceLabel = currentPlan ? `K${currentPlan.priceZMW}` : ''

  function handleDismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, expiryKey) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className={`border-2 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3 flex-wrap ${t.bg}`}>
      <span className="text-2xl" aria-hidden="true">{t.icon}</span>
      <div className="flex-1 min-w-[180px]">
        <p className="font-black text-gray-800 text-sm">
          {planName} {t.verb}
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          Top up {priceLabel} via Mobile Money to keep your access — no break in service.
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Button variant="primary" size="sm" onClick={onRenewClick}>
          {t.btn}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          Later
        </Button>
      </div>
    </div>
  )
}
