/**
 * Per-class analytics surface for teachers (audit A10 PR 4).
 *
 * Mounted on /teacher/classes/:id. Reads come from the
 * getClassStats Cloud Function — admin SDK aggregates the 30-day
 * window into a single response so the client doesn't have to
 * navigate Firestore rules for `results`.
 *
 * Renders three blocks:
 *   1. Headline KPIs — total attempts, active learners (last 7 days),
 *      class average. Each cell self-hides when there's no data.
 *   2. Subject breakdown — count + average per subject the class has
 *      practised, sorted by activity.
 *   3. Per-assignment completion — "X of Y learners" bar for each
 *      active assignment.
 *
 * Designed to be mostly self-hiding for empty classes: an admin
 * looking at a brand-new roster sees the section header and a
 * friendly "no activity yet" message, not a row of zeroes that
 * would look like a broken dashboard.
 */

import { useEffect, useState } from 'react'
import { getClassStats } from '../../../utils/assignments'
import { SUBJECTS } from '../../../config/curriculum'
import Skeleton from '../../ui/Skeleton'

function fmtPct(n) {
  return typeof n === 'number' ? `${n}%` : '—'
}

function KpiCell({ value, label, hint, hidden }) {
  if (hidden) return null
  return (
    <div className="theme-bg-subtle rounded-radius-md p-3 text-center min-w-0">
      <p className="theme-text font-display font-black text-2xl tabular-nums leading-none">
        {value}
      </p>
      <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1.5">
        {label}
      </p>
      {hint && <p className="theme-text-muted text-[10px] mt-0.5">{hint}</p>}
    </div>
  )
}

function CompletionBar({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-current/10 overflow-hidden">
        <div
          className="h-full theme-accent-fill"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="theme-text-muted text-xs font-bold tabular-nums whitespace-nowrap">
        {completed} / {total}
      </span>
    </div>
  )
}

export default function ClassAnalytics({ classId }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!classId) return
    let cancelled = false
    setLoading(true)
    setErrored(false)
    getClassStats(classId)
      .then((data) => { if (!cancelled) setStats(data) })
      .catch((err) => {
        console.warn('[ClassAnalytics] load failed', err)
        if (!cancelled) setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId])

  if (loading) {
    return (
      <section className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
        <Skeleton className="h-5 w-32 rounded-md" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20 rounded-radius-md" />
          <Skeleton className="h-20 rounded-radius-md" />
          <Skeleton className="h-20 rounded-radius-md" />
        </div>
      </section>
    )
  }

  if (errored || !stats) {
    return (
      <section className="theme-card border theme-border rounded-radius-md p-4">
        <p className="theme-text font-black text-sm">Class progress</p>
        <p role="alert" className="theme-text-muted text-xs mt-2">
          We couldn&apos;t load class stats right now. Please refresh.
        </p>
      </section>
    )
  }

  const { summary, subjectBreakdown, assignments, totalLearners } = stats
  const noActivity = summary.totalAttempts === 0

  return (
    <section className="theme-card border theme-border rounded-radius-md p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="theme-text font-black text-sm">Class progress</p>
        <p className="theme-text-muted text-[11px]">
          last {summary.windowDays} days
        </p>
      </div>

      {noActivity ? (
        <p className="theme-text-muted text-sm">
          No quiz activity from this class yet — once learners start completing
          assignments you&apos;ll see scores and subject breakdowns here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <KpiCell
              value={summary.totalAttempts}
              label="Attempts"
              hint={`across ${totalLearners} learner${totalLearners === 1 ? '' : 's'}`}
            />
            <KpiCell
              value={summary.activeLearners7d}
              label="Active"
              hint="last 7 days"
            />
            <KpiCell
              value={fmtPct(summary.averagePercentage)}
              label="Class avg"
              hidden={summary.averagePercentage == null}
            />
          </div>

          {subjectBreakdown.length > 0 && (
            <div>
              <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
                By subject
              </p>
              <ul className="grid sm:grid-cols-2 gap-2">
                {subjectBreakdown.map((row) => {
                  const meta = SUBJECTS.find((s) => s.id === row.subject)
                  return (
                    <li
                      key={row.subject}
                      className="flex items-center gap-2 theme-bg-subtle rounded-radius-md px-3 py-2"
                    >
                      <span aria-hidden="true">{meta?.icon || '📚'}</span>
                      <span className="theme-text font-bold text-sm flex-1 min-w-0 truncate">
                        {meta?.shortLabel || meta?.label || row.subject}
                      </span>
                      <span className="theme-text-muted text-xs whitespace-nowrap">
                        {row.count}× · {fmtPct(row.averagePercentage)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {assignments.length > 0 && (
        <div>
          <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mb-2">
            Assignment completion
          </p>
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.id} className="theme-bg-subtle rounded-radius-md px-3 py-2 space-y-1.5">
                <p className="theme-text font-bold text-xs truncate">{a.resourceTitle}</p>
                <CompletionBar
                  completed={a.completedCount}
                  total={a.totalLearners}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
