/**
 * MarkAttendanceView — marking one day's register for a class of 80 or more.
 *
 * EXCEPTION-FIRST (§11). In a Zambian classroom nearly everybody is present
 * nearly every day, so the workflow is: press Mark all present once, then
 * touch only the four children who are not. Tapping eighty-six buttons to
 * record eighty-two present learners is the thing this screen exists to
 * abolish, and every other decision here follows from it — the filters lead
 * with Unmarked and Absent, the counts are live so the teacher can see when
 * the day is done, and Undo is always one press away.
 *
 * UNMARKED IS NOT ABSENT, anywhere, ever. A learner nobody has marked is a
 * piece of paperwork that is not finished; a learner marked absent is a
 * statement about a child. They are counted separately, coloured differently,
 * filtered separately, and the summary and the printed register keep them
 * apart. Collapsing the two would silently accuse every child on a day the
 * teacher ran out of time.
 *
 * Three ways to work, and the teacher chooses:
 *   list         — scroll the class (the default everywhere)
 *   one-by-one   — one learner filling the screen, for calling the roll
 *   keyboard     — P/A/S/L/E and Delete on a desktop, one row at a time
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markableLearnersOn } from '../../../../utils/attendanceDayCore'
import {
  ATTENDANCE_ERROR_MESSAGES, ATTENDANCE_STATUS_ORDER, ATTENDANCE_STATUSES,
} from '../../../../utils/attendanceConstants'
import { learnerMatchesQuery } from '../../../../utils/classListCore'
import {
  formatDateLong, nearestMarkableDate,
} from '../../../../utils/attendanceCalendarResolver'
import { useToast } from '../../../ui/Toast'
import Button from '../../../ui/Button'
import useIsMobile from '../../dashboardV2/useIsMobile'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  CloudOff, Keyboard, Search, Undo2,
} from '../../../../shared/icons/classListIcons'

const BLOCK_REASON_COPY = {
  future: 'This date is in the future — the register opens on the day.',
  non_teaching: 'Today is not a scheduled teaching day. Attendance cannot be marked.',
  locked: 'This term’s register is locked. Ask an administrator to reopen it.',
  outside_term: 'This date falls outside the selected term.',
  no_day: 'Pick a date inside the term to mark the register.',
}

const SAVE_STATE_COPY = {
  idle: null,
  dirty: { label: 'Saved on this device — waiting to synchronise', tone: 'theme-text-muted' },
  saving: { label: 'Synchronising…', tone: 'theme-text-muted' },
  saved: { label: 'All changes synchronised', tone: 'text-emerald-700', ok: true },
  offline: { label: 'Saved on this device — will synchronise when you are back online', tone: 'text-amber-700', offline: true },
  rejected: { label: 'Some changes were rejected by the server', tone: 'text-red-700' },
  conflict: { label: 'Conflict detected — review below', tone: 'text-amber-700' },
  error: { label: 'Save failed', tone: 'text-red-700' },
}

/** The three statuses on the row, and everything else behind More (§11). */
const QUICK_STATUSES = ['present', 'absent', 'sick']
const MORE_STATUSES = ['late', 'excused', 'not_applicable']

/** Desktop keyboard shortcuts. Delete/Backspace clears (§11). */
const KEY_TO_STATUS = {
  p: 'present', a: 'absent', s: 'sick', l: 'late', e: 'excused', n: 'not_applicable',
}

const ROW_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unmarked', label: 'Unmarked' },
  { value: 'absent', label: 'Absent' },
  { value: 'sick', label: 'Sick' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'edited', label: 'Recently edited' },
]

function StatusButton({ status, active, onClick, disabled, learnerName }) {
  const cfg = ATTENDANCE_STATUSES[status]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      // The letter alone is meaningless to a screen reader and to anyone who
      // has not learnt the register's key, so the accessible name spells it.
      aria-label={`${cfg.label} — ${learnerName}`}
      className={`w-11 h-11 sm:w-10 sm:h-10 rounded-radius-sm border text-sm font-black transition-colors disabled:opacity-40 ${
        active ? cfg.activeClass : `theme-card ${cfg.chipClass}`
      }`}
    >
      {cfg.symbol}
    </button>
  )
}

