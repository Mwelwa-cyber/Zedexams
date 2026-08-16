import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { lockedFeature } from '../lib/lockedFeature'
import useFocusTrap from '../../../hooks/useFocusTrap'
import { isNativePlatform } from '../../../utils/runtime'
import { useAuth } from '../../../contexts/AuthContext'
import {
  audienceForProfile,
  resolveSubscriptionStatus,
  upgradePortal,
} from '../../../engines/payment-engine/subscriptionStatus'
import { capture } from '../../../utils/analytics'
import Icon from '../../../shared/components/Icon'
import { ArrowRight, Lock, X } from '../../../shared/components/icons'
import { BenefitChecklist, PlanPricingCards, TrustRow } from './PremiumUpgradeUI'

const UpgradeModal = lazy(() => import('./UpgradeModal'))

// Benefit checklist per audience — the "✓ AI-powered tools" strip on the
// Feature Locked popup.
const LEARNER_BENEFITS = [
  'AI-powered learning tools',
  'Unlimited quizzes',
  'Full Past Papers',
  'Notes Library',
  'Progress Tracking',
]
const TEACHER_BENEFITS = [
  'AI lesson plans & schemes',
  'Assessments & exam papers',
  'Every teacher studio tool',
  'DOCX & PDF export',
]

/**
 * Popup #1 — "Feature Locked". Shown the moment a Free / Expired user taps a
 * Premium feature (Exam mode, Weakness analysis, a locked studio, …). Driven by
 * the lockedFeature singleton bus so any component can trigger it with
 * lockedFeature.show({ feature, audience }).
 *
 * Mounted once at the app root. Self-hides for users who already have access so
 * a stray trigger never nags a paying member.
 */
export default function LockedFeatureModal() {
  const { userProfile } = useAuth()
  const [state, setState] = useState(null)
  // Preselected plan for the checkout; null falls back to the popular default.
  const [upgradePlanId, setUpgradePlanId] = useState(null)

  useEffect(() => lockedFeature.subscribe(setState), [])

  // Body scroll-lock while open. Escape / focus-in / Tab-trap / focus-restore
  // live in useFocusTrap so keyboard users can't tab into the page behind.
  useEffect(() => {
    if (!state) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [state])

  const panelRef = useRef(null)
  useFocusTrap(panelRef, {
    active: !!state && !upgradePlanId,
    onEscape: () => lockedFeature.hide(),
  })

  if (!state) return null

  // The upgrade step reuses `state`: once a plan is chosen we stash it in
  // upgradePlanId and swap the popup for <UpgradeModal>.
  const audience = state.audience || audienceForProfile(userProfile)
  // If the user actually has access (Pro / Trial / admin), never block them —
  // close silently. Guards against a stale trigger after an upgrade.
  const { shouldRemind } = resolveSubscriptionStatus(userProfile, { audience })
  if (!shouldRemind) return null

  const isTeacher = audience === 'teacher'
  const native = isNativePlatform()
  const portal = upgradePortal(audience)
  const pricingPlanIds = isTeacher ? ['pro_monthly', 'max_monthly'] : ['weekly', 'monthly']
  const popularPlanId = isTeacher ? 'pro_monthly' : 'monthly'
  const benefits = isTeacher ? TEACHER_BENEFITS : LEARNER_BENEFITS
  const featureName = state.feature || null

  function openUpgrade(planId) {
    capture('paywall_upgrade_clicked', {
      reason: 'feature-locked',
      feature: featureName,
      plan_target: audience,
      via: planId ? 'plan-card' : 'primary',
    })
    setUpgradePlanId(planId || popularPlanId)
  }

  // ── Upgrade checkout ────────────────────────────────────────────────────
  if (upgradePlanId) {
    return (
      <Suspense fallback={null}>
        <UpgradeModal
          portal={portal.portal}
          planIds={portal.planIds}
          defaultPlanId={upgradePlanId}
          onClose={() => { setUpgradePlanId(null); lockedFeature.hide() }}
        />
      </Suspense>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="locked-feature-title"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => lockedFeature.hide()}
        aria-hidden="true"
      />
      <div ref={panelRef} className="relative w-full max-w-xs animate-scale-in overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={() => lockedFeature.hide()}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 p-0 text-white shadow-none hover:bg-white/30"
        >
          <Icon as={X} size="sm" />
        </button>

        {/* Hero */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-600 px-5 pt-5 pb-4 text-center text-white">
          <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-xl" aria-hidden="true" />
          <span className="pointer-events-none absolute left-4 top-3 text-sm text-white/40" aria-hidden="true">✦</span>
          <span className="pointer-events-none absolute right-5 bottom-4 text-xs text-white/30" aria-hidden="true">✦</span>
          <div className="relative mx-auto mb-2 flex h-11 w-11 animate-float items-center justify-center rounded-xl bg-white/15 shadow-lg shadow-black/10 backdrop-blur">
            <Icon as={Lock} size="md" strokeWidth={2.1} />
          </div>
          <h2 id="locked-feature-title" className="relative text-lg font-black leading-tight tracking-tight">
            🔒 Premium Feature
          </h2>
          <p className="relative mx-auto mt-1 max-w-[15rem] text-xs font-medium text-white/85">
            {featureName
              ? `${featureName} is part of Premium — unlock unlimited AI learning tools.`
              : 'Unlock unlimited access to powerful AI learning tools.'}
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <BenefitChecklist items={benefits} className="mb-3.5" />

          <PlanPricingCards
            planIds={pricingPlanIds}
            popularPlanId={popularPlanId}
            selectedPlanId={popularPlanId}
            onSelect={openUpgrade}
            hidePrices={native}
          />

          <div className="mt-4 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => openUpgrade(null)}
              className="animate-premium-glow flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-transform hover:scale-[1.02] active:scale-95"
            >
              🚀 Upgrade to Premium
              <Icon as={ArrowRight} size="xs" />
            </button>
            <button
              type="button"
              onClick={() => lockedFeature.hide()}
              className="w-full rounded-xl bg-transparent px-4 py-1.5 text-[13px] font-bold text-gray-500 shadow-none hover:text-gray-700"
            >
              Maybe Later
            </button>
          </div>
          <TrustRow native={native} />
        </div>
      </div>
    </div>
  )
}
