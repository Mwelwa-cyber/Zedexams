import { lazy, Suspense, useEffect, useState } from 'react'
import { lockedFeature } from '../../utils/lockedFeature'
import { isNativePlatform } from '../../utils/runtime'
import { useAuth } from '../../contexts/AuthContext'
import {
  audienceForProfile,
  resolveSubscriptionStatus,
  upgradePortal,
} from '../../utils/subscriptionStatus'
import { capture } from '../../utils/analytics'
import Icon from '../ui/Icon'
import { ArrowRight, Lock, X } from '../ui/icons'
import {
  BenefitChecklist,
  LEARNER_PILLS,
  PlanPricingCards,
  TEACHER_PILLS,
} from './PremiumUpgradeUI'

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

  // Body scroll-lock + Esc to close while open.
  useEffect(() => {
    if (!state) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') lockedFeature.hide() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [state])

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
  const pills = isTeacher ? TEACHER_PILLS : LEARNER_PILLS
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
      <div className="relative w-full max-w-md animate-scale-in overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <button
          type="button"
          onClick={() => lockedFeature.hide()}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/5 p-0 text-gray-500 shadow-none hover:bg-black/10 hover:text-gray-700"
        >
          <Icon as={X} size="md" />
        </button>

        {/* Hero */}
        <div className="bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-600 px-6 pt-8 pb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Icon as={Lock} size="xl" strokeWidth={2.1} />
          </div>
          <h2 id="locked-feature-title" className="text-2xl font-black leading-tight">
            🔒 This is a Premium Feature
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-white/90">
            {featureName
              ? `${featureName} is part of Premium. Upgrade and unlock unlimited access to powerful AI learning tools.`
              : 'Upgrade to Premium and unlock unlimited access to powerful AI learning tools.'}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <BenefitChecklist items={benefits} className="mb-5" />

          <div className="mb-2 flex flex-wrap justify-center gap-1.5">
            {pills.slice(0, 4).map((p) => (
              <span key={p.label} className="text-xs" aria-hidden="true">{p.emoji}</span>
            ))}
          </div>

          <PlanPricingCards
            planIds={pricingPlanIds}
            popularPlanId={popularPlanId}
            onSelect={openUpgrade}
            hidePrices={native}
          />

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => openUpgrade(null)}
              className="animate-premium-glow flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3.5 text-base font-black text-white transition-transform hover:scale-[1.02]"
            >
              🚀 Upgrade to Premium
              <Icon as={ArrowRight} size="sm" />
            </button>
            <button
              type="button"
              onClick={() => lockedFeature.hide()}
              className="w-full rounded-2xl bg-transparent px-4 py-2.5 text-sm font-bold text-gray-500 shadow-none hover:text-gray-700"
            >
              Maybe Later
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-gray-400">
            {native
              ? 'Billed securely through Google Play · Cancel anytime'
              : 'Pay with MTN, Airtel or Zamtel · Cancel anytime'}
          </p>
        </div>
      </div>
    </div>
  )
}
