import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useTeacherUsage, TOOL_TO_FEATURE, FEATURE_LABELS } from '../../../hooks/useTeacherUsage'
import { resolveUsageReminder } from '../lib/usageReminderLogic'
import { capture } from '../../../utils/analytics'

// UsageReminderBanner — the SOFT reminder shown before a teacher hits a
// limit (~80% of an allowance used), so the contextual paywall never arrives
// as a surprise. Never a modal, never blocks the studio: a slim dismissible
// strip with "View plans". Dismissal sticks for the session (per scope, via
// sessionStorage), so the same reminder doesn't nag on every render — a NEW
// binding constraint (different scope) may still appear.
//
// Mounted on the teacher dashboard (no tool prop → scans every metered
// feature) and above each gated studio via StudioGate (tool prop → that
// studio's allowance first, then the daily cap).

const DISMISS_PREFIX = 'zedexams.usageReminder.dismissed.'

function isDismissed(scope) {
  try {
    return sessionStorage.getItem(DISMISS_PREFIX + scope) === '1'
  } catch {
    return false
  }
}

export default function UsageReminderBanner({ tool = null, className = '' }) {
  const { currentUser } = useAuth()
  const { data } = useTeacherUsage(currentUser?.uid)
  const navigate = useNavigate()
  // Local bump so dismissing re-renders without a storage listener.
  const [, setDismissTick] = useState(0)
  const shownScopeRef = useRef('')

  const feature = tool ? TOOL_TO_FEATURE[tool] || tool : null
  const reminder = resolveUsageReminder(data, { feature, labels: FEATURE_LABELS })

  if (!reminder || isDismissed(reminder.scope)) return null

  // One "shown" event per scope per mount.
  if (shownScopeRef.current !== reminder.scope) {
    shownScopeRef.current = reminder.scope
    capture('usage_reminder_shown', { scope: reminder.scope, tool, remaining: reminder.remaining })
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_PREFIX + reminder.scope, '1')
    } catch {
      /* private mode — dismissal just won't persist */
    }
    capture('usage_reminder_dismissed', { scope: reminder.scope, tool })
    setDismissTick((n) => n + 1)
  }

  function viewPlans() {
    capture('usage_reminder_view_plans', { scope: reminder.scope, tool })
    navigate('/pricing')
  }

  return (
    <div
      role="status"
      className={`mx-auto flex w-full max-w-4xl flex-wrap items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50/80 px-4 py-3 ${className}`}
    >
      <span className="text-xl" aria-hidden="true">⚡</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-slate-900">{reminder.title}</p>
        <p className="text-xs text-gray-600">{reminder.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={viewPlans}
          className="rounded-xl border border-orange-300 bg-white px-3.5 py-2 text-sm font-bold text-orange-600 transition-colors hover:bg-orange-100"
        >
          View plans
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss reminder"
          className="grid h-9 w-9 place-items-center rounded-full text-gray-400 transition-colors hover:bg-orange-100 hover:text-gray-700"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
