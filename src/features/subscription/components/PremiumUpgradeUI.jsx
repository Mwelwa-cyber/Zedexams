// Shared building blocks for the three learner premium popups (Feature Locked,
// Quiz Limit Reached, Welcome Back). Each popup has a distinct hero + purpose,
// but they share the benefit pills, the Weekly/Monthly pricing cards and the
// "Most Popular" ribbon so pricing can never drift between them — it all reads
// from src/engines/payment-engine/subscriptionConfig.js (PLANS).
//
// Deliberately uses a fixed light "premium purple" palette (Tailwind literal
// colours, not theme-* tokens) rather than following the learner theme — the
// same approach PaywallHost takes. Upgrade modals read as a branded moment and
// stay legible whatever theme the learner has picked.

import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import Icon from '../../../shared/components/Icon'
import { Check, Lock, RefreshCw } from '../../../shared/components/icons'

// Colour-coded benefit pills. The spec calls these out as "much easier to read
// on phones" than a plain icon row.
export const LEARNER_PILLS = [
  { emoji: '📚', label: 'Unlimited Practice', tint: 'purple' },
  { emoji: '📄', label: 'Full Past Papers', tint: 'green' },
  { emoji: '🤖', label: 'AI Learning Tools', tint: 'indigo' },
  { emoji: '📈', label: 'Track Your Progress', tint: 'blue' },
  { emoji: '🏆', label: 'Compete on Leaderboards', tint: 'orange' },
]

export const TEACHER_PILLS = [
  { emoji: '📝', label: 'AI Lesson Plans', tint: 'purple' },
  { emoji: '📄', label: 'Assessments & Papers', tint: 'green' },
  { emoji: '🤖', label: 'Every Studio Tool', tint: 'indigo' },
  { emoji: '⬇️', label: 'DOCX & PDF Export', tint: 'blue' },
]

const TINT = {
  purple: 'bg-purple-100 text-purple-700',
  green: 'bg-green-100 text-green-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  blue: 'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
}

export function BenefitPills({ items }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${TINT[it.tint] || TINT.purple}`}
        >
          <span aria-hidden="true">{it.emoji}</span>
          {it.label}
        </span>
      ))}
    </div>
  )
}

// Simple checkmark list (the "✓ AI-powered tools" style used on the Feature
// Locked and Quiz Limit popups).
export function BenefitChecklist({ items, className = '' }) {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {items.map((b) => (
        <li key={b} className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
            <Icon as={Check} size="xs" strokeWidth={3} />
          </span>
          {b}
        </li>
      ))}
    </ul>
  )
}

function unitLabel(plan) {
  if (plan.durationDays === 7 || plan.billing === 'weekly') return '/week'
  if (plan.durationDays === 30 || plan.billing === 'monthly') return '/month'
  if (plan.billing === 'yearly') return '/year'
  if (plan.durationDays) return `/${plan.durationDays}d`
  return ''
}

// Human "Billed weekly / monthly / yearly" cadence for the pricing-card
// subline.
function billedLabel(plan) {
  if (plan.durationDays === 7 || plan.billing === 'weekly') return 'Billed weekly'
  if (plan.durationDays === 30 || plan.billing === 'monthly') return 'Billed monthly'
  if (plan.billing === 'yearly') return 'Billed yearly'
  if (plan.durationDays) return `Every ${plan.durationDays} days`
  return ''
}

// Whole-kwacha saving from paying monthly instead of four weekly renewals —
// only meaningful for the learner weekly+monthly pair, so we compute it lazily
// and return null for any other combination.
function monthlySaving(ids) {
  const weekly = PLANS.weekly
  const monthly = PLANS.monthly
  if (!ids.includes('weekly') || !ids.includes('monthly') || !weekly || !monthly) return null
  const saving = weekly.priceZMW * 4 - monthly.priceZMW
  return saving > 0 ? saving : null
}

/**
 * Weekly / Monthly pricing cards with a "⭐ Most Popular" ribbon on the
 * recommended plan. Clicking a card selects it (so the checkout opens on that
 * plan). On native (Android) the ZMW price literals are hidden — Google Play
 * shows its own localised price and Play policy forbids alternative pricing.
 */
export function PlanPricingCards({
  planIds = ['weekly', 'monthly'],
  popularPlanId = 'monthly',
  selectedPlanId,
  onSelect,
  hidePrices = false,
}) {
  const ids = planIds.filter((id) => PLANS[id])
  const saving = hidePrices ? null : monthlySaving(ids)
  return (
    <div className="grid grid-cols-2 gap-2 pt-1.5">
      {ids.map((id) => {
        const plan = PLANS[id]
        const popular = id === popularPlanId
        const active = selectedPlanId === id
        const showSaving = saving && id === 'monthly'
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect?.(id)}
            aria-pressed={active}
            className={`relative rounded-xl border-2 p-2.5 text-left transition-all duration-150 ${
              active
                ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200'
                : popular
                  ? 'border-purple-300 bg-white hover:border-purple-400 hover:-translate-y-0.5'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:-translate-y-0.5'
            }`}
          >
            {popular && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow-sm">
                ⭐ Most Popular
              </span>
            )}
            {active && (
              <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-white">
                <Icon as={Check} size="xs" strokeWidth={3.2} />
              </span>
            )}
            <p className="text-[10px] font-black uppercase tracking-wide text-gray-500">{plan.name}</p>
            {hidePrices ? (
              <p className="mt-0.5 text-base font-black text-gray-900">Premium</p>
            ) : (
              <p className="mt-0.5 leading-none">
                <span className="text-xl font-black text-gray-900">K{plan.priceZMW}</span>
                <span className="text-[11px] font-bold text-gray-400"> {unitLabel(plan)}</span>
              </p>
            )}
            {showSaving ? (
              <p className="mt-1 text-[10px] font-bold text-green-600">Save K{saving} vs weekly</p>
            ) : (
              !hidePrices && <p className="mt-1 text-[10px] font-medium text-gray-400">{billedLabel(plan)}</p>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Compact trust strip — small icons under the CTA. Mirrors the reference
// mock's "Secure payments · Cancel anytime" reassurance without adding height.
export function TrustRow({ native = false }) {
  return (
    <div className="mt-2.5 flex items-center justify-center gap-3 text-[10.5px] font-semibold text-gray-400">
      <span className="inline-flex items-center gap-1">
        <Icon as={Lock} size="xs" strokeWidth={2.2} className="text-gray-400" />
        Secure payment
      </span>
      <span className="h-2.5 w-px bg-gray-200" aria-hidden="true" />
      <span className="inline-flex items-center gap-1">
        <Icon as={RefreshCw} size="xs" strokeWidth={2.2} className="text-gray-400" />
        Cancel anytime
      </span>
      {!native && (
        <>
          <span className="h-2.5 w-px bg-gray-200" aria-hidden="true" />
          <span>MTN · Airtel · Zamtel</span>
        </>
      )}
    </div>
  )
}
