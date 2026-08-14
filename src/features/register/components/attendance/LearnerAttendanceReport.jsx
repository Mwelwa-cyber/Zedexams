/**
 * LearnerAttendanceReport — modal for the individual A4-portrait report:
 * pick a learner, add an optional teacher comment, then print / PDF / Word.
 * Built from the shared export model (same calculation engine as the screen).
 */

import { useMemo, useState } from 'react'
import {
  buildLearnerReportHtml,
  printAttendanceHtml,
  downloadAttendancePdf,
} from '../../lib/attendanceExportService'
import { formatPercent } from '../../../../utils/attendanceCalculator'
import { useToast } from '../../../../shared/components/Toast'
import Button from '../../../../shared/components/Button'

export default function LearnerAttendanceReport({ model, roster, baseName, onClose }) {
  const toast = useToast()
  const sorted = useMemo(() => [...roster].sort((a, b) => (a.order || 0) - (b.order || 0)), [roster])
  const [learnerId, setLearnerId] = useState(sorted[0]?.id || '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(null)

  const row = model.learners.find((l) => l.learner.id === learnerId)

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

  const fileBase = `${baseName}-${(row?.learner.fullName || 'learner').replace(/\s+/g, '-').toLowerCase()}`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Learner attendance report">
      <div className="theme-card border theme-border rounded-radius-md w-full max-w-lg p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="theme-text font-black text-lg">Learner attendance report</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="theme-text-muted font-black text-xl leading-none">×</button>
        </div>

        <label className="block">
          <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Learner</span>
          <select value={learnerId} onChange={(e) => setLearnerId(e.target.value)}
            className="mt-1 w-full rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm font-bold">
            {sorted.map((l) => <option key={l.id} value={l.id}>{l.fullName}{l.learnerNumber ? ` (${l.learnerNumber})` : ''}</option>)}
          </select>
        </label>

        {row && (
          <p className="theme-text-muted text-sm">
            Term so far: <b className="theme-text">{row.totals.presentDays + row.totals.lateDays}</b> of{' '}
            <b className="theme-text">{row.totals.eligibleDays}</b> days attended ·{' '}
            <b className="theme-text">{formatPercent(row.totals.attendancePercentage)}</b>
          </p>
        )}

        <label className="block">
          <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Teacher comment (optional)</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500}
            className="mt-1 w-full rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm" />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" loading={busy === 'print'} disabled={!row || busy !== null}
            onClick={() => run('print', () => printAttendanceHtml(buildLearnerReportHtml(model, learnerId, { comment })))}>
            Print
          </Button>
          <Button type="button" size="sm" variant="secondary" loading={busy === 'pdf'} disabled={!row || busy !== null}
            onClick={() => run('pdf', () => downloadAttendancePdf(buildLearnerReportHtml(model, learnerId, { comment }), `${fileBase}.pdf`, { orientation: 'portrait' }))}>
            Download PDF
          </Button>
          <Button type="button" size="sm" variant="secondary" loading={busy === 'docx'} disabled={!row || busy !== null}
            onClick={() => run('docx', async () => {
              const { downloadLearnerReportDocx } = await import('../../../../engines/export-engine/attendanceToDocx')
              await downloadLearnerReportDocx(model, learnerId, `${fileBase}.docx`, { comment })
            })}>
            Download Word
          </Button>
        </div>
      </div>
    </div>
  )
}
