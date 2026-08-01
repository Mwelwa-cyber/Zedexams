/**
 * AttendanceGridView — the desktop/tablet term grid: learners as rows,
 * teaching dates as columns, week/month separators, sticky name column and
 * date headers, row + class totals, keyboard navigation, clickable cells.
 *
 * Renders ONE MONTH of columns at a time (month tabs) so a 100-day term with
 * 60 learners never mounts thousands of interactive cells at once; rows are
 * memoised so marking one cell re-renders one row. Row totals always cover
 * the WHOLE term, via the same attendanceCalculator engine as every other
 * surface.
 */

import { memo, useMemo, useRef, useState } from 'react'
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_ORDER, MARKABLE_STATUSES } from '../../../../utils/attendanceConstants'
import { computeLearnerTotals, formatPercent, isLearnerEligibleOn } from '../../../../utils/attendanceCalculator'
import { groupDaysByMonth, groupDaysByWeek, markableDays } from '../../../../utils/attendanceCalendarResolver'

// Click cycles through the statuses in marking order; keyboard uses the same.
function nextStatus(current) {
  const i = MARKABLE_STATUSES.indexOf(current)
  return MARKABLE_STATUSES[(i + 1) % MARKABLE_STATUSES.length]
}

const GridRow = memo(function GridRow({
  learner, position, weeks, termWindow, totals, hasMarks, disabled, onCell, registerRef, firstCellKey,
}) {
  return (
    <tr className="border-b theme-border">
      <td className="sticky left-0 z-10 theme-card px-2 py-1 text-xs font-black theme-text-muted text-right">{position}</td>
      <td className="sticky left-8 z-10 theme-card px-2 py-1 text-xs theme-text-muted whitespace-nowrap">{learner.learnerNumber || '—'}</td>
      <td className="sticky left-28 z-10 theme-card px-2 py-1 text-sm font-bold theme-text whitespace-nowrap max-w-[160px] truncate">{learner.fullName}</td>
      {weeks.map((week) => week.days.map((day, di) => {
        const eligible = isLearnerEligibleOn(learner, day.date, termWindow)
        const record = day.records?.[learner.id]
        const cfg = record?.status ? ATTENDANCE_STATUSES[record.status] : null
        const editable = !disabled && day.markable && eligible
        const cellKey = `${learner.id}|${day.date}`
        return (
          <td key={day.date} className={`p-0 text-center ${di === 0 ? 'border-l theme-border' : ''}`}>
            <button
              type="button"
              ref={(el) => registerRef(cellKey, el)}
              data-cell={cellKey}
              disabled={!editable && !cfg}
              tabIndex={cellKey === firstCellKey ? 0 : -1}
              title={`${learner.fullName} — ${day.date}${record?.note ? ` · ${record.note}` : ''}`}
              aria-label={`${learner.fullName}, ${day.date}: ${cfg ? cfg.label : eligible ? 'unmarked' : 'not enrolled'}`}
              onClick={() => { if (editable) onCell(day.date, learner.id, nextStatus(record?.status)) }}
              className={`w-9 h-8 text-xs font-black focus:outline-none focus:ring-2 focus:ring-blue-400
                ${cfg ? '' : 'theme-text-muted'} ${editable ? 'hover:bg-black/5' : 'cursor-default'}
                ${day.isToday ? 'bg-amber-50' : ''}`}
              style={cfg ? { color: cfg.printColor } : undefined}
            >
              {cfg ? cfg.symbol : eligible ? (day.markable ? '·' : '') : '–'}
            </button>
          </td>
        )
      }))}
      <td className="px-2 py-1 text-xs font-black text-center text-green-700 border-l theme-border">{totals.presentDays}</td>
      <td className="px-2 py-1 text-xs font-black text-center text-red-700">{totals.absentDays}</td>
      <td className="px-2 py-1 text-xs font-black text-center text-blue-700">{totals.sickDays}</td>
      <td className="px-2 py-1 text-xs font-black text-center text-amber-700">{totals.lateDays}</td>
      <td className="px-2 py-1 text-xs font-black text-center text-purple-700">{totals.excusedDays}</td>
      <td className="px-2 py-1 text-xs font-black text-center theme-text-muted">{totals.eligibleDays}</td>
      {/* No marks yet → the formula has nothing to say. formatPercent already
          renders '—' for null; this gate is belt-and-braces for a draft term. */}
      <td
        className="px-2 py-1 text-xs font-black text-center theme-text whitespace-nowrap"
        title={hasMarks ? undefined : 'Calculates as you mark'}
      >
        {hasMarks ? formatPercent(totals.attendancePercentage) : '—'}
      </td>
    </tr>
  )
})

