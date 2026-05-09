/**
 * Per-assignment completion drill-down (audit A10 PR 5).
 *
 * Inline expandable section for one assignment row inside
 * TeacherClassDetail's "Assigned work" list. Loaded lazily — the
 * Cloud Function call only fires when the teacher actually expands
 * a row, so the parent list stays fast even for classes with 25
 * assignments.
 *
 * Renders two columns:
 *   - "Completed" (sorted by best percentage desc)
 *   - "Not started" (sorted alphabetically)
 *
 * Anyone in the not-started column can be nudged via WhatsApp by
 * tapping their row — opens a `wa.me/?text=` deep link with a polite
 * pre-filled message, matching the existing share patterns elsewhere
 * in the app.
 */

import { useEffect, useState } from 'react'
import { getAssignmentCompletion } from '../../../utils/assignments'
import Skeleton from '../../ui/Skeleton'

function formatRelative(ms) {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function CompletedRow({ row }) {
  const initial = (row.displayName || row.email || row.uid || '?').slice(0, 1).toUpperCase()
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="flex-shrink-0 w-7 h-7 rounded-full theme-bg-subtle flex items-center justify-center text-xs font-black theme-text">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-bold text-xs truncate">
          {row.displayName || <span className="theme-text-muted italic">Pending profile</span>}
        </p>
        <p className="theme-text-muted text-[10px] truncate">
          {row.email || row.uid}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="theme-text font-black text-sm tabular-nums">
          {typeof row.bestPercentage === 'number' ? `${row.bestPercentage}%` : '—'}
        </p>
        <p className="theme-text-muted text-[10px]">
          {row.attempts}× · {formatRelative(row.lastAttemptAtMs)}
        </p>
      </div>
    </li>
  )
}

function NudgeRow({ row, assignmentTitle }) {
  // Polite WhatsApp deep-link nudge. We don't pre-fill the parent's
  // phone (we don't have it server-side here) — the teacher pastes
  // the link into their normal WhatsApp chat.
  const text = `Hi, just a friendly nudge to start "${assignmentTitle}" on ZedExams when you get a moment.`
  const href = `https://wa.me/?text=${encodeURIComponent(text)}`
  const initial = (row.displayName || row.email || row.uid || '?').slice(0, 1).toUpperCase()
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="flex-shrink-0 w-7 h-7 rounded-full theme-bg-subtle flex items-center justify-center text-xs font-black theme-text">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-bold text-xs truncate">
          {row.displayName || <span className="theme-text-muted italic">Pending profile</span>}
        </p>
        <p className="theme-text-muted text-[10px] truncate">{row.email || row.uid}</p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 text-[10px] font-bold theme-accent-text hover:underline"
        title="Send a WhatsApp nudge"
      >
        Nudge
      </a>
    </li>
  )
}

export default function AssignmentDrilldown({ assignmentId, assignmentTitle }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!assignmentId) return
    let cancelled = false
    setLoading(true)
    setErrored(false)
    getAssignmentCompletion(assignmentId)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err) => {
        console.warn('[AssignmentDrilldown] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [assignmentId])

  if (loading) {
    return (
      <div className="px-4 pb-3 pt-1 space-y-2">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-12 rounded-md" />
        <Skeleton className="h-12 rounded-md" />
      </div>
    )
  }

  if (errored || !data) {
    return (
      <div className="px-4 pb-3 pt-1">
        <p role="alert" className="theme-text-muted text-xs">
          Could not load completion details. Try collapsing and re-opening this row.
        </p>
      </div>
    )
  }

  const completed = data.learners.filter((r) => r.status === 'completed')
  const notStarted = data.learners.filter((r) => r.status === 'not_started')
  const pct = data.totalLearners > 0
    ? Math.round((data.completedCount / data.totalLearners) * 100)
    : 0

  return (
    <div className="px-4 pb-4 pt-1 space-y-3">
      {/* Mini progress bar across the row's full width */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-current/10 overflow-hidden">
          <div
            className="h-full theme-accent-fill"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
        <span className="theme-text-muted text-[11px] font-bold whitespace-nowrap tabular-nums">
          {data.completedCount} / {data.totalLearners} done
        </span>
      </div>

      {data.totalLearners === 0 ? (
        <p className="theme-text-muted text-xs">No learners in this class yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <section>
            <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-1">
              Completed ({completed.length})
            </p>
            {completed.length === 0 ? (
              <p className="theme-text-muted text-xs italic">Nobody yet.</p>
            ) : (
              <ul className="divide-y divide-current/10 theme-bg-subtle rounded-radius-md px-2">
                {completed.map((r) => <CompletedRow key={r.uid} row={r} />)}
              </ul>
            )}
          </section>

          <section>
            <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-1">
              Not started ({notStarted.length})
            </p>
            {notStarted.length === 0 ? (
              <p className="theme-text-muted text-xs italic">Whole class done!</p>
            ) : (
              <ul className="divide-y divide-current/10 theme-bg-subtle rounded-radius-md px-2">
                {notStarted.map((r) => (
                  <NudgeRow
                    key={r.uid}
                    row={r}
                    assignmentTitle={assignmentTitle || data.assignment.resourceTitle}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
