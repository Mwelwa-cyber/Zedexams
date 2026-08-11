/**
 * AttendanceSummaryPanel — term-to-date class summary: enrolment, today's
 * counts, aggregate attendance, watch-list / perfect-attendance learners and
 * the monthly trend. All numbers come from attendanceCalculator's
 * computeClassSummary — the same engine the grid, prints and exports use.
 */

import { useMemo, useState } from 'react'
import { computeClassSummary, formatPercent } from '../../../../utils/attendanceCalculator'
import { calendarMetaForTerm, markableDays } from '../../../../utils/attendanceCalendarResolver'
import { saveAttendanceTermSettings } from '../../services/attendanceService'
import { ATTENDANCE_STATUSES, DEFAULT_ATTENDANCE_POLICY } from '../../../../utils/attendanceConstants'
import { useToast } from '../../../../components/ui/Toast'
import Button from '../../../../components/ui/Button'
import ConfirmDialog from '../../../../components/ui/ConfirmDialog'

const BREAK_MODES = [
  { id: 'none', label: 'No mid-term break' },
  { id: 'general', label: 'General school mid-term break' },
  { id: 'ece', label: 'ECE-specific mid-term break (ECE classes only)' },
  { id: 'custom', label: 'Custom break dates' },
]

function Stat({ label, value, tone = 'theme-text', toneColor = null }) {
  // toneColor takes a CSS colour (the --att-*-fg status tokens); tone remains
  // for the theme utility classes. Fixed Tailwind *-700 tones measured
  // 2.3–2.5:1 on the Night surface.
  return (
    <div className="theme-card border theme-border rounded-radius-md px-3 py-2">
      <p className="theme-text-muted text-[11px] font-black uppercase tracking-wider">{label}</p>
      <p className={`${toneColor ? '' : tone} font-black text-lg`} style={toneColor ? { color: toneColor } : undefined}>{value}</p>
    </div>
  )
}

