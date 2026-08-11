/**
 * Reports tab — export a Class Register record as the documents schools keep:
 * an Excel mark schedule, a Word mark schedule, or per-learner report cards.
 *
 * Reuses the existing exporters (markScheduleToXlsx / markScheduleToDocx /
 * reportCardsToDocx) by adapting a record into the `schedule` artifact they
 * expect. buildSchedule() (markSchedule.js) supplies totals, dense-ranked
 * positions and teacher-voice comments, so the cards carry comments too.
 */

import { useEffect, useMemo, useState } from 'react'
import { listRecords } from '../../../utils/classRecords'
import { filterRecordsByPeriod } from '../../../utils/classTerms'
import { recordToSchedule } from '../lib/classRecordExport'
import { downloadMarkScheduleXlsx } from '../../../engines/export-engine/markScheduleToXlsx'
import { downloadMarkScheduleDocx } from '../../../engines/export-engine/markScheduleToDocx'
import { downloadReportCardsDocx } from '../../../engines/export-engine/reportCardsToDocx'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'
import TermPeriodFilter from './TermPeriodFilter'

function safeName(s) {
  return String(s || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class'
}

export default function ReportsTab({ register }) {
  const classId = register.id
  const toast = useToast()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [viewPeriod, setViewPeriod] = useState('current')

  const currentPeriod = { term: register.term, year: register.year }
  const visibleRecords = useMemo(
    () => filterRecordsByPeriod(records, viewPeriod, currentPeriod),
    [records, viewPeriod, currentPeriod.term, currentPeriod.year], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    listRecords(classId)
      .then((recs) => { if (!cancelled) setRecords(recs) })
      .catch((err) => { console.warn('[ReportsTab] load failed', err); if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId])

  async function run(record, kind) {
    setBusyId(`${record.id}:${kind}`)
    try {
      const schedule = recordToSchedule(record, register)
      const base = `${safeName(register.className)}-${safeName(record.title)}`
      if (kind === 'xlsx') await downloadMarkScheduleXlsx(schedule, `${base}.xlsx`)
      else if (kind === 'docx') await downloadMarkScheduleDocx(schedule, `${base}.docx`)
      else if (kind === 'cards') await downloadReportCardsDocx(schedule, `${base}-report-cards.docx`)
    } catch (err) {
      console.warn('[ReportsTab] export failed', err)
      toast.error(`Export failed: ${err.message || 'unexpected error'}`)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <Skeleton className="h-24 rounded-radius-md" />

  if (loadError) {
    return (
      <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
        <p className="theme-text font-black">Couldn&apos;t load records</p>
        <p className="theme-text-muted text-sm mt-1">
          Something went wrong. Refresh the page and try again.
        </p>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
        <div className="text-4xl mb-2">📄</div>
        <p className="theme-text font-black">Nothing to report yet</p>
        <p className="theme-text-muted text-sm mt-1">
          Create a mark schedule and enter marks — then export it here as Excel, Word, or report cards.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="theme-text-muted text-sm">Export any record as the documents your school keeps.</p>
        <TermPeriodFilter records={records} value={viewPeriod} onChange={setViewPeriod} currentPeriod={currentPeriod} />
      </div>
      {visibleRecords.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center theme-text-muted text-sm">
          Nothing for the selected term. Switch the view to “All terms” to see other periods.
        </div>
      ) : (
      <ul className="space-y-2">
        {visibleRecords.map((rec) => (
          <li key={rec.id} className="theme-card border theme-border rounded-radius-md p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="theme-text font-black text-sm truncate">{rec.title}</p>
                <p className="theme-text-muted text-xs mt-0.5">
                  {rec.type.replace('_', ' ')}
                  {` · ${rec.rosterSnapshot?.length || 0} learners`}
                  {rec.stats?.count ? ` · avg ${rec.stats.classAverage}%` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={busyId === `${rec.id}:xlsx`} onClick={() => run(rec, 'xlsx')}>Excel</Button>
                <Button size="sm" variant="secondary" loading={busyId === `${rec.id}:docx`} onClick={() => run(rec, 'docx')}>Word</Button>
                <Button size="sm" variant="ghost" loading={busyId === `${rec.id}:cards`} onClick={() => run(rec, 'cards')}>Report cards</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}
