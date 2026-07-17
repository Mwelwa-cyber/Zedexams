/**
 * DailyAttendanceView — the mobile-first "mark today" register.
 *
 * One date at a time: prev/next controls + a Mon–Fri strip, learner search,
 * Mark-all-present, per-learner status rows, marking progress, the auto-save
 * indicator with retry, and undo. The fast path is mark-all-present then touch
 * only the exceptions; auto-save happens via useClassRegister's queue.
 */

import { useMemo, useState } from 'react'
import AttendanceLearnerRow from './AttendanceLearnerRow'
import { markableLearnersOn } from '../../../../utils/attendanceDayCore'
import { ATTENDANCE_ERROR_MESSAGES } from '../../../../utils/attendanceService'
import { ATTENDANCE_STATUS_ORDER, ATTENDANCE_STATUSES } from '../../../../utils/attendanceConstants'
import {
  formatDateLong,
  formatDayShort,
  nearestMarkableDate,
  weekStripFor,
} from '../../../../utils/attendanceCalendarResolver'
import { useToast } from '../../../ui/Toast'
import Button from '../../../ui/Button'

const BLOCK_REASON_COPY = {
  future: 'This date is in the future — the register opens on the day.',
  non_teaching: 'Not a teaching day (weekend, holiday or school closure).',
  locked: 'This term’s register is locked. Ask an administrator to reopen it.',
  outside_term: 'This date falls outside the selected term.',
  no_day: 'Pick a date inside the term to mark the register.',
}

// Outbox sync states — an invalid write can never masquerade as saved.
const SAVE_STATE_COPY = {
  idle: null,
  dirty: { label: 'Saved on this device — syncing…', tone: 'theme-text-muted' },
  saving: { label: 'Syncing…', tone: 'theme-text-muted' },
  saved: { label: 'All changes synced', tone: 'text-emerald-600' },
  offline: { label: 'Offline — saved locally, will sync when back online', tone: 'text-amber-600' },
  rejected: { label: 'Some changes were rejected by the server', tone: 'text-red-600' },
  conflict: { label: 'Conflict detected — review below', tone: 'text-amber-600' },
  error: { label: 'Save failed', tone: 'text-red-600' },
}

