/**
 * AttendanceSummaryPanel — term-to-date class summary: enrolment, today's
 * counts, aggregate attendance, watch-list / perfect-attendance learners and
 * the monthly trend. All numbers come from attendanceCalculator's
 * computeClassSummary — the same engine the grid, prints and exports use.
 */

import { useMemo, useState } from 'react'
import { computeClassSummary, formatPercent } from '../../../../utils/attendanceCalculator'
import { markableDays } from '../../../../utils/attendanceCalendarResolver'
import { saveAttendanceTermSettings } from '../../../../utils/attendanceService'
import { DEFAULT_ATTENDANCE_POLICY } from '../../../../utils/attendanceConstants'
import { useToast } from '../../../ui/Toast'
import Button from '../../../ui/Button'

function Stat({ label, value, tone = 'theme-text' }) {
  return (
    <div className="theme-card border theme-border rounded-radius-md px-3 py-2">
      <p className="theme-text-muted text-[11px] font-black uppercase tracking-wider">{label}</p>
      <p className={`${tone} font-black text-lg`}>{value}</p>
    </div>
  )
}

export default function AttendanceSummaryPanel({ registerHook, policy, uid, canEdit }) {
  const { roster, termInfo, termId, daysWithRecords, todayIso, termDoc } = registerHook
  const toast = useToast()

  const summary = useMemo(() => computeClassSummary({
    learners: roster,
    days: markableDays(daysWithRecords),
    term: { startDate: termInfo?.startDate, endDate: termInfo?.endDate },
    policy,
    todayIso,
  }), [roster, daysWithRecords, termInfo, policy, todayIso])

  const nameOf = (learnerId) => roster.find((l) => l.id === learnerId)?.fullName || 'Unknown learner'
  const threshold = policy.warningThresholdPercent ?? DEFAULT_ATTENDANCE_POLICY.warningThresholdPercent
  const [thresholdDraft, setThresholdDraft] = useState(String(threshold))
  const [savingThreshold, setSavingThreshold] = useState(false)

  async function handleSaveThreshold() {
    const value = Number(thresholdDraft)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error('The threshold must be between 0 and 100.')
      return
    }
    setSavingThreshold(true)
    try {
      await saveAttendanceTermSettings(registerHook.classId, uid, {
        termId,
        term: termInfo?.termLabel,
        year: termInfo?.year,
      }, { policy: { ...(termDoc?.policy || {}), warningThresholdPercent: value } })
      toast.success(`Warning threshold set to ${value}%.`)
    } catch (err) {
      toast.error(`Could not save: ${err.message || 'unexpected error'}`)
    } finally {
      setSavingThreshold(false)
    }
  }

  const t = summary.todayCounts
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Enrolment" value={summary.enrolment} />
        <Stat label="Boys" value={summary.boys} />
        <Stat label="Girls" value={summary.girls} />
        <Stat label="Avg attendance" value={formatPercent(summary.averageAttendancePercentage)} tone="theme-accent-text" />
      </div>

      <div>
        <h3 className="theme-text font-black text-sm mb-2">Today</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <Stat label="Present" value={t.present} tone="text-green-700" />
          <Stat label="Absent" value={t.absent} tone="text-red-700" />
          <Stat label="Sick" value={t.sick} tone="text-blue-700" />
          <Stat label="Late" value={t.late} tone="text-amber-700" />
          <Stat label="Excused" value={t.excused} tone="text-purple-700" />
          <Stat label="Unmarked" value={t.unmarked} tone={t.unmarked > 0 ? 'text-amber-600' : 'theme-text'} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <Stat label="Possible learner attendance" value={summary.possibleAttendance} />
        <Stat label="Actual learner attendance" value={summary.actualAttendance} />
        <Stat label="Total absences" value={summary.totalAbsences} />
        <Stat label="Total sick days" value={summary.totalSickDays} />
      </div>

      {/* monthly trend */}
      <div className="theme-card border theme-border rounded-radius-md p-3">
        <h3 className="theme-text font-black text-sm mb-2">Attendance trend (by month)</h3>
        {summary.monthlyTrend.length === 0 ? (
          <p className="theme-text-muted text-sm">No marked days yet.</p>
        ) : (
          <div className="flex items-end gap-3 h-28">
            {summary.monthlyTrend.map((m) => (
              <div key={m.month} className="flex flex-col items-center gap-1 flex-1">
                <span className="theme-text text-xs font-black">{m.percentage == null ? '—' : formatPercent(m.percentage)}</span>
                <div className="w-full max-w-10 rounded-t theme-accent-fill" style={{ height: `${Math.max(4, (m.percentage || 0) * 0.8)}px` }} />
                <span className="theme-text-muted text-[11px] font-bold">{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* watch list + perfect attendance */}
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="theme-card border theme-border rounded-radius-md p-3">
          <h3 className="theme-text font-black text-sm mb-1">Below {threshold}% attendance</h3>
          {summary.belowThreshold.length === 0 ? (
            <p className="theme-text-muted text-sm">No learners below the threshold. 🎉</p>
          ) : (
            <ul className="space-y-1">
              {summary.belowThreshold
                .sort((a, b) => a.percentage - b.percentage)
                .map((w) => (
                  <li key={w.learnerId} className="flex justify-between text-sm">
                    <span className="theme-text font-bold truncate">{nameOf(w.learnerId)}</span>
                    <span className="text-red-600 font-black">{formatPercent(w.percentage)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <div className="theme-card border theme-border rounded-radius-md p-3">
          <h3 className="theme-text font-black text-sm mb-1">Perfect attendance</h3>
          {summary.perfectAttendance.length === 0 ? (
            <p className="theme-text-muted text-sm">No perfect records yet this term.</p>
          ) : (
            <ul className="space-y-1">
              {summary.perfectAttendance.map((id) => (
                <li key={id} className="theme-text text-sm font-bold truncate">{nameOf(id)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* threshold config */}
      <div className="theme-card border theme-border rounded-radius-md p-3 flex flex-wrap items-center gap-2">
        <label htmlFor="att-threshold" className="theme-text-muted text-xs font-black uppercase tracking-wider">
          Warn when attendance is below
        </label>
        <input id="att-threshold" type="number" min="0" max="100" value={thresholdDraft}
          onChange={(e) => setThresholdDraft(e.target.value)} disabled={!canEdit}
          className="w-20 rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm font-bold" />
        <span className="theme-text-muted text-sm font-bold">%</span>
        <Button type="button" size="sm" onClick={handleSaveThreshold} loading={savingThreshold} disabled={!canEdit}>
          Save
        </Button>
      </div>
    </div>
  )
}
