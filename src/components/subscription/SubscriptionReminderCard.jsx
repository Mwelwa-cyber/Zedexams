import { useNavigate } from 'react-router-dom'
import { useSubscriptionReminder } from '../../hooks/useSubscriptionReminder'
import { reminderCopy } from '../../utils/subscriptionStatus'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Sparkles, CheckCircleIcon, Lock } from '../ui/icons'

/**
 * Dashboard reminder card for Free and Expired users. Lists the audience's Pro
 * benefits and routes to the My Subscription page to upgrade/renew. Renders
 * nothing for Pro / Trial users, so paying removes it automatically.
 *
 * @param {'learner'|'teacher'} props.audience surface the card lives on
 */
export default function SubscriptionReminderCard({ audience }) {
  const navigate = useNavigate()
  const { shouldRemind, status, benefits } = useSubscriptionReminder({ audience })

  if (!shouldRemind) return null

  const copy = reminderCopy(status, audience)
  const expired = copy.tone === 'expired'

  return (
    <section
      className={`zx-card overflow-hidden rounded-3xl border-2 shadow-sm ${
        expired ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white ${
              expired ? 'bg-red-500' : 'bg-amber-500'
            }`}
          >
            <Icon as={expired ? Lock : Sparkles} size="lg" strokeWidth={2.1} />
          </div>
          <div className="min-w-0 flex-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${
                expired ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {copy.badge}
            </span>
            <h3 className="mt-1.5 text-base font-black leading-tight text-slate-900">
              {copy.title}
            </h3>
            <p className="mt-1 text-sm font-bold leading-snug text-slate-600">
              {copy.body}
            </p>
          </div>
        </div>

        <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-1.5 text-[13px] font-bold text-slate-700">
              <Icon
                as={CheckCircleIcon}
                size="sm"
                strokeWidth={2.1}
                className="mt-0.5 flex-shrink-0 text-green-500"
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="md" onClick={() => navigate('/my-subscription')}>
            {copy.cta}
          </Button>
          <button
            type="button"
            onClick={() => navigate('/my-subscription')}
            className="bg-transparent text-sm font-black text-slate-500 underline shadow-none min-h-0 hover:text-slate-700"
          >
            See plans &amp; benefits
          </button>
        </div>
      </div>
    </section>
  )
}