function MoreMenu({ learner, status, onStatus, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const activeExtra = MORE_STATUSES.includes(status) ? ATTENDANCE_STATUSES[status] : null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`More attendance options for ${learner.fullName}`}
        className={`h-11 sm:h-10 px-2.5 rounded-radius-sm border text-xs font-black disabled:opacity-40 ${
          activeExtra ? activeExtra.activeClass : 'theme-card theme-border theme-text-muted'
        }`}
      >
        {activeExtra ? activeExtra.symbol : 'More'}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 theme-card border theme-border rounded-radius-sm shadow-lg py-1">
          {MORE_STATUSES.map((s) => (
            <button key={s} type="button"
              onClick={() => { onStatus(learner.id, s); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 min-h-[44px] text-sm font-bold theme-text hover:theme-bg-subtle">
              <span className="inline-block w-5 font-black">{ATTENDANCE_STATUSES[s].symbol}</span>
              {ATTENDANCE_STATUSES[s].label}
            </button>
          ))}
          <button type="button"
            onClick={() => { onStatus(learner.id, null); setOpen(false) }}
            disabled={!status}
            className="w-full text-left px-3 py-2.5 min-h-[44px] text-sm font-bold theme-text-muted hover:theme-bg-subtle disabled:opacity-40 border-t theme-border">
            Clear status
          </button>
        </div>
      )}
    </div>
  )
}

