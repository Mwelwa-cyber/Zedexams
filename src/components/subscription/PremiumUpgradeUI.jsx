// Shared building blocks for the three learner premium popups (Feature Locked,
// Quiz Limit Reached, Welcome Back). Each popup has a distinct hero + purpose,
// but they share the benefit pills, the Weekly/Monthly pricing cards and the
// "Most Popular" ribbon so pricing can never drift between them — it all reads
// from src/utils/subscriptionConfig.js (PLANS).
//
// Deliberately uses a fixed light "premium purple" palette (Tailwind literal
// colours, not theme-* tokens) rather than following the learner theme — the
// same approach PaywallHost takes. Upgrade modals read as a branded moment and
// stay legible whatever theme the learner has picked.

import { PLANS } from '../../utils/subscriptionConfig'
import Icon from '../ui/Icon'
import { Check } from '../ui/icons'

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
    <div className="flex flex-wrap justify-center gap-2">
      {items.map((it) => (
        <span
          key={it.label}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${TINT[it.tint] || TINT.purple}`}
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
    <ul className={`space-y-2 ${className}`}>
      {items.map((b) => (
        <li key={b} className="flex items-center gap-2.5 text-sm font-semibold text-gray-700">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
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
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {ids.map((id) => {
        const plan = PLANS[id]
        const popular = id === popularPlanId
        const active = selectedPlanId === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect?.(id)}
            aria-pressed={active}
            className={`relative rounded-2xl border-2 p-3.5 text-left transition-all ${
              active
                ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200'
                : popular
                  ? 'border-purple-300 bg-white hover:border-purple-400'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            {popular && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-sm">
                ⭐ Most Popular
              </span>
            )}
            <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">{plan.name}</p>
            {hidePrices ? (
              <p className="mt-1 text-lg font-black text-gray-900">Premium</p>
            ) : (
              <p className="mt-0.5 leading-none">
                <span className="text-2xl font-black text-gray-900">K{plan.priceZMW}</span>
                <span className="text-xs font-bold text-gray-400"> {unitLabel(plan)}</span>
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
