import { lazy, Suspense, useEffect, useState } from 'react'
import { paywall } from '../../utils/paywall'
import { isNativePlatform } from '../../utils/runtime'
import { capture } from '../../utils/analytics'
import Icon from '../ui/Icon'
import { ArrowRight, X } from '../ui/icons'
import { BenefitChecklist, PlanPricingCards } from './PremiumUpgradeUI'

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
    <div className="relative mx-auto h-28 w-28">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={0}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-2xl font-black text-white">{count}/{total}</span>
        <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/80">Free</span>
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

  // Body scroll-lock + Esc + one analytics event per show.
  useEffect(() => {
    if (!open) return undefined
    capture('paywall_shown', { reason: REASON, feature: 'past-paper-quiz', plan_target: 'learner' })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') paywall.hide() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
      <div className="relative w-full max-w-md animate-scale-in overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <button
          type="button"
          onClick={() => paywall.hide()}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 p-0 text-white shadow-none hover:bg-white/30"
        >
          <Icon as={X} size="md" />
        </button>

        {/* Hero — celebrate first */}
        <div className="bg-gradient-to-br from-emerald-500 via-teal-500 to-green-600 px-6 pt-8 pb-6 text-center text-white">
          <h2 id="quiz-limit-title" className="text-2xl font-black leading-tight">🎉 Great Job!</h2>
          <p className="mx-auto mt-1.5 mb-4 max-w-xs text-sm font-medium text-white/90">
            You&apos;ve completed your {limit} FREE quiz questions
            {ctx.paperTitle ? ` on ${ctx.paperTitle}` : ''}. Unlock Premium to keep practising with
            thousands of questions and full past papers.
          </p>
          <ProgressRing count={limit} total={limit} />
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <BenefitChecklist items={QUIZ_BENEFITS} className="mb-5" />

          <PlanPricingCards
            planIds={['weekly', 'monthly']}
            popularPlanId="monthly"
            onSelect={openUpgrade}
            hidePrices={native}
          />

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => openUpgrade(null)}
              className="animate-premium-glow flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3.5 text-base font-black text-white transition-transform hover:scale-[1.02]"
            >
              Continue Learning
              <Icon as={ArrowRight} size="sm" />
            </button>
            <button
              type="button"
              onClick={() => paywall.hide()}
              className="w-full rounded-2xl bg-transparent px-4 py-2.5 text-sm font-bold text-gray-500 shadow-none hover:text-gray-700"
            >
              Not Now
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
