/**
 * PlanReminder — the learner shell's own plan reminder (expired, grace, free).
 *
 * It lives INSIDE the page column, between the shell's banners and the page,
 * and that placement is the whole fix. The app-root strip it replaces sat
 * above the routed page in the document flow, so from 1000px the shell's
 * fixed sidebar was painted over its left side (a learner read only
 * "…estore your ZedExams access.") and on a phone the glass top bar pulled up
 * over its foot. A card in the column cannot be covered by chrome that is
 * itself laid out around the column.
 *
 * The shell claims the reminder slot (`reminderHost`) so the root strips stand
 * down while this is mounted; nothing is drawn twice.
 *
 * ── Cadence ─────────────────────────────────────────────────────────────
 *
 * Closing it hides it for the rest of the DAY on this device, then it comes
 * back. "For the session" (what the strip did) meant a learner who never
 * closed the app never saw it again, and "forever" would let access vanish
 * unmentioned. It is furniture, not an interruption: it takes one card's
 * height at the top of the page, blocks nothing and is never a modal — the
 * interruption budget in src/services/entitlements exists to stop the latter
 * and this is not that.
 *
 * ── Words ───────────────────────────────────────────────────────────────
 *
 * No price. The Android build may not print one (Google Play's sheet owns it),
 * the web checkout prints it a tap later, and a card that names K15 on one
 * platform and nothing on the other is two copies to keep honest.
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PLAN_STATUS, useEntitlements } from '../../../services/entitlements'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { SUB_STATUS } from '../../../engines/payment-engine/subscriptionStatus'
import { useAuth } from '../../../contexts/AuthContext'
import { isReminderSuppressedPath } from '../../../shared/utils/reminderVisibility'
import { claimReminderHost } from '../../../shared/utils/reminderHost'

export const DISMISS_KEY = 'zedexams.planReminder.hiddenOn'
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Local calendar day, YYYY-MM-DD — "today" is the learner's, not UTC's. */
export function localDayKey(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function hiddenToday() {
  try { return localStorage.getItem(DISMISS_KEY) === localDayKey() } catch { return false }
}

/**
 * The one decision: which reminder (if any) this account sees.
 * Pure so the three states and their precedence are testable without a DOM.
 *
 * @returns {null | {tone:'grace'|'expired'|'free', icon:string, title:string, sub:string, cta:string}}
 */
export function resolvePlanReminder({ planStatus, graceEndsAt, subStatus, shouldRemind, now = Date.now() }) {
  if (planStatus === PLAN_STATUS.GRACE) {
    const daysLeft = graceEndsAt
      ? Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - now) / MS_PER_DAY))
      : null
    return {
      tone: 'grace',
      icon: '⏳',
      title: 'Your plan has ended',
      sub: daysLeft != null
        ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} of access left — everything still works.`
        : 'Everything still works while you renew.',
      cta: 'Renew',
    }
  }
  if (!shouldRemind) return null
  if (subStatus === SUB_STATUS.EXPIRED) {
    return {
      tone: 'expired',
      icon: '🔒',
      title: 'Your plan has expired',
      sub: 'Renew to get your full quizzes, past papers and results back.',
      cta: 'Renew',
    }
  }
  return {
    tone: 'free',
    icon: '✨',
    title: "You're on the free plan",
    sub: 'Unlock every quiz, paper and result for your grade.',
    cta: 'See plans',
  }
}

export default function PlanReminder() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const { planState } = useEntitlements()
  const { status, shouldRemind } = useSubscriptionReminder()
  const [hidden, setHidden] = useState(hiddenToday)

  // Claim the slot for as long as the shell is mounted, so the root strips
  // stand down — whether or not a card is showing right now.
  useEffect(() => claimReminderHost(), [])

  if (!userProfile) return null
  if (hidden) return null
  if (isReminderSuppressedPath(pathname)) return null

  const reminder = resolvePlanReminder({
    planStatus: planState?.status,
    graceEndsAt: planState?.graceEndsAt,
    subStatus: status,
    shouldRemind,
  })
  if (!reminder) return null

  function hideForToday() {
    try { localStorage.setItem(DISMISS_KEY, localDayKey()) } catch { /* private mode: hides for this visit only */ }
    setHidden(true)
  }

  return (
    <div className={`lhx-plan-reminder is-${reminder.tone}`} role="status">
      <span className="lhx-plan-reminder-ic" aria-hidden="true">{reminder.icon}</span>
      <span className="lhx-plan-reminder-txt">
        <span className="lhx-plan-reminder-title">{reminder.title}</span>
        <span className="lhx-plan-reminder-sub">{reminder.sub}</span>
      </span>
      <button type="button" className="lhx-plan-reminder-btn" onClick={() => navigate('/my-subscription')}>
        {reminder.cta}
      </button>
      <button
        type="button"
        className="lhx-plan-reminder-x"
        aria-label="Hide until tomorrow"
        onClick={hideForToday}
      >
        ×
      </button>
    </div>
  )
}
