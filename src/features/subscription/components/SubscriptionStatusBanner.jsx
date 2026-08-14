import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { SUB_STATUS } from '../../../utils/subscriptionStatus'
import { isReminderSuppressedPath } from '../lib/reminderVisibility'
import Icon from '../../../components/ui/Icon'
import { X } from '../../../components/ui/icons'

const SESSION_DISMISS_KEY = 'zedexams.subStatusBanner.dismissed'

/**
 * Thin, full-width status strip pinned under the app banners. Shows "Free Plan"
 * or "Expired Subscription" for users who still need to upgrade/renew, with a
 * one-tap route to the My Subscription page. Disappears the moment a user
 * becomes Pro (shouldRemind → false). Dismissible per browser session.
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

  const expired = status === SUB_STATUS.EXPIRED || isExpired
  const palette = expired
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900'
  const label = expired ? 'Expired Subscription' : 'Free Plan'
  const message = expired
    ? 'Renew to restore your ZedExams Pro access.'
    : "You're on the free plan — upgrade to unlock Pro."

  function handleDismiss() {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className={`border-b ${palette}`}>
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-1.5 sm:px-4">
        <button
          type="button"
          onClick={() => navigate('/my-subscription')}
          className="flex min-w-0 flex-1 items-center gap-2 bg-transparent px-0 py-0 text-left shadow-none min-h-0"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide">
            <span aria-hidden="true">{expired ? '⏳' : '✨'}</span>
            {label}
          </span>
          <span className="flex-1 truncate text-xs font-bold sm:text-[13px]">{message}</span>
          <span className="hidden shrink-0 rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-black underline-offset-2 sm:inline">
            {expired ? 'Renew →' : 'Upgrade →'}
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
