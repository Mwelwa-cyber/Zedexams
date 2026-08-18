import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { mayShowPrice } from '../../../services/entitlements/planState'
import { reminderCopy } from '../../../engines/payment-engine/subscriptionStatus'
import Icon from '../../../shared/components/Icon'
import { ArrowRight } from '../../../shared/components/icons'

/**
 * Slim subscription card for Free and Expired learners — the compact
 * replacement for the old large promotional benefits banner, mirroring the
 * teacher dashboard's PlanQuickCard. Shows the current plan on the left and a
 * single Upgrade/Renew action on the right, routing to My Subscription.
 * Renders nothing for Pro / Trial users, so paying removes it automatically.
 *
 * An under-18 learner never reaches a price through this card: the same
 * rule as SubscriptionStatusBanner, and for the same reasons. It keeps its
 * place on the dashboard — the offer is real and the child is the one who
 * wants it — but the action goes to /ask-a-grown-up rather than to the
 * plan page.
 *
 * @param {'learner'|'teacher'} props.audience surface the card lives on
 */
export default function SubscriptionReminderCard({ audience }) {
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const { shouldRemind, status } = useSubscriptionReminder({ audience })

  if (!shouldRemind) return null

  const showPrice = mayShowPrice(userProfile)
  const copy = reminderCopy(status, audience)
  const expired = copy.tone === 'expired'
  const planLabel = showPrice ? (expired ? 'Expired' : 'Free Plan') : 'Locked'
  const cta = showPrice ? copy.cta : 'Ask a grown-up'

  function act() {
    navigate(showPrice ? '/my-subscription' : '/ask-a-grown-up')
  }

  return (
    <section
      className={`zx-card flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm ${
        expired ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <span
        className={`inline-flex items-center gap-2 text-sm font-black ${
          expired ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        <span aria-hidden="true">{expired ? '⏳' : '⭐'}</span>
        {planLabel}
      </span>
      <button
        type="button"
        onClick={act}
        className={`inline-flex items-center gap-1 bg-transparent text-sm font-black shadow-none min-h-0 ${
          expired
            ? 'text-red-700 hover:text-red-900'
            : 'text-amber-700 hover:text-amber-900'
        }`}
      >
        {cta}
        <Icon as={ArrowRight} size="xs" />
      </button>
    </section>
  )
}