export default function DailyAttendanceView({ registerHook, canMark }) {
  const {
    roster, termInfo, days, todayIso,
    selectedDate, setSelectedDate, displayedRecords,
    setStatus, setNote, markAllPresent, undoLast, canUndo,
    saveState, pendingCount, pendingLearnerIds, syncIssues, retry, saveNow, hydrated,
    remoteEditNotice, dismissRemoteEditNotice,
    resolveConflict, retryRejected, discardRejected,
  } = registerHook
  const nameOf = (learnerId) => roster.find((l) => l.id === learnerId)?.fullName || learnerId
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')

  const isPastDate = selectedDate && selectedDate < todayIso
  const markOpts = isPastDate ? { correctionReason } : {}

  const eligible = useMemo(
    () => markableLearnersOn(roster, selectedDate, termInfo).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [roster, selectedDate, termInfo],
  )
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return eligible
    return eligible.filter((l) =>
      l.fullName.toLowerCase().includes(q) || (l.learnerNumber || '').toLowerCase().includes(q))
  }, [eligible, search])

  const markedCount = eligible.filter((l) => displayedRecords[l.id]?.status).length
  const counts = useMemo(() => {
    const c = Object.fromEntries(ATTENDANCE_STATUS_ORDER.map((s) => [s, 0]))
    for (const l of eligible) {
      const s = displayedRecords[l.id]?.status
      if (s && s in c) c[s] += 1
    }
    return c
  }, [eligible, displayedRecords])

  const strip = weekStripFor(selectedDate || todayIso, days)
  const prevDate = selectedDate ? nearestMarkableDate(days, selectedDate, -1) : null
  const nextDate = selectedDate ? nearestMarkableDate(days, selectedDate, +1) : null
  const disabled = !canMark.allowed || !hydrated
  const saveCopy = SAVE_STATE_COPY[saveState]

  function handleMarkAll() {
    const n = markAllPresent(markOpts)
    if (n > 0) toast.success(`${n} learner${n === 1 ? '' : 's'} marked present.`)
    else toast.info('Everyone already has a mark.')
  }

  return (
    <div className="space-y-3">
      {/* date navigation */}
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous day" disabled={!prevDate}
          onClick={() => prevDate && setSelectedDate(prevDate)}
          className="w-9 h-9 rounded-radius-md border theme-border theme-card theme-text font-black disabled:opacity-30">‹</button>
        <p className="theme-text font-black text-sm sm:text-base text-center">
          {selectedDate ? formatDateLong(selectedDate) : 'No date selected'}
        </p>
        <button type="button" aria-label="Next day" disabled={!nextDate}
          onClick={() => nextDate && setSelectedDate(nextDate)}
          className="w-9 h-9 rounded-radius-md border theme-border theme-card theme-text font-black disabled:opacity-30">›</button>
      </div>

      {/* Mon–Fri strip */}
      {strip.length > 0 && (
        <div className="grid grid-cols-5 gap-1">
          {strip.map((d) => {
            const active = d.date === selectedDate
            return (
              <button key={d.date} type="button" disabled={!d.markable && !active}
                onClick={() => setSelectedDate(d.date)}
                title={d.holidayName || d.closureLabel || undefined}
                className={`rounded-radius-md border px-1 py-1.5 text-xs font-black
                  ${active ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-card theme-border theme-text-muted'}
                  ${!d.markable && !active ? 'opacity-35' : ''}`}
              >
                {formatDayShort(d.date)}
              </button>
            )
          })}
        </div>
      )}

      {/* server rejections + conflicts: always visible, never silently dropped */}
      {(syncIssues || []).map((issue) => (
        <div key={`${issue.kind}-${issue.date}`} role="alert"
          className={`rounded-radius-md border px-3 py-2 text-xs space-y-1.5 ${
            issue.kind === 'conflict' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-800'
          }`}>
          <p className="font-bold">
            {issue.kind === 'conflict'
              ? `${formatDateLong(issue.date)}: another teacher also changed ${issue.learnerIds.map(nameOf).join(', ')}.`
              : `${formatDateLong(issue.date)}: ${ATTENDANCE_ERROR_MESSAGES[issue.code] || 'The server rejected this change.'}`}
          </p>
          <div className="flex gap-2">
            {issue.kind === 'conflict' ? (
              <>
                <button type="button" className="font-black underline" onClick={() => resolveConflict(issue.date, 'mine')}>Keep my marks</button>
                <button type="button" className="font-black underline" onClick={() => resolveConflict(issue.date, 'theirs')}>Keep theirs</button>
              </>
            ) : (
              <>
                <button type="button" className="font-black underline" onClick={() => retryRejected(issue.date)}>Retry</button>
                <button type="button" className="font-black underline" onClick={() => discardRejected(issue.date)}>Discard my changes</button>
              </>
            )}
          </div>
        </div>
      ))}

      {remoteEditNotice && (
        <div role="status" className="rounded-radius-md border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold px-3 py-2 flex justify-between gap-2">
          <span>Another device updated this day&apos;s register — the latest marks are shown.</span>
          <button type="button" className="font-black" onClick={dismissRemoteEditNotice}>Dismiss</button>
        </div>
      )}

      {!canMark.allowed && (
        <div role="status" className="rounded-radius-md border theme-border theme-card px-3 py-2 text-sm theme-text-muted font-bold">
          {BLOCK_REASON_COPY[canMark.reason] || 'Marking is unavailable for this date.'}
        </div>
      )}

      {isPastDate && canMark.allowed && (
        <div className="rounded-radius-md border border-amber-300 bg-amber-50 px-3 py-2 space-y-1">
          <p className="text-amber-800 text-xs font-bold">You are correcting a past register day — changes are recorded in the audit trail.</p>
          <input type="text" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)}
            placeholder="Reason for correction (optional)" maxLength={200}
            className="w-full rounded-radius-md border theme-border theme-card theme-text px-2.5 py-1.5 text-xs" />
        </div>
      )}

      {/* search + mark all */}
      <div className="flex gap-2">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search learner…" aria-label="Search learner"
          className="flex-1 rounded-radius-md border theme-border theme-card theme-text px-3 py-2 text-sm" />
        <Button type="button" size="sm" onClick={handleMarkAll} disabled={disabled}>
          Mark all present
        </Button>
      </div>

      {/* progress + save state */}
      <div className="flex items-center justify-between text-xs font-bold">
        <span className="theme-text-muted">{markedCount} of {eligible.length} marked</span>
        <span className="flex items-center gap-2">
          {markedCount < eligible.length && eligible.length > 0 && (
            <span className="text-amber-600">{eligible.length - markedCount} unmarked</span>
          )}
          {saveCopy && <span className={saveCopy.tone} role="status">{saveCopy.label}</span>}
        </span>
      </div>

      {/* learner rows */}
      {eligible.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center">
          <p className="theme-text font-black text-sm">No learners are enrolled for this date.</p>
          <p className="theme-text-muted text-xs mt-1">Add learners in the Roster section, or check their joined/left dates.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((learner) => (
            <AttendanceLearnerRow
              key={learner.id}
              position={learner.order || eligible.indexOf(learner) + 1}
              learner={learner}
              record={displayedRecords[learner.id]}
              onStatus={(id, status) => setStatus(id, status, markOpts)}
              onNote={(id, note) => setNote(id, note, markOpts)}
              disabled={disabled}
              pending={saveState !== 'saved' && Boolean(pendingLearnerIds?.has(learner.id))}
            />
          ))}
          {visible.length === 0 && (
            <li className="theme-text-muted text-sm text-center py-4">No learner matches “{search}”.</li>
          )}
        </ul>
      )}

      {/* footer: counts + undo + save controls */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ATTENDANCE_STATUS_ORDER.map((s) => (
          <span key={s} className={`px-2 py-1 rounded-radius-md border text-xs font-black ${ATTENDANCE_STATUSES[s].chipClass}`}>
            {ATTENDANCE_STATUSES[s].symbol} {counts[s]}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          const undone = undoLast()
          if (undone) toast.info('Last change undone.')
        }} disabled={!canUndo}>
          ↺ Undo last change
        </Button>
        {(saveState === 'error' || saveState === 'offline' || saveState === 'rejected') ? (
          <Button type="button" size="sm" onClick={retry}>Retry save</Button>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => saveNow()} disabled={pendingCount === 0}>
            Save now
          </Button>
        )}
      </div>
    </div>
  )
}