export default function AttendanceGridView({
  registerHook, canEdit, policy, monthKey: monthKeyProp = null, onMonthChange = null,
}) {
  const { roster, termInfo, daysWithRecords, todayIso, setStatusOn } = registerHook
  const months = useMemo(() => groupDaysByMonth(daysWithRecords), [daysWithRecords])
  const defaultMonth = useMemo(() => {
    const current = months.find((m) => m.key === todayIso.slice(0, 7))
    return (current || months[months.length - 1])?.key || null
  }, [months, todayIso])
  // Month selection normally lives in AttendanceWorkspace (one control drives
  // grid + paper preview); the local state is a fallback for standalone use.
  const [localMonthKey, setLocalMonthKey] = useState(null)
  const monthKey = monthKeyProp ?? localMonthKey
  const setMonthKey = onMonthChange ?? setLocalMonthKey
  const activeMonth = months.find((m) => m.key === (monthKey || defaultMonth)) || months[0]

  // Coarse pointer (touch) → "tap" wording, no keyboard hint. Detected once —
  // the input class of a device doesn't change mid-session.
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches),
  )

  const learners = useMemo(
    () => [...roster].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [roster],
  )
  const termWindow = useMemo(
    () => ({ startDate: termInfo?.startDate, endDate: termInfo?.endDate }),
    [termInfo],
  )

  const weeks = useMemo(
    () => (activeMonth ? groupDaysByWeek(activeMonth.days, termInfo?.startDate) : []),
    [activeMonth, termInfo],
  )
  const shownDays = useMemo(() => weeks.flatMap((w) => w.days), [weeks])

  // Whole-term totals per learner (the shared engine — matches print/exports).
  const totalsByLearner = useMemo(() => {
    const map = new Map()
    for (const learner of learners) {
      map.set(learner.id, computeLearnerTotals({ learner, days: daysWithRecords, term: termWindow, policy }))
    }
    return map
  }, [learners, daysWithRecords, termWindow, policy])

  // Class totals per shown column: how many learners marked present+late that day.
  const columnTotals = useMemo(() => shownDays.map((day) => {
    let attended = 0
    for (const learner of learners) {
      const s = day.records?.[learner.id]?.status
      if (s === 'present' || s === 'late') attended += 1
    }
    return attended
  }), [shownDays, learners])

  // ── keyboard navigation: arrows move focus, Enter/Space cycles the cell ──
  const cellRefs = useRef(new Map())
  const registerRef = (key, el) => {
    if (el) cellRefs.current.set(key, el)
    else cellRefs.current.delete(key)
  }
  function handleKeyDown(e) {
    const key = e.target?.dataset?.cell
    if (!key) return
    const [learnerId, date] = key.split('|')
    const row = learners.findIndex((l) => l.id === learnerId)
    const col = shownDays.findIndex((d) => d.date === date)
    if (row === -1 || col === -1) return
    let nextRow = row
    let nextCol = col
    if (e.key === 'ArrowRight') nextCol += 1
    else if (e.key === 'ArrowLeft') nextCol -= 1
    else if (e.key === 'ArrowDown') nextRow += 1
    else if (e.key === 'ArrowUp') nextRow -= 1
    else return
    e.preventDefault()
    const target = learners[nextRow] && shownDays[nextCol]
      ? cellRefs.current.get(`${learners[nextRow].id}|${shownDays[nextCol].date}`)
      : null
    if (target) { target.tabIndex = 0; target.focus() }
  }

  if (!learners.length) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
        <p className="theme-text font-black">No learners on this roster yet.</p>
        <p className="theme-text-muted text-sm mt-1">Add learners in the Roster section to start the term grid.</p>
      </div>
    )
  }
  if (!activeMonth) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
        <p className="theme-text font-black">No register dates in this term yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* month tabs (the date window) */}
      <div className="flex flex-wrap items-center gap-1">
        {months.map((m) => (
          <button key={m.key} type="button" onClick={() => setMonthKey(m.key)}
            className={`px-3 py-1.5 rounded-radius-md text-xs font-black border
              ${m.key === activeMonth.key ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-card theme-border theme-text-muted'}`}>
            {m.label}
          </button>
        ))}
        <span className="theme-text-muted text-xs ml-auto hidden sm:block">
          Click a cell to cycle P→A→S→L→E→– · arrow keys to move
        </span>
      </div>

      {/* Both scroll axes live INSIDE this container so `position: sticky`
          pins the date headers vertically AND the learner columns
          horizontally. Every sticky cell carries an opaque theme-card
          background; the header/identity intersection sits on the highest
          layer so no cell content shows through while scrolling. The print
          documents are separate HTML (attendanceExportService) and never
          inherit any of this positioning. */}
      <div className="overflow-auto max-h-[75vh] border theme-border rounded-radius-md" onKeyDown={handleKeyDown}>
        <table className="border-collapse text-left w-max min-w-full">
          <thead>
            <tr className="border-b theme-border">
              <th className="sticky top-0 left-0 z-40 theme-card h-8 px-2 py-1.5 text-xs theme-text-muted">No.</th>
              <th className="sticky top-0 left-8 z-40 theme-card h-8 px-2 py-1.5 text-xs theme-text-muted">Adm</th>
              <th className="sticky top-0 left-28 z-40 theme-card h-8 px-2 py-1.5 text-xs theme-text-muted">Learner</th>
              {weeks.map((week) => (
                <th key={week.key} colSpan={week.days.length}
                  className="sticky top-0 z-30 theme-card h-8 px-1 py-1.5 text-center text-[11px] font-black theme-text-muted border-l theme-border whitespace-nowrap">
                  {week.label} ({week.monthLabel})
                </th>
              ))}
              <th colSpan={7} className="sticky top-0 z-30 theme-card h-8 px-2 py-1.5 text-center text-[11px] font-black theme-text-muted border-l theme-border">Term totals</th>
            </tr>
            <tr className="border-b theme-border">
              <th className="sticky top-8 left-0 z-40 theme-card" aria-hidden="true" />
              <th className="sticky top-8 left-8 z-40 theme-card" aria-hidden="true" />
              <th className="sticky top-8 left-28 z-40 theme-card" aria-hidden="true" />
              {weeks.map((week) => week.days.map((day, di) => (
                <th key={day.date} title={day.holidayName || day.closureLabel || undefined}
                  className={`sticky top-8 z-30 theme-card px-0 py-1 text-center text-[10px] font-black theme-text-muted ${di === 0 ? 'border-l theme-border' : ''} ${day.isToday ? 'theme-accent-text' : ''}`}>
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][day.weekday]}<br />{Number(day.date.slice(8, 10))}
                </th>
              )))}
              {['P', 'A', 'S', 'L', 'E', 'Elig', '%'].map((h, i) => (
                <th key={h} title={h === 'Elig' ? 'Eligible days' : undefined}
                  className={`sticky top-8 z-30 theme-card px-2 py-1 text-center text-[10px] font-black theme-text-muted ${i === 0 ? 'border-l theme-border' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {learners.map((learner, i) => (
              <GridRow
                key={learner.id}
                learner={learner}
                position={i + 1}
                weeks={weeks}
                termWindow={termWindow}
                totals={totalsByLearner.get(learner.id)}
                disabled={!canEdit}
                onCell={setStatusOn}
                registerRef={registerRef}
                firstCellKey={shownDays.length ? `${learners[0].id}|${shownDays[0].date}` : null}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="theme-card border-t theme-border">
              <td className="sticky left-0 z-10 theme-card" />
              <td className="sticky left-8 z-10 theme-card" />
              <td className="sticky left-28 z-10 theme-card px-2 py-1.5 text-xs font-black theme-text-muted">Present + late (shown days)</td>
              {shownDays.map((day, i) => (
                <td key={day.date} className={`text-center text-xs font-black theme-text ${i === 0 ? 'border-l theme-border' : ''}`}>{columnTotals[i]}</td>
              ))}
              <td colSpan={7} className="border-l theme-border" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
