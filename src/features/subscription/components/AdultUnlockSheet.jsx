/**
 * AdultUnlockSheet — the adult variant of the contextual unlock sheet.
 *
 * The gate's own words at the top (so the offer names what the user was
 * actually reaching for), the four-rung plan ladder, and one button into the
 * existing Lenco checkout. A generic "Upgrade to Premium" sheet can only argue
 * generically; this one can say "Save 2025 ECZ · English Paper 1 to your
 * phone", which is the entire reason a contextual sheet beats an interstitial.
 *
 * The ladder comes from `config/plans` — data, not JSX — and the saving line
 * is computed by `savingLabel` rather than typed, so the printed figure cannot
 * contradict the printed prices beside it.
 *
 * Reached only from `useUnlockFlow`, which routes anyone who is not positively
 * an adult to `GuardianAskSheet` instead. This component never checks age
 * itself: two places deciding the same thing is how one of them ends up wrong.
 */

import { lazy, Suspense, useState } from 'react'
import Icon from '../../../shared/components/Icon'
import { X } from '../../../shared/components/icons'
import {
  DEFAULT_HIGHLIGHT_PLAN_ID,
  availablePlans,
  formatKwacha,
  getPlan,
  savingLabel,
} from '../../../config/plans'
import { resolveGateCopy } from '../../../services/entitlements'
import { isNativePlatform } from '../../../utils/runtime'
import { capture } from '../../../utils/analytics'

const UpgradeModal = lazy(() => import('./UpgradeModal'))

export default function AdultUnlockSheet({ gate, context = {}, onClose }) {
  const copy = resolveGateCopy(gate, context)
  const plans = availablePlans()
  const [selectedId, setSelectedId] = useState(
    plans.some((p) => p.id === DEFAULT_HIGHLIGHT_PLAN_ID) ? DEFAULT_HIGHLIGHT_PLAN_ID : plans[0]?.id,
  )
  const [checkingOut, setCheckingOut] = useState(false)

  const selected = getPlan(selectedId)
  // On Android the purchase must go through Google Play Billing, which owns
  // the price display. Showing our own Kwacha figures there would put two
  // prices on one screen and breach Play's payments policy.
  const native = isNativePlatform()

  function handlePay() {
    capture('plan_selected', { plan: selectedId, surface: 'contextual-sheet' })
    capture('payment_started', { plan: selectedId, provider: 'lenco' })
    setCheckingOut(true)
  }

  if (checkingOut && selected) {
    return (
      <Suspense fallback={null}>
        <UpgradeModal
          portal="learner"
          planIds={plans.map((p) => p.checkoutPlanId)}
          defaultPlanId={selected.checkoutPlanId}
          onClose={() => { setCheckingOut(false); onClose?.() }}
        />
      </Suspense>
    )
  }

  return (
    <div className="relative rounded-t-2xl theme-card px-5 pb-5 pt-4 sm:rounded-2xl">
      <span className="mx-auto mb-3 block h-1 w-9 rounded-full theme-bg-subtle" aria-hidden="true" />
      {/* A real ✕, same visual weight as the CTA, present from the first frame. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full theme-bg-subtle theme-text-muted shadow-none"
      >
        <Icon as={X} size="sm" />
      </button>

      <span className="mb-3 grid h-10 w-10 place-items-center rounded-2xl border border-indigo-200 bg-indigo-50 text-xl dark:border-indigo-400/30 dark:bg-indigo-500/15" aria-hidden="true">
        {copy?.icon || '🔒'}
      </span>

      <h2 className="pr-8 text-base font-black leading-tight theme-text">{copy?.title}</h2>
      {copy?.body && (
        <p className="mt-1 text-[12px] leading-relaxed theme-text-muted">{copy.body}</p>
      )}

      {!native && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {plans.map((plan) => {
            const active = plan.id === selectedId
            const saving = savingLabel(plan)
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedId(plan.id)}
                className={`relative rounded-xl border-2 px-2 py-2.5 text-center shadow-none ${
                  active
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15'
                    : 'theme-border theme-card'
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-600 px-2 py-0.5 text-[8px] font-black tracking-wider text-white">
                    {plan.badge}
                  </span>
                )}
                <span className="block text-[9px] font-black uppercase tracking-wider theme-text-muted">
                  {plan.label}
                </span>
                <span className="block font-display text-base font-black theme-text">
                  {formatKwacha(plan.price)}
                </span>
                <span className="block text-[9px] theme-text-muted">{plan.period}</span>
                {saving && (
                  <span className="mt-0.5 block text-[9px] font-black text-emerald-600 dark:text-emerald-300">
                    {saving}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={handlePay}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-teal-600 to-emerald-500 px-4 py-3 text-sm font-black text-white"
      >
        {native ? 'See plans' : 'Pay with MTN / Airtel'}
      </button>

      <button
        type="button"
        onClick={onClose}
        className="w-full bg-transparent px-4 py-2 text-[12px] font-bold theme-text-muted shadow-none"
      >
        Not now
      </button>

      {!native && (
        <p className="mt-1 text-center text-[10px] theme-text-muted opacity-80">
          Secure payment via Lenco · Cancel anytime
        </p>
      )}
    </div>
  )
}