export default function AttendanceSummaryPanel({ registerHook, policy, uid, canEdit }) {
  const { roster, termInfo, termId, daysWithRecords, todayIso, termDoc, termDayDocs, isEceClass } = registerHook
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

  // ── mid-term break configuration (with retro-change guard) ──────
  const breakConfig = termDoc?.midTermBreak || { mode: 'none' }
  const [breakDraft, setBreakDraft] = useState({
    mode: breakConfig.mode || 'none',
    customBreakStart: breakConfig.customBreakStart || '',
    customBreakEnd: breakConfig.customBreakEnd || '',
  })
  const [savingBreak, setSavingBreak] = useState(false)
  const [breakConfirm, setBreakConfirm] = useState(null) // { affectedDates }

  function breakWindowFor(draft) {
    if (draft.mode === 'custom' && draft.customBreakStart && draft.customBreakEnd) {
      return { start: draft.customBreakStart, end: draft.customBreakEnd }
    }
    if ((draft.mode === 'general' || (draft.mode === 'ece' && isEceClass)) && termInfo?.eceMidBreak) {
      return termInfo.eceMidBreak
    }
    return null
  }

  async function persistBreak(draft) {
    setSavingBreak(true)
    try {
      await saveAttendanceTermSettings(registerHook.classId, uid, {
        termId,
        term: termInfo?.termLabel,
        year: termInfo?.year,
      }, {
        midTermBreak: {
          mode: draft.mode,
          customBreakStart: draft.mode === 'custom' ? draft.customBreakStart || null : null,
          customBreakEnd: draft.mode === 'custom' ? draft.customBreakEnd || null : null,
        },
        calendarSource: calendarMetaForTerm(termInfo).source,
        calendarDatasetId: calendarMetaForTerm(termInfo).datasetId,
        calendarVersion: calendarMetaForTerm(termInfo).version,
      })
      toast.success('Mid-term break setting saved.')
    } catch (err) {
      toast.error(`Could not save: ${err.message || 'unexpected error'}`)
    } finally {
      setSavingBreak(false)
      setBreakConfirm(null)
    }
  }

  function handleSaveBreak() {
    if (breakDraft.mode === 'custom' && (!breakDraft.customBreakStart || !breakDraft.customBreakEnd || breakDraft.customBreakStart > breakDraft.customBreakEnd)) {
      toast.error('Enter a valid custom break range (start before end).')
      return
    }
    // Retro guard: enabling a break over dates that already carry attendance
    // requires an explicit confirmation — never a silent retroactive change.
    const window = breakWindowFor(breakDraft)
    if (window) {
      const affected = (termDayDocs || []).filter((d) =>
        d.date >= window.start && d.date <= window.end && Object.keys(d.records || {}).length > 0)
      if (affected.length) {
        setBreakConfirm({ affectedDates: affected.map((d) => d.date) })
        return
      }
    }
    persistBreak(breakDraft)
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
          <Stat label="Present" value={t.present} toneColor={ATTENDANCE_STATUSES.present.screenColor} />
          <Stat label="Absent" value={t.absent} toneColor={ATTENDANCE_STATUSES.absent.screenColor} />
          <Stat label="Sick" value={t.sick} toneColor={ATTENDANCE_STATUSES.sick.screenColor} />
          <Stat label="Late" value={t.late} toneColor={ATTENDANCE_STATUSES.late.screenColor} />
          <Stat label="Excused" value={t.excused} toneColor={ATTENDANCE_STATUSES.excused.screenColor} />
          <Stat label="Unmarked" value={t.unmarked} toneColor={t.unmarked > 0 ? ATTENDANCE_STATUSES.late.screenColor : null} />
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
                    <span className="font-black" style={{ color: ATTENDANCE_STATUSES.absent.screenColor }}>{formatPercent(w.percentage)}</span>
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

      {/* mid-term break config */}
      <div className="theme-card border theme-border rounded-radius-md p-3 space-y-2">
        <h3 className="theme-text font-black text-sm">Mid-term break</h3>
        <p className="theme-text-muted text-xs">
          {calendarMetaForTerm(termInfo).label}
          {termInfo?.eceMidBreak ? ` · preset break window ${termInfo.eceMidBreak.start} → ${termInfo.eceMidBreak.end}` : ''}
          {` · this class is ${isEceClass ? 'an ECE class' : 'not an ECE class'}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={breakDraft.mode} disabled={!canEdit}
            aria-label="Mid-term break mode"
            onChange={(e) => setBreakDraft((d) => ({ ...d, mode: e.target.value }))}
            className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm font-bold">
            {BREAK_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {breakDraft.mode === 'custom' && (
            <>
              <input type="date" value={breakDraft.customBreakStart} disabled={!canEdit} aria-label="Break start"
                onChange={(e) => setBreakDraft((d) => ({ ...d, customBreakStart: e.target.value }))}
                className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm" />
              <span className="theme-text-muted text-sm">to</span>
              <input type="date" value={breakDraft.customBreakEnd} disabled={!canEdit} aria-label="Break end"
                onChange={(e) => setBreakDraft((d) => ({ ...d, customBreakEnd: e.target.value }))}
                className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm" />
            </>
          )}
          <Button type="button" size="sm" onClick={handleSaveBreak} loading={savingBreak} disabled={!canEdit}>
            Save
          </Button>
        </div>
        {breakDraft.mode === 'ece' && !isEceClass && (
          <p className="theme-text-muted text-xs">This class is not ECE, so the ECE break will not exclude any of its days.</p>
        )}
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

      <ConfirmDialog
        open={Boolean(breakConfirm)}
        title="Change the break over marked days?"
        message={breakConfirm
          ? `${breakConfirm.affectedDates.length} day${breakConfirm.affectedDates.length === 1 ? ' already has' : 's already have'} attendance records inside this break window (${breakConfirm.affectedDates.join(', ')}). The marks are kept, but those days become non-markable and drop out of eligible-day totals. Continue?`
          : ''}
        confirmLabel="Apply break"
        onConfirm={() => persistBreak(breakDraft)}
        onCancel={() => setBreakConfirm(null)}
      />
    </div>
  )
}
