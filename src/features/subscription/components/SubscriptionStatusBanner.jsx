import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { SUB_STATUS } from '../../../engines/payment-engine/subscriptionStatus'
import { mayShowPrice } from '../../../services/entitlements/planState'
import { isReminderSuppressedPath } from '../lib/reminderVisibility'
import Icon from '../../../shared/components/Icon'
import { X } from '../../../shared/components/icons'

const SESSION_DISMISS_KEY = 'zedexams.subStatusBanner.dismissed'

/**
 * Thin, full-width status strip pinned under the app banners. Shows "Free Plan"
 * or "Expired Subscription" for users who still need to upgrade/renew, with a
 * one-tap route to the My Subscription page. Disappears the moment a user
 * becomes Pro (shouldRemind → false). Dismissible per browser session.
 *
 * ── An under-18 learner is never sent to a price ────────────────────
 *
 * This strip used to render "You're on the free plan — upgrade to unlock
 * Pro. Upgrade →" to every free account, learners included, and the
 * Upgrade link went to /my-subscription — a price list and a checkout.
 * Two things were wrong with that. `Pro` is the TEACHER tier, so the
 * sentence named a product a learner cannot buy; and putting any price in
 * front of a child contradicts the commitment on /child-safety and Play's
 * Families policy, quite apart from being an offer made to somebody with
 * no mobile money account.
 *
 * So for a session that is not positively an adult the strip keeps its
 * place but changes what it does: no price, no plan name, and the action
 * goes to /ask-a-grown-up, which carries no price and sends the request
 * to the linked guardian. The child still asks; the guardian still pays.
 *
 * Deliberately a NAVIGATION rather than `useUnlockFlow`'s sheet. Two
 * reasons: this strip renders on nearly every route for every free
 * account, and `useUnlockFlow` pulls `useEntitlements`, which opens a
 * Firestore `onSnapshot` on the usage meter — an app-wide listener bought
 * for a banner. And /my-subscription and /pricing already REDIRECT an
 * under-18 to that page, so a tap landing there means every route to a
 * price ends at one screen instead of two lookalike surfaces.
 */
export default function SubscriptionStatusBanner() {
  const { userProfile } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { status, shouldRemind, isExpired } = useSubscriptionReminder()
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1' } catch { return false }
  })

  if (!userProfile) return null
  if (!shouldRemind) return null
  if (dismissed) return null
  if (isReminderSuppressedPath(pathname)) return null

  const showPrice = mayShowPrice(userProfile)

  const expired = status === SUB_STATUS.EXPIRED || isExpired
  const palette = expired
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900'

  // Two vocabularies, and the under-18 one names no plan at all. "Free
  // Plan" against "upgrade to unlock Pro" is the pairing that made a
  // learner an offer for a teacher product.
  const label = showPrice ? (expired ? 'Expired Subscription' : 'Free Plan') : 'Locked'
  const message = showPrice
    ? (expired
      ? 'Renew to restore your ZedExams access.'
      : "You're on the free plan — unlock everything for your grade.")
    : 'Ask a grown-up to unlock everything on ZedExams.'
  const action = showPrice ? (expired ? 'Renew →' : 'Upgrade →') : 'Ask a grown-up →'

  function handleAction() {
    if (showPrice) {
      navigate('/my-subscription')
      return
    }
    navigate('/ask-a-grown-up')
  }

  function handleDismiss() {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className={`border-b ${palette}`}>
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-1.5 sm:px-4">
        <button
          type="button"
          onClick={handleAction}
          className="flex min-w-0 flex-1 items-center gap-2 bg-transparent px-0 py-0 text-left shadow-none min-h-0"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide">
            <span aria-hidden="true">{expired ? '⏳' : '✨'}</span>
            {label}
          </span>
          <span className="flex-1 truncate text-xs font-bold sm:text-[13px]">{message}</span>
          <span className="hidden shrink-0 rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-black underline-offset-2 sm:inline">
            {action}
          </span>
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="shrink-0 rounded-full bg-transparent p-1 opacity-70 shadow-none min-h-0 hover:opacity-100"
        >
          <Icon as={X} size="sm" />
        </button>
      </div>
    </div>
  )
}
