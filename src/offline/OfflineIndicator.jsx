/**
 * OfflineIndicator — the unobtrusive status pill (Objective 8). Shows nothing at
 * all in the calm "online" state; surfaces a small, theme-aware badge for
 * offline / syncing / updating / waiting / saved-offline. Fixed to a corner so
 * it never shifts layout.
 *
 * Mounted once inside <App />. Reads everything from useOffline().
 */
import { useOffline } from './OfflineContext.jsx'
import {
  CloudIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid'

const TONE_CLASSES = {
  warn: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700',
  info: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700',
  good: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700',
  neutral: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
}

function ToneIcon({ status, STATUS }) {
  if (status === STATUS.SYNCING || status === STATUS.UPDATING) {
    return <ArrowPathIcon className="h-3.5 w-3.5 zx-rotating" aria-hidden="true" />
  }
  if (status === STATUS.SAVED_OFFLINE) {
    return <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
  }
  if (status === STATUS.OFFLINE || status === STATUS.WAITING) {
    return <ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden="true" />
  }
  return <CloudIcon className="h-3.5 w-3.5" aria-hidden="true" />
}

export default function OfflineIndicator() {
  const { showIndicator, label, tone, status, STATUS } = useOffline()
  if (!showIndicator) return null

  return (
    <div
      className="pointer-events-none fixed bottom-3 left-1/2 z-[60] -translate-x-1/2 sm:left-auto sm:right-3 sm:translate-x-0"
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm backdrop-blur ${TONE_CLASSES[tone] || TONE_CLASSES.neutral}`}
      >
        <ToneIcon status={status} STATUS={STATUS} />
        {label}
      </span>
    </div>
  )
}