/** One learner, in list mode. Memoised so marking one does not repaint 86. */
function LearnerRow({
  learner, position, record, onStatus, onNote, disabled, pending, focused, onFocus,
}) {
  const status = record?.status || null
  const [noteOpen, setNoteOpen] = useState(Boolean(record?.note))

  return (
    <li
      onFocus={onFocus}
      onClick={onFocus}
      className={`flex flex-wrap items-center gap-2 px-2 sm:px-3 py-2 border-b theme-border ${
        focused ? 'theme-bg-subtle ring-1 ring-inset ring-current/20' : ''
      } ${!status ? 'bg-amber-50/40' : ''}`}
    >
      <span className="w-7 shrink-0 theme-text-muted text-xs font-black tabular-nums text-right">{position}</span>
      <span className="hidden sm:block w-24 shrink-0 theme-text-muted text-xs tabular-nums truncate">
        {learner.admissionNumber || '—'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block theme-text font-bold text-sm truncate">{learner.fullName}</span>
        {record?.note && (
          <span className="block theme-accent-text text-xs truncate">{record.note}</span>
        )}
        {!status && <span className="block text-amber-700 text-xs font-bold sm:hidden">Not marked</span>}
      </span>

      <span className="flex items-center gap-1 shrink-0">
        {QUICK_STATUSES.map((s) => (
          <StatusButton key={s} status={s} active={status === s} disabled={disabled}
            learnerName={learner.fullName}
            onClick={() => onStatus(learner.id, status === s ? null : s)} />
        ))}
        <MoreMenu learner={learner} status={status} onStatus={onStatus} disabled={disabled} />
        <button type="button" onClick={() => setNoteOpen((v) => !v)} disabled={disabled || !status}
          aria-expanded={noteOpen}
          aria-label={`${record?.note ? 'Edit' : 'Add'} a note for ${learner.fullName}`}
          className={`w-11 h-11 sm:w-10 sm:h-10 grid place-items-center rounded-radius-sm border theme-border disabled:opacity-40 ${
            record?.note ? 'theme-accent-text' : 'theme-text-muted'
          }`}>
          <span aria-hidden="true" className="text-sm">✎</span>
        </button>
      </span>

      {pending && (
        <span className="text-amber-700 text-[11px] font-black w-full sm:w-auto">Not yet synchronised</span>
      )}

      {noteOpen && status && (
        <input
          type="text"
          value={record?.note || ''}
          onChange={(e) => onNote(learner.id, e.target.value)}
          disabled={disabled}
          maxLength={200}
          placeholder="Note — e.g. sick note received"
          aria-label={`Note for ${learner.fullName}`}
          className="w-full mt-1 rounded-radius-sm border theme-border theme-card theme-text px-2.5 py-2 text-sm min-h-[44px]"
        />
      )}
    </li>
  )
}

// Memoised: marking one learner must not repaint the other eighty-five.
const MemoLearnerRow = memo(LearnerRow)

export default function MarkAttendanceView({ registerHook, canMark }) {
  const {
    roster, termInfo, days, todayIso,
    selectedDate, setSelectedDate, displayedRecords,
    setStatus, setNote, markAllPresent, undoLast, canUndo,
    saveState, pendingCount, pendingLearnerIds, syncIssues, retry, saveNow, hydrated,
    remoteEditNotice, dismissRemoteEditNotice,
    resolveConflict, retryRejected, discardRejected,
  } = registerHook

  const toast = useToast()
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')
  const [rowFilter, setRowFilter] = useState('all')
  const [mode, setMode] = useState('list')        // 'list' | 'one'
  const [oneIndex, setOneIndex] = useState(0)
  const [focusedId, setFocusedId] = useState(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [recentlyEdited, setRecentlyEdited] = useState(() => new Set())

  const nameOf = useCallback(
    (learnerId) => roster.find((l) => l.id === learnerId)?.fullName || learnerId,
    [roster],
  )

  const isPastDate = selectedDate && selectedDate < todayIso
  const markOpts = useMemo(() => (isPastDate ? { correctionReason } : {}), [isPastDate, correctionReason])

  /** Learners enrolled on this date, in register order. */
  const eligible = useMemo(
    () => markableLearnersOn(roster, selectedDate, termInfo).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [roster, selectedDate, termInfo],
  )

  const counts = useMemo(() => {
    const c = Object.fromEntries(ATTENDANCE_STATUS_ORDER.map((s) => [s, 0]))
    c.unmarked = 0
    for (const learner of eligible) {
      const status = displayedRecords[learner.id]?.status
      // An unmarked learner is counted as unmarked — never folded into absent.
      if (status && status in c) c[status] += 1
      else c.unmarked += 1
    }
    c.total = eligible.length
    c.marked = eligible.length - c.unmarked
    return c
  }, [eligible, displayedRecords])

  const visible = useMemo(() => {
    let rows = eligible
    if (rowFilter === 'unmarked') rows = rows.filter((l) => !displayedRecords[l.id]?.status)
    else if (rowFilter === 'absent') rows = rows.filter((l) => displayedRecords[l.id]?.status === 'absent')
    else if (rowFilter === 'sick') rows = rows.filter((l) => displayedRecords[l.id]?.status === 'sick')
    else if (rowFilter === 'needs_review') rows = rows.filter((l) => l.needsReview)
    else if (rowFilter === 'edited') rows = rows.filter((l) => recentlyEdited.has(l.id))
    if (search.trim()) rows = rows.filter((l) => learnerMatchesQuery(l, search))
    return rows
  }, [eligible, rowFilter, search, displayedRecords, recentlyEdited])

  const disabled = !canMark.allowed || !hydrated

  const handleStatus = useCallback((learnerId, status) => {
    setStatus(learnerId, status, markOpts)
    setRecentlyEdited((prev) => {
      const next = new Set(prev)
      next.add(learnerId)
      return next
    })
  }, [setStatus, markOpts])

  const handleNote = useCallback(
    (learnerId, note) => setNote(learnerId, note, markOpts),
    [setNote, markOpts],
  )

  // ── keyboard ───────────────────────────────────────────────────
  //
  // Bound at the document, but suppressed the moment the teacher is typing
  // into any field (§11) — otherwise searching for "Phiri" would mark four
  // learners present, sick, and absent on the way.
  useEffect(() => {
    if (isMobile || disabled) return undefined
    function onKey(e) {
      const el = e.target
      const typing = el instanceof HTMLElement && (
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
      )
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const rows = mode === 'one' ? visible.slice(oneIndex, oneIndex + 1) : visible
      const current = mode === 'one'
        ? rows[0]
        : (visible.find((l) => l.id === focusedId) || visible[0])
      if (!current) return

      const key = e.key.toLowerCase()
      if (KEY_TO_STATUS[key]) {
        e.preventDefault()
        handleStatus(current.id, KEY_TO_STATUS[key])
        if (mode === 'one') setOneIndex((i) => Math.min(i + 1, visible.length - 1))
        else {
          const index = visible.indexOf(current)
          if (index >= 0 && index + 1 < visible.length) setFocusedId(visible[index + 1].id)
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleStatus(current.id, null)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (mode === 'one') setOneIndex((i) => Math.min(i + 1, visible.length - 1))
        else {
          const index = visible.indexOf(current)
          setFocusedId(visible[Math.min(index + 1, visible.length - 1)]?.id ?? null)
        }
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (mode === 'one') setOneIndex((i) => Math.max(i - 1, 0))
        else {
          const index = visible.indexOf(current)
          setFocusedId(visible[Math.max(index - 1, 0)]?.id ?? null)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMobile, disabled, mode, visible, focusedId, oneIndex, handleStatus])

  const prevDate = selectedDate ? nearestMarkableDate(days, selectedDate, -1) : null
  const nextDate = selectedDate ? nearestMarkableDate(days, selectedDate, +1) : null
  const saveCopy = SAVE_STATE_COPY[saveState]

  function handleMarkAll() {
    const n = markAllPresent(markOpts)
    if (n > 0) toast.success(`${n} learner${n === 1 ? '' : 's'} marked present. Now change only the exceptions.`)
    else toast.info('Everyone already has a mark for this day.')
  }

  const oneLearner = visible[Math.min(oneIndex, Math.max(0, visible.length - 1))] || null

  return (
    <div className="space-y-3">
      {/* ── the day ── */}
      <div className="theme-card border theme-border rounded-radius-md p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-radius-sm theme-accent-fill theme-on-accent shrink-0">
            <CalendarDays size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="theme-text font-display font-black text-base sm:text-lg">
              {selectedDate ? formatDateLong(selectedDate) : 'No date selected'}
            </p>
            <p className="theme-text-muted text-sm tabular-nums">
              {counts.marked} of {counts.total} learners marked
            </p>
          </div>
          <Button type="button" onClick={handleMarkAll} disabled={disabled}
            className="ml-auto min-h-[48px]">
            Mark all present
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" disabled={!prevDate} onClick={() => prevDate && setSelectedDate(prevDate)}
            className="inline-flex items-center gap-1 h-11 px-3 rounded-radius-sm border theme-border theme-card theme-text text-sm font-black disabled:opacity-30">
            <ChevronLeft size={16} aria-hidden="true" /> Previous day
          </button>
          <label className="relative">
            <span className="sr-only">Choose a date</span>
            <input type="date" value={selectedDate || ''} min={termInfo?.startDate} max={termInfo?.endDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="h-11 px-3 rounded-radius-sm border theme-border theme-card theme-text text-sm font-bold" />
          </label>
          <button type="button" disabled={!nextDate} onClick={() => nextDate && setSelectedDate(nextDate)}
            className="inline-flex items-center gap-1 h-11 px-3 rounded-radius-sm border theme-border theme-card theme-text text-sm font-black disabled:opacity-30">
            Next day <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        {/* ── live totals. Unmarked is its own tile, and is never absent. ── */}
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-1.5" aria-label="Attendance totals for this day">
          {ATTENDANCE_STATUS_ORDER.map((s) => (
            <li key={s} className={`rounded-radius-sm border px-2 py-1.5 ${ATTENDANCE_STATUSES[s].chipClass}`}>
              <p className="text-[10px] font-black uppercase tracking-wide truncate">{ATTENDANCE_STATUSES[s].shortLabel}</p>
              <p className="font-black text-lg tabular-nums">{counts[s]}</p>
            </li>
          ))}
          <li className={`rounded-radius-sm border px-2 py-1.5 ${counts.unmarked ? 'bg-amber-50 border-amber-300 text-amber-900' : 'theme-card theme-border theme-text-muted'}`}>
            <p className="text-[10px] font-black uppercase tracking-wide">Unmarked</p>
            <p className="font-black text-lg tabular-nums">{counts.unmarked}</p>
          </li>
          <li className="rounded-radius-sm border theme-border theme-card px-2 py-1.5">
            <p className="theme-text-muted text-[10px] font-black uppercase tracking-wide">Total</p>
            <p className="theme-text font-black text-lg tabular-nums">{counts.total}</p>
          </li>
        </ul>
      </div>

      {/* ── blockers and notices ── */}
      {!canMark.allowed && (
        <p role="status" className="flex items-start gap-2 rounded-radius-sm border theme-border theme-card px-3 py-2.5 theme-text text-sm font-bold">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
          {BLOCK_REASON_COPY[canMark.reason] || 'Marking is unavailable for this date.'}
        </p>
      )}

      {(syncIssues || []).map((issue) => (
        <div key={`${issue.kind}-${issue.date}`} role="alert"
          className={`rounded-radius-sm border px-3 py-2 text-xs space-y-1.5 ${
            issue.kind === 'conflict' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-800'
          }`}>
          <p className="font-bold">
            {issue.kind === 'conflict'
              ? `${formatDateLong(issue.date)}: another device also changed ${issue.learnerIds.map(nameOf).join(', ')}.`
              : `${formatDateLong(issue.date)}: ${ATTENDANCE_ERROR_MESSAGES[issue.code] || 'The server rejected this change.'}`}
          </p>
          <div className="flex gap-3">
            {issue.kind === 'conflict' ? (
              <>
                <button type="button" className="font-black underline min-h-[36px]" onClick={() => resolveConflict(issue.date, 'mine')}>Keep my marks</button>
                <button type="button" className="font-black underline min-h-[36px]" onClick={() => resolveConflict(issue.date, 'theirs')}>Keep theirs</button>
              </>
            ) : (
              <>
                <button type="button" className="font-black underline min-h-[36px]" onClick={() => retryRejected(issue.date)}>Retry</button>
                <button type="button" className="font-black underline min-h-[36px]" onClick={() => discardRejected(issue.date)}>Discard my changes</button>
              </>
            )}
          </div>
        </div>
      ))}

      {remoteEditNotice && (
        <div role="status" className="rounded-radius-sm border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold px-3 py-2 flex justify-between gap-2">
          <span>Another device updated this day’s register — the latest marks are shown.</span>
          <button type="button" className="font-black underline" onClick={dismissRemoteEditNotice}>Dismiss</button>
        </div>
      )}

      {isPastDate && canMark.allowed && (
        <div className="rounded-radius-sm border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5">
          <p className="text-amber-900 text-xs font-bold">
            You are correcting a past register day. The change is recorded in the audit trail.
          </p>
          <input type="text" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)}
            placeholder="Reason for the correction (optional)" maxLength={200}
            aria-label="Reason for correcting a past day"
            className="w-full rounded-radius-sm border theme-border theme-card theme-text px-2.5 py-2 text-xs min-h-[44px]" />
        </div>
      )}

      {/* ── find and filter ── */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted pointer-events-none" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search learner or number…" aria-label="Search learner"
            className="w-full h-11 pl-9 pr-3 rounded-radius-sm border theme-border theme-card theme-text text-sm" />
        </div>
        {!isMobile && (
          <button type="button" onClick={() => setShowShortcuts((v) => !v)}
            aria-expanded={showShortcuts}
            className="inline-flex items-center gap-1.5 h-11 px-3 rounded-radius-sm border theme-border theme-card theme-text-muted text-xs font-black">
            <Keyboard size={15} aria-hidden="true" /> Keys
          </button>
        )}
        <div className="inline-flex rounded-radius-sm border theme-border overflow-hidden">
          {[{ value: 'list', label: 'List' }, { value: 'one', label: 'One by one' }].map((m) => (
            <button key={m.value} type="button" onClick={() => { setMode(m.value); setOneIndex(0) }}
              aria-pressed={mode === m.value}
              className={`h-11 px-3 text-xs font-black ${mode === m.value ? 'theme-accent-fill theme-on-accent' : 'theme-card theme-text-muted'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {showShortcuts && !isMobile && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-radius-sm theme-card border theme-border px-3 py-2 text-xs">
          {[['P', 'Present'], ['A', 'Absent'], ['S', 'Sick'], ['L', 'Late'], ['E', 'Excused'], ['N', 'Not applicable'], ['Delete', 'Clear'], ['↑ ↓', 'Move']].map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <dt className="theme-text font-black border theme-border rounded-radius-xs px-1.5">{key}</dt>
              <dd className="theme-text-muted">{label}</dd>
            </span>
          ))}
          <span className="theme-text-muted w-full">Shortcuts pause while you are typing in a field.</span>
        </dl>
      )}

      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        {ROW_FILTERS.map((f) => {
          const count = f.value === 'all' ? counts.total
            : f.value === 'unmarked' ? counts.unmarked
              : f.value === 'absent' ? counts.absent
                : f.value === 'sick' ? counts.sick
                  : f.value === 'needs_review' ? eligible.filter((l) => l.needsReview).length
                    : recentlyEdited.size
          return (
            <button key={f.value} type="button" onClick={() => setRowFilter(f.value)}
              aria-pressed={rowFilter === f.value}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-radius-pill border text-xs font-black ${
                rowFilter === f.value ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-card theme-border theme-text-muted'
              }`}>
              {f.label} <span className="tabular-nums opacity-80">{count}</span>
            </button>
          )
        })}
      </div>

      {/* ── the learners ── */}
      {eligible.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center">
          <p className="theme-text font-black text-sm">No learners are enrolled for this date.</p>
          <p className="theme-text-muted text-xs mt-1">
            Add learners on the Class List, or check their admission and leaving dates.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center">
          <p className="theme-text font-black text-sm">Nothing matches this filter.</p>
          <button type="button" onClick={() => { setRowFilter('all'); setSearch('') }}
            className="theme-accent-text text-xs font-black mt-2 min-h-[44px]">Show everyone</button>
        </div>
      ) : mode === 'one' && oneLearner ? (
        /* ── one-by-one: calling the roll ── */
        <div className="theme-card border theme-border rounded-radius-lg p-5 text-center space-y-4">
          <p className="theme-text-muted text-xs font-black uppercase tracking-wider tabular-nums">
            Learner {Math.min(oneIndex, visible.length - 1) + 1} of {visible.length}
          </p>
          <div>
            <p className="theme-text font-display font-black text-2xl">{oneLearner.fullName}</p>
            <p className="theme-text-muted text-sm tabular-nums mt-0.5">
              {oneLearner.admissionNumber || 'No admission number'}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_STATUSES.map((s) => {
              const cfg = ATTENDANCE_STATUSES[s]
              const active = displayedRecords[oneLearner.id]?.status === s
              return (
                <button key={s} type="button" disabled={disabled}
                  onClick={() => {
                    handleStatus(oneLearner.id, s)
                    setOneIndex((i) => Math.min(i + 1, visible.length - 1))
                  }}
                  className={`min-w-[110px] min-h-[56px] px-5 rounded-radius-md border text-base font-black disabled:opacity-40 ${
                    active ? cfg.activeClass : `theme-card ${cfg.chipClass}`
                  }`}>
                  {cfg.label}
                </button>
              )
            })}
            <div className="inline-flex items-center">
              <MoreMenu learner={oneLearner} status={displayedRecords[oneLearner.id]?.status || null}
                onStatus={handleStatus} disabled={disabled} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button type="button" variant="secondary" disabled={oneIndex === 0}
              onClick={() => setOneIndex((i) => Math.max(0, i - 1))}
              leadingIcon={<ChevronLeft size={16} aria-hidden="true" />} className="min-h-[48px]">
              Previous learner
            </Button>
            <Button type="button" variant="secondary" disabled={oneIndex >= visible.length - 1}
              onClick={() => setOneIndex((i) => Math.min(visible.length - 1, i + 1))}
              className="min-h-[48px]">
              Next learner
            </Button>
          </div>
        </div>
      ) : (
        <ul className="theme-card border theme-border rounded-radius-md overflow-hidden" aria-label="Learners">
          {visible.map((learner) => (
            <MemoLearnerRow
              key={learner.id}
              learner={learner}
              position={eligible.indexOf(learner) + 1}
              record={displayedRecords[learner.id]}
              onStatus={handleStatus}
              onNote={handleNote}
              disabled={disabled}
              pending={saveState !== 'saved' && Boolean(pendingLearnerIds?.has(learner.id))}
              focused={!isMobile && focusedId === learner.id}
              onFocus={() => setFocusedId(learner.id)}
            />
          ))}
        </ul>
      )}

      {/* ── save state + undo ── */}
      <div className="flex flex-wrap items-center gap-2">
        {saveCopy && (
          <span role="status" className={`inline-flex items-center gap-1.5 text-xs font-bold ${saveCopy.tone}`}>
            {saveCopy.ok ? <CheckCircle2 size={14} aria-hidden="true" />
              : saveCopy.offline ? <CloudOff size={14} aria-hidden="true" /> : null}
            {saveCopy.label}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button type="button" size="sm" variant="ghost" onClick={() => {
            if (undoLast()) toast.info('Last change undone.')
          }} disabled={!canUndo} leadingIcon={<Undo2 size={15} aria-hidden="true" />}>
            Undo
          </Button>
          {(saveState === 'error' || saveState === 'offline' || saveState === 'rejected') ? (
            <Button type="button" size="sm" onClick={retry}>Retry</Button>
          ) : (
            <Button type="button" size="sm" variant="secondary" onClick={() => saveNow()} disabled={pendingCount === 0}>
              Save now
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
