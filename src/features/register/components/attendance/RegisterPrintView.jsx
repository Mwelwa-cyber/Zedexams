/**
 * RegisterPrintView — the Print & Export panel. Dedicated print documents
 * (never the app screen): official A4-landscape class register, term
 * attendance summary, and the individual learner report, plus CSV/Excel/Word
 * downloads. Every artefact is built from the shared export model so printed
 * totals always equal the on-screen totals.
 */

import { useMemo, useState } from 'react'
import useRegisterExportModel from '../../hooks/useRegisterExportModel'
import {
  buildOfficialRegisterHtml,
  buildTermSummaryHtml,
  printAttendanceHtml,
  downloadAttendancePdf,
  downloadAttendanceCsv,
  downloadAttendanceXlsx,
  registerMatrixRows,
  termSummaryRows,
} from '../../lib/attendanceExportService'
import { groupDaysByMonth } from '../../../../utils/attendanceCalendarResolver'
import { useToast } from '../../../../components/ui/Toast'
import Button from '../../../../components/ui/Button'
import LearnerAttendanceReport from './LearnerAttendanceReport'

export default function RegisterPrintView({ registerHook, register, uid, teacherName, policy }) {
  const { roster, daysWithRecords, termInfo } = registerHook
  const toast = useToast()
  const [rangeMode, setRangeMode] = useState('term') // 'term' | month key | 'custom'
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [busy, setBusy] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)

  const months = useMemo(() => groupDaysByMonth(daysWithRecords), [daysWithRecords])

  const range = useMemo(() => {
    if (rangeMode === 'term') return null
    if (rangeMode === 'custom') {
      return { from: customFrom || undefined, to: customTo || undefined }
    }
    const month = months.find((m) => m.key === rangeMode)
    if (!month) return null
    return { from: month.days[0].date, to: month.days[month.days.length - 1].date }
  }, [rangeMode, customFrom, customTo, months])

  const { model } = useRegisterExportModel({
    registerHook, register, uid, teacherName, policy, range,
  })

  const baseName = `${(register.className || 'class').replace(/\s+/g, '-').toLowerCase()}-${termInfo?.termId || 'term'}`
  const noData = model.days.length === 0

  async function run(key, fn) {
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      toast.error(err.message || 'Export failed — try again.')
    } finally {
      setBusy(null)
    }
  }

  const actions = [
    {
      group: 'Official class register (A4 landscape)',
      items: [
        { key: 'reg-print', label: 'Print', fn: () => printAttendanceHtml(buildOfficialRegisterHtml(model)) },
        { key: 'reg-pdf', label: 'Download PDF', fn: () => downloadAttendancePdf(buildOfficialRegisterHtml(model), `${baseName}-register.pdf`, { orientation: 'landscape' }) },
        { key: 'reg-csv', label: 'Export CSV', fn: () => downloadAttendanceCsv(registerMatrixRows(model), `${baseName}-register.csv`) },
        { key: 'reg-xlsx', label: 'Export Excel', fn: () => downloadAttendanceXlsx(registerMatrixRows(model), `${baseName}-register.xlsx`, 'Register') },
      ],
    },
    {
      group: 'Term attendance summary (A4 landscape)',
      items: [
        { key: 'sum-print', label: 'Print', fn: () => printAttendanceHtml(buildTermSummaryHtml(model)) },
        { key: 'sum-pdf', label: 'Download PDF', fn: () => downloadAttendancePdf(buildTermSummaryHtml(model), `${baseName}-summary.pdf`, { orientation: 'landscape' }) },
        {
          key: 'sum-docx',
          label: 'Download Word (.docx)',
          fn: async () => {
            const { downloadTermSummaryDocx } = await import('../../../../engines/export-engine/attendanceToDocx')
            await downloadTermSummaryDocx(model, `${baseName}-summary.docx`)
          },
        },
        { key: 'sum-csv', label: 'Export CSV', fn: () => downloadAttendanceCsv(termSummaryRows(model), `${baseName}-summary.csv`) },
        { key: 'sum-xlsx', label: 'Export Excel', fn: () => downloadAttendanceXlsx(termSummaryRows(model), `${baseName}-summary.xlsx`, 'Summary') },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {/* date range */}
      <div className="theme-card border theme-border rounded-radius-md p-3 flex flex-wrap items-center gap-2">
        <label htmlFor="export-range" className="theme-text-muted text-xs font-black uppercase tracking-wider">Date range</label>
        <select id="export-range" value={rangeMode} onChange={(e) => setRangeMode(e.target.value)}
          className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm font-bold">
          <option value="term">Full term</option>
          {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          <option value="custom">Custom range</option>
        </select>
        {rangeMode === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Range start" className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm" />
            <span className="theme-text-muted text-sm">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              aria-label="Range end" className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm" />
          </>
        )}
        <span className="theme-text-muted text-xs ml-auto">{model.days.length} register day{model.days.length === 1 ? '' : 's'} in range</span>
      </div>

      {noData && (
        <p className="theme-text-muted text-sm">No marked register days in this range yet — exports will be empty until attendance is recorded.</p>
      )}

      {actions.map((section) => (
        <div key={section.group} className="theme-card border theme-border rounded-radius-md p-3">
          <h3 className="theme-text font-black text-sm mb-2">{section.group}</h3>
          <div className="flex flex-wrap gap-2">
            {section.items.map((a) => (
              <Button key={a.key} type="button" size="sm" variant="secondary"
                loading={busy === a.key} disabled={busy !== null}
                onClick={() => run(a.key, a.fn)}>
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      ))}

      <div className="theme-card border theme-border rounded-radius-md p-3">
        <h3 className="theme-text font-black text-sm mb-2">Individual learner report (A4 portrait)</h3>
        <Button type="button" size="sm" variant="secondary" onClick={() => setReportOpen(true)} disabled={!roster.length}>
          Open learner report…
        </Button>
      </div>

      {reportOpen && (
        <LearnerAttendanceReport
          model={model}
          roster={roster}
          baseName={baseName}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  )
}
