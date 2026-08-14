import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { paywall } from '../../../utils/paywall'
import useFocusTrap from '../../../hooks/useFocusTrap'
import { isNativePlatform } from '../../../utils/runtime'
import { capture } from '../../../utils/analytics'
import Icon from '../../../components/ui/Icon'
import { ArrowRight, X } from '../../../components/ui/icons'
import { BenefitChecklist, PlanPricingCards, TrustRow } from './PremiumUpgradeUI'

const UpgradeModal = lazy(() => import('./UpgradeModal'))

// The reason this popup owns on the shared paywall bus. PublicQuizRunner fires
// paywall.show('quiz-preview-limit', …) when a free learner finishes their free
// past-paper questions; this popup renders instead of the teacher-styled
// PaywallHost (which no longer handles this reason).
const REASON = 'quiz-preview-limit'

const QUIZ_BENEFITS = [
  'Unlimited Past Paper Quizzes',
  'Instant Marking',
  'Answer Explanations',
  'Leaderboards',
  'Progress Tracking',
]

// Full progress ring — the learner has completed 100% of the free quota, so we
// celebrate a full circle rather than a "you're blocked" bar.
function ProgressRing({ count, total }) {
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <div className="relative mx-auto h-[76px] w-[76px]">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={0}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-base font-black text-white">{count}/{total}</span>
        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-white/80">Free</span>
      </div>
    </div>
  )
}

/**
 * Popup #2 — "Quiz Limit Reached". Congratulates the learner for finishing the
 * free past-paper quota first, then invites them to keep going on Premium.
 * Driven by the shared paywall bus (reason: 'quiz-preview-limit').
 */
export default function QuizLimitPopup() {
  const [state, setState] = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradePlanId, setUpgradePlanId] = useState('monthly')

  useEffect(() => paywall.subscribe(setState), [])

  const open = !!state && state.reason === REASON
  const ctx = state?.ctx || {}
  const limit = ctx.limit || 30

  // Body scroll-lock + one analytics event per show. Escape / focus-in /
  // Tab-trap / focus-restore live in useFocusTrap so keyboard users can't tab
  // into the page behind the backdrop.
  useEffect(() => {
    if (!open) return undefined
    capture('paywall_shown', { reason: REASON, feature: 'past-paper-quiz', plan_target: 'learner' })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const panelRef = useRef(null)
  useFocusTrap(panelRef, {
    active: open && !showUpgrade,
    onEscape: () => paywall.hide(),
  })

  if (!open) return null
  const native = isNativePlatform()

  function openUpgrade(planId) {
    capture('paywall_upgrade_clicked', {
      reason: REASON,
      feature: 'past-paper-quiz',
      plan_target: 'learner',
      via: planId ? 'plan-card' : 'primary',
    })
    setUpgradePlanId(planId || 'monthly')
    setShowUpgrade(true)
  }

  if (showUpgrade) {
    return (
      <Suspense fallback={null}>
        <UpgradeModal
          portal="learner"
          planIds={['weekly', 'monthly']}
          defaultPlanId={upgradePlanId}
          onClose={() => { setShowUpgrade(false); paywall.hide() }}
        />
      </Suspense>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-limit-title"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => paywall.hide()}
        aria-hidden="true"
      />
      <div ref={panelRef} className="relative w-full max-w-xs animate-scale-in overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={() => paywall.hide()}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 p-0 text-white shadow-none hover:bg-white/30"
        >
          <Icon as={X} size="sm" />
        </button>

        {/* Hero — celebrate first */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 via-teal-500 to-green-600 px-5 pt-5 pb-4 text-center text-white">
          <span className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-xl" aria-hidden="true" />
          <span className="pointer-events-none absolute left-5 top-4 text-sm text-white/40" aria-hidden="true">✦</span>
          <span className="pointer-events-none absolute right-6 top-8 text-xs text-white/30" aria-hidden="true">✦</span>
          <h2 id="quiz-limit-title" className="relative text-lg font-black leading-tight tracking-tight">🎉 Great Job!</h2>
          <p className="relative mx-auto mt-1 mb-3 max-w-[16rem] text-xs font-medium text-white/85">
            You&apos;ve finished your {limit} FREE questions
            {ctx.paperTitle ? ` on ${ctx.paperTitle}` : ''}. Unlock Premium to keep practising.
          </p>
          <div className="relative"><ProgressRing count={limit} total={limit} /></div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <BenefitChecklist items={QUIZ_BENEFITS} className="mb-3.5" />

          <PlanPricingCards
            planIds={['weekly', 'monthly']}
            popularPlanId="monthly"
            selectedPlanId="monthly"
            onSelect={openUpgrade}
            hidePrices={native}
          />

          <div className="mt-4 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => openUpgrade(null)}
              className="animate-premium-glow flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-transform hover:scale-[1.02] active:scale-95"
            >
              Continue Learning
              <Icon as={ArrowRight} size="xs" />
            </button>
            <button
              type="button"
              onClick={() => paywall.hide()}
              className="w-full rounded-xl bg-transparent px-4 py-1.5 text-[13px] font-bold text-gray-500 shadow-none hover:text-gray-700"
            >
              Not Now
            </button>
          </div>
          <TrustRow native={native} />
        </div>
      </div>
    </div>
  )
}
