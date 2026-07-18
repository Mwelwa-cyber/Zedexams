/**
 * Shared timetable grid model — ONE rendering data model consumed by the
 * on-screen preview (ClassTimetableView), the editable studio grid and all
 * three exporters (PDF, Word, Excel), so what the teacher previews is
 * exactly what downloads.
 *
 * Supports the two presentation layouts (display preferences, not separate
 * timetables — both read the same saved schedule):
 *   - 'days-as-columns'  Days across the top; times down the left.
 *                        Double periods merge VERTICALLY (rowSpan).
 *   - 'days-as-rows'     Days down the left; times across the top.
 *                        Double periods merge HORIZONTALLY (colSpan).
 *
 * Cell states:
 *   - 'start'    the first slot of a block → render label with row/colSpan
 *   - 'covered'  a continuation slot of a block → render nothing (merged)
 *   - 'empty'    a fillable lesson slot with nothing placed
 *   - 'off'      beyond this day's configured lesson count (day ends early)
 *
 * Pure and DOM-free so `node` can unit test it.
 */

import {
  normalizeTimetableArtifact,
  slotCountForDay,
  periodsForDay,
} from './classTimetable.js'
import { BLOCK_TYPES } from './timetableBlocks.js'

/** "Period 3", "08:15–08:55" or "Period 3 · 08:15–08:55" per the label mode. */
export function formatPeriodLabel(row, slot, mode = 'period-time') {
  const time = `${row.start}–${row.end}`
  if (mode === 'time') return time
  if (mode === 'period') return `Period ${slot}`
  return `Period ${slot} · ${time}`
}

/**
 * Build the render model from any saved timetable artifact (v1 or v2).
 *
 * A day-specific school-day structure (classTimetable.periodsForDay) gives
 * some days their own reporting time, breaks and knock-off — `rowsByDay`
 * carries each day's OWN row list (used for that day's actual cell times);
 * `rows`/`maxSlot` stay a single reference row list — the day with the most
 * lesson periods (typically the uniform "full day" pattern) — so existing
 * header/gutter rendering and the exporters keep working unchanged when
 * every day shares one structure (the original, still-most-common case).
 *
 * @returns {{
 *   header, days:string[], layout:string, labelMode:string,
 *   rows:Array<{kind:'lesson'|'break', event?, slot?, id, label, start, end}>,
 *   rowsByDay:Object<string, Array<...>>,
 *   maxSlot:number, slotCount:Object<string,number>,
 *   cells:Object<string, Object<number, {state:'start'|'covered', block}>>,
 *   subjects:string[] (distinct curriculum labels in first-appearance order)
 * }}
 */
export function buildTimetableGridModel(timetableRaw, overrides = {}) {
  const t = normalizeTimetableArtifact(timetableRaw)
  if (!t) return null
  const days = t.days
  const periods = t.periods
  const layout = overrides.layout || t.displayPreferences?.timetableLayout || 'days-as-columns'
  const labelMode = overrides.labelMode || t.displayPreferences?.periodLabelMode || 'period-time'

  // Each day's own period rows, annotated with their 1-based lesson slot.
  const rowsByDay = {}
  let maxSlot = 0
  let referenceDay = null
  for (const day of days) {
    const dayPeriods = periodsForDay(day, periods, t.dayStructure)
    let slot = 0
    rowsByDay[day] = dayPeriods.map((p) => {
      if (p.kind !== 'lesson') return { ...p }
      slot += 1
      return { ...p, slot }
    })
    if (slot > maxSlot) { maxSlot = slot; referenceDay = day }
  }
  if (!referenceDay) referenceDay = days[0] || null
  const rows = referenceDay ? rowsByDay[referenceDay] : []

  const slotCount = {}
  for (const day of days) slotCount[day] = slotCountForDay(day, periods, t.dayStructure)

  // Occupancy: day → slot → { state, block }.
  const cells = {}
  for (const day of days) cells[day] = {}
  for (const b of t.blocks) {
    if (!cells[b.day]) continue
    for (let s = b.startSlot; s < b.startSlot + b.length; s += 1) {
      if (s < 1 || s > maxSlot) continue
      cells[b.day][s] = { state: s === b.startSlot ? 'start' : 'covered', block: b }
    }
  }

  // Distinct curriculum subjects in first-appearance order (for tints).
  const subjects = []
  const seen = new Set()
  for (let slot = 1; slot <= maxSlot; slot += 1) {
    for (const day of days) {
      const cell = cells[day][slot]
      const label = cell?.block?.type === BLOCK_TYPES.CURRICULUM ? cell.block.label : null
      if (label && !seen.has(label)) { seen.add(label); subjects.push(label) }
    }
  }

  return {
    header: t.header,
    days,
    layout,
    labelMode,
    rows,
    rowsByDay,
    maxSlot,
    slotCount,
    cells,
    subjects,
    dayStructure: t.dayStructure || null,
    displayPreferences: t.displayPreferences,
  }
}

/** The lesson row that ACTUALLY applies to one (day, slot) cell — that
 * day's own row when its school-day structure differs from the reference
 * row list, otherwise the shared reference row. Use this (not `model.rows`)
 * whenever a cell's own clock time matters, e.g. a half-day Friday. */
export function dayRowForSlot(model, day, slot) {
  const dayRows = model?.rowsByDay?.[day] || model?.rows || []
  return dayRows.find((r) => r.kind === 'lesson' && r.slot === slot) || null
}

/** The state of one (day, slot) cell: 'start' | 'covered' | 'empty' | 'off'. */
export function cellState(model, day, slot) {
  const cell = model.cells?.[day]?.[slot]
  if (cell) return cell
  if (slot > (model.slotCount?.[day] ?? model.maxSlot)) return { state: 'off', block: null }
  return { state: 'empty', block: null }
}

/** Soft, print-safe tints cycled across the distinct subjects in the grid. */
export const SUBJECT_TINTS = [
  '#fbe7c8', '#dfeadd', '#e3dcf5', '#dbe7f4', '#fde2c4',
  '#e1e8ee', '#f4d6e2', '#f9d8c8', '#d8ecd0', '#fde9b8',
]

/** Distinct-subject → tint colour map for a model. Activities use none. */
export function subjectTintMap(model) {
  const map = {}
  model.subjects.forEach((label, i) => { map[label] = SUBJECT_TINTS[i % SUBJECT_TINTS.length] })
  return map
}
