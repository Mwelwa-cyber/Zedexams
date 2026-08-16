/**
 * GraceRibbon — days 0 to 3 after a subscription expires.
 *
 * A thin amber bar under the top bar. Everything is still unlocked; the user
 * is still inside the value while being asked to renew, which converts better
 * than a wall and, more to the point, does not punish somebody whose mobile
 * money failed on a Tuesday.
 *
 * ── Dismissible for the session, back next session ─────────────────────
 *
 * Not "dismissible forever" (the renewal then goes unmentioned until access
 * disappears, which is the ambush the fade replaces) and not "undismissible"
 * (a bar that cannot be closed is a bar that gets ignored, and then resented).
 * `sessionStorage`, so the choice lasts exactly as long as the visit.
 *
 * ── Why it does not ask the interruption budget ────────────────────────
 *
 * It is tier 0/1 furniture, not an interruption: it takes 40 pixels at the top
 * of a page the user navigated to, blocks nothing, and covers nothing. Running
 * it through the budget would mean a 24-hour dismissal cooldown could hide the
 * only notice that access is about to change.
 */

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PLAN_STATUS, useEntitlements } from '../../../services/entitlements'
import { isReminderSuppressedPath } from '../lib/reminderVisibility'

const DISMISS_KEY = 'zedexams:graceRibbonDismissed'

function dismissedThisSession() {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

export default function GraceRibbon() {
  const { planState } = useEntitlements()
  const { pathname } = useLocation()
  const [dismissed, setDismissed] = useState(dismissedThisSession)

  if (dismissed) return null
  if (planState?.status !== PLAN_STATUS.GRACE) return null
  // Marketing, auth and immersive routes: the same suppression list the
  // subscription status strip uses, so the two bars cannot appear on
  // different sets of pages.
  if (isReminderSuppressedPath(pathname)) return null

  const daysLeft = planState.graceEndsAt
    ? Math.max(0, Math.ceil((planState.graceEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null

  function handleDismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 dark:border-amber-400/30 dark:from-amber-500/10 dark:to-orange-500/10">
      <span className="text-sm" aria-hidden="true">⏳</span>
      <div className="min-w-0 flex-1 leading-tight">
        <span className="block text-[11px] font-black text-amber-900 dark:text-amber-200">
          Premium ended
        </span>
        <span className="block text-[10.5px] text-amber-800/90 dark:text-amber-200/80">
          {daysLeft != null
            ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} of access left — everything still works`
            : 'Everything still works while you renew'}
        </span>
      </div>
      <Link
        to="/my-subscription"
        className="flex-none rounded-full bg-orange-600 px-3 py-1.5 text-[10.5px] font-black text-white hover:bg-orange-700"
      >
        Renew
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Hide until next visit"
        className="flex-none bg-transparent px-1 text-[13px] leading-none text-amber-800/70 shadow-none dark:text-amber-200/70"
      >
        ✕
      </button>
    </div>
  )
}
