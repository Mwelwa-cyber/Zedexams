import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import useFocusTrap from '../../../hooks/useFocusTrap'
import { upgradePortal } from '../../../engines/payment-engine/subscriptionStatus'
import { isReminderSuppressedPath } from '../lib/reminderVisibility'
import { isNativePlatform } from '../../../utils/runtime'
import { paywall } from '../../../engines/payment-engine/paywall'
import { lockedFeature } from '../lib/lockedFeature'
import { capture } from '../../../utils/analytics'
import Icon from '../../../shared/components/Icon'
import { ArrowRight, X } from '../../../shared/components/icons'
import {
  BenefitPills,
  LEARNER_PILLS,
  PlanPricingCards,
  TEACHER_PILLS,
  TrustRow,
} from './PremiumUpgradeUI'

const UpgradeModal = lazy(() => import('./UpgradeModal'))

// In-session guard: once the popup has appeared this visit it never reopens,
// even before the Firestore snooze write lands. The Firestore
// reminderDismissedUntil field carries the "every 2–3 days" promise across
// sessions and devices.
const SESSION_SHOWN_KEY = 'zedexams.subReminderPopup.shown'

function shownThisSession() {
  try { return sessionStorage.getItem(SESSION_SHOWN_KEY) === '1' } catch { return false }
}
function markShownThisSession() {
  try { sessionStorage.setItem(SESSION_SHOWN_KEY, '1') } catch { /* ignore */ }
}

/**
 * Popup #3 — "Welcome Back". A gentle upgrade nudge shown to Free (and Expired)
 * users after they log in, capped to once every 2–3 days by the Firestore
 * snooze in useSubscriptionReminder. Pro / Trial users never see it, so
 * upgrading removes it automatically.
 */
export default function SubscriptionReminderPopup() {
  const { userProfile } = useAuth()
  const { pathname } = useLocation()
  const {
    status, audience, popupEligible,
    snoozeReminders, recordReminderShown,
  } = useSubscriptionReminder()

  const [open, setOpen] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradePlanId, setUpgradePlanId] = useState(null)

  useEffect(() => {
    if (open) return undefined
    if (!userProfile) return undefined
    if (!popupEligible) return undefined
    if (shownThisSession()) return undefined
    if (isReminderSuppressedPath(pathname)) return undefined

    // Small delay so the popup lands after the dashboard paints rather than
    // racing the first frame.
    const t = setTimeout(() => {
      if (shownThisSession()) return
      // One upgrade modal at a time: if the learner already has a paywall or
      // locked-feature modal on screen, stay quiet. Not marked as shown, so a
      // later navigation gets another chance once the other modal is gone.
      if (paywall.isActive() || lockedFeature.isActive()) return
      markShownThisSession()
      setOpen(true)
      recordReminderShown()
      capture('paywall_shown', { reason: 'welcome-back', plan_target: audience })
    }, 900)
    return () => clearTimeout(t)
    // recordReminderShown is intentionally omitted: it derives from a
    // non-memoized context fn (new identity each render), and including it
    // would reset the 900ms timer on every parent re-render. It's only
    // called once behind the shownThisSession guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userProfile, popupEligible, pathname])

  // Scroll lock while open. Escape / focus-in / Tab-trap / focus-restore all
  // live in useFocusTrap below so keyboard and screen-reader users aren't left
  // tabbing through the page behind the backdrop.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const panelRef = useRef(null)
  useFocusTrap(panelRef, {
    active: open && !showUpgrade,
    onEscape: handleDismiss,
  })

  if (!open) return null

  const expired = status === 'expired'
  const isTeacher = audience === 'teacher'
  const native = isNativePlatform()
  const portal = upgradePortal(audience)
  const pills = isTeacher ? TEACHER_PILLS : LEARNER_PILLS
  const pricingPlanIds = isTeacher ? ['pro_monthly', 'max_monthly'] : ['weekly', 'monthly']
  const popularPlanId = isTeacher ? 'pro_monthly' : 'monthly'

  function handleDismiss() {
    setOpen(false)
    snoozeReminders()
  }

  function handleUpgrade(planId) {
    capture('paywall_upgrade_clicked', {
      reason: 'welcome-back',
      plan_target: audience,
      via: planId ? 'plan-card' : 'primary',
    })
    snoozeReminders()
    setUpgradePlanId(planId || popularPlanId)
    setShowUpgrade(true)
  }

  if (showUpgrade) {
    return (
      <Suspense fallback={null}>
        <UpgradeModal
          portal={portal.portal}
          planIds={portal.planIds}
          defaultPlanId={upgradePlanId}
          onClose={() => { setShowUpgrade(false); setOpen(false) }}
        />
      </Suspense>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sub-reminder-popup-title"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
        aria-hidden="true"
      />
      <div ref={panelRef} className="relative w-full max-w-xs animate-scale-in overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 p-0 text-white shadow-none hover:bg-white/30"
        >
          <Icon as={X} size="sm" />
        </button>

        {/* Hero with a floating student + books + trophy illustration */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-600 px-5 pt-5 pb-4 text-center text-white">
          <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-xl" aria-hidden="true" />
          <span className="pointer-events-none absolute left-4 top-3 text-sm text-white/40" aria-hidden="true">✦</span>
          <span className="pointer-events-none absolute right-5 bottom-4 text-xs text-white/30" aria-hidden="true">✦</span>
          <div className="relative mx-auto mb-2 h-14 w-14 animate-float">
            <span className="absolute inset-0 flex items-center justify-center text-4xl drop-shadow" aria-hidden="true">🎓</span>
            <span className="absolute -left-1.5 top-1 text-lg" aria-hidden="true">📚</span>
            <span className="absolute -right-1.5 -top-1 text-lg" aria-hidden="true">🏆</span>
          </div>
          <h2 id="sub-reminder-popup-title" className="relative text-lg font-black leading-tight tracking-tight">
            {expired ? '⏳ Your Premium has ended' : '🌟 Welcome Back!'}
          </h2>
          <p className="relative mx-auto mt-1 max-w-[16rem] text-xs font-medium text-white/85">
            {expired
              ? 'Renew Premium and pick up right where you left off.'
              : 'Upgrade to Premium and unlock everything ZedExams offers.'}
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <div className="mb-3.5">
            <BenefitPills items={pills} />
          </div>

          <PlanPricingCards
            planIds={pricingPlanIds}
            popularPlanId={popularPlanId}
            selectedPlanId={popularPlanId}
            onSelect={handleUpgrade}
            hidePrices={native}
          />

          <div className="mt-4 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => handleUpgrade(null)}
              className="animate-premium-glow flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-transform hover:scale-[1.02] active:scale-95"
            >
              {expired ? '🚀 Renew Premium' : '🚀 Upgrade Now'}
              <Icon as={ArrowRight} size="xs" />
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="w-full rounded-xl bg-transparent px-4 py-1.5 text-[13px] font-bold text-gray-500 shadow-none hover:text-gray-700"
            >
              Continue with Free Version
            </button>
          </div>
          <TrustRow native={native} />
        </div>
      </div>
    </div>
  )
}
