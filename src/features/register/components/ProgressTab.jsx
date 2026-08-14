/**
 * Progress tab — how each learner is tracking across the class's records.
 *
 * Reads every marking record (mark schedules, assessments, SBA), builds a
 * per-learner × per-record percentage matrix (src/utils/classProgress.js), and
 * shows each learner's average + CBC grade plus the class average per record.
 * Read-only; wide table scrolls horizontally on phones.
 */

import { useEffect, useMemo, useState } from 'react'
import { listRecords } from '../../../utils/classRecords'
import { buildClassProgress, overallGrade } from '../lib/classProgress'
import { filterRecordsByPeriod } from '../../../utils/classTerms'
import Skeleton from '../../../shared/components/Skeleton'
import TermPeriodFilter from './TermPeriodFilter'

function toneFor(pct) {
  if (pct == null) return 'theme-text-muted'
  if (pct >= 75) return 'text-emerald-600'
  if (pct >= 60) return 'text-blue-600'
  if (pct >= 50) return 'text-amber-600'
  return 'text-red-500'
}

function Stat({ label, value, suffix = '' }) {
  return (
    <div className="theme-card border theme-border rounded-radius-md px-3 py-2 text-center">
      <p className="theme-text font-display font-black text-lg leading-none">{value}{suffix}</p>
      <p className="theme-text-muted text-[10px] uppercase tracking-wider mt-1">{label}</p>
    </div>
  )
}

export default function ProgressTab({ register }) {
  const classId = register.id
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [viewPeriod, setViewPeriod] = useState('current')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    listRecords(classId)
      .then((recs) => { if (!cancelled) setRecords(recs) })
      .catch((err) => { console.warn('[ProgressTab] load failed', err); if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId])

  const currentPeriod = { term: register.term, year: register.year }
  const filtered = useMemo(
    () => filterRecordsByPeriod(records, viewPeriod, currentPeriod),
    [records, viewPeriod, currentPeriod.term, currentPeriod.year], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const progress = useMemo(() => buildClassProgress(filtered), [filtered])
  const classAverage = useMemo(() => {
    const avgs = progress.learners.map((l) => progress.averages[l.rosterId] || 0)
    return avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : 0
  }, [progress])

  if (loading) return <Skeleton className="h-40 rounded-radius-md" />

  if (loadError) {
    return (
      <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
        <p className="theme-text font-black">Couldn&apos;t load progress data</p>
        <p className="theme-text-muted text-sm mt-1">
          Something went wrong. Refresh the page and try again.
        </p>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
        <div className="text-4xl mb-2">📈</div>
        <p className="theme-text font-black">No progress to show yet</p>
        <p className="theme-text-muted text-sm mt-1">
          Once you enter marks in a mark schedule, SBA, or assessment, each learner&apos;s
          trend across records appears here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <TermPeriodFilter records={records} value={viewPeriod} onChange={setViewPeriod} currentPeriod={currentPeriod} />
      </div>

      {progress.records.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center theme-text-muted text-sm">
          No marked records for the selected term. Switch the view to “All terms” to see other periods.
        </div>
      ) : (
      <>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Records" value={progress.records.length} />
        <Stat label="Learners" value={progress.learners.length} />
        <Stat label="Class avg" value={classAverage} suffix="%" />
      </div>

      <div className="overflow-x-auto theme-card border theme-border rounded-radius-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="theme-text-muted text-[11px] uppercase tracking-wider text-left border-b theme-border">
              <th className="px-3 py-2 min-w-[140px] sticky left-0 theme-card">Learner</th>
              {progress.records.map((r) => (
                <th key={r.id} className="px-3 py-2 text-center whitespace-nowrap" title={r.title}>
                  {r.title.length > 14 ? `${r.title.slice(0, 14)}…` : r.title}
                </th>
              ))}
              <th className="px-3 py-2 text-center">Avg</th>
              <th className="px-3 py-2 text-center">Grade</th>
            </tr>
          </thead>
          <tbody>
            {progress.learners.map((l) => {
              const avg = progress.averages[l.rosterId] || 0
              return (
                <tr key={l.rosterId} className="border-b theme-border last:border-0">
                  <td className="px-3 py-1.5 theme-text font-bold whitespace-nowrap sticky left-0 theme-card">{l.fullName}</td>
                  {progress.records.map((r) => {
                    const cell = progress.cells[l.rosterId]?.[r.id]
                    return (
                      <td key={r.id} className={`px-3 py-1.5 text-center ${toneFor(cell?.percentage)}`}>
                        {cell ? `${cell.percentage}%` : '—'}
                      </td>
                    )
                  })}
                  <td className={`px-3 py-1.5 text-center font-black ${toneFor(avg)}`}>{avg}%</td>
                  <td className="px-3 py-1.5 text-center text-xs theme-text-muted whitespace-nowrap">{overallGrade(avg)}</td>
                </tr>
              )
            })}
            {/* Class average per record */}
            <tr className="border-t-2 theme-border theme-bg-subtle">
              <td className="px-3 py-2 theme-text font-black sticky left-0 theme-bg-subtle">Class average</td>
              {progress.records.map((r) => (
                <td key={r.id} className="px-3 py-2 text-center theme-text font-black">{r.classAverage}%</td>
              ))}
              <td className="px-3 py-2 text-center theme-text font-black">{classAverage}%</td>
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  )
}
