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
 *   - 'band'     this DAY has a non-teaching row in that time column while
 *                other days have a lesson — the assembly that occupies
 *                Period 1 on Monday only. Rendered as a tinted band cell.
 *
 * Pure and DOM-free so `node` can unit test it.
 */

import {
  normalizeTimetableArtifact,
  slotCountForDay,
  periodsForDay,
} from './classTimetable.js'
import { BLOCK_TYPES } from './timetableBlocks.js'
import { resolveSubjectAbbreviation } from '../../utils/subjectAbbreviations.js'

/** "Period 3", "08:15–08:55" or "Period 3 · 08:15–08:55" per the label mode. */
export function formatPeriodLabel(row, slot, mode = 'period-time') {
  const time = `${row.start}–${row.end}`
  if (mode === 'time') return time
  if (mode === 'period') return `Period ${slot}`
  return `Period ${slot} · ${time}`
}

const timeKey = (row) => `${row.start}|${row.end}`

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
 * Two ways a day can differ from that reference, resolved differently on
 * purpose (see resolveDayCell):
 *   - it keeps the same clock boundaries but swaps a lesson for a band (the
 *     assembly that occupies Period 1 on Monday). The day is TIME-ALIGNED,
 *     so cells resolve by time and the band renders where it belongs.
 *   - its times genuinely differ (a half-day Friday). Cells resolve by slot,
 *     as they always have, and each carries its own time caption.
 *
 * @returns {{
 *   header, days:string[], layout:string, labelMode:string,
 *   rows:Array<{kind:'lesson'|'break', event?, slot?, id, label, start, end}>,
 *   rowsByDay:Object<string, Array<...>>,
 *   aligned:Object<string, boolean>,
 *   maxSlot:number, slotCount:Object<string,number>,
 *   cells:Object<string, Object<number, {state:'start'|'covered', block}>>,
 *   subjects:string[] (distinct curriculum labels in first-appearance order),
 *   displayLabels:Object<string,string>, abbreviations:Object<string,string>
 * }}
 */
export function buildTimetableGridModel(timetableRaw, overrides = {}) {
  const t = normalizeTimetableArtifact(timetableRaw)
  if (!t) return null
  const days = t.days
  const periods = t.periods
  const timing = t.timing || null
  const prefs = t.displayPreferences || {}
  const layout = overrides.layout || prefs.timetableLayout || 'days-as-columns'
  const labelMode = overrides.labelMode || prefs.periodLabelMode || 'period-time'

  // Every day-keyed map below is null-prototype. `days` carries whatever the
  // saved timetable names its days, and a plain `{}` answers truthily to
  // 'constructor', 'toString' and '__proto__' before anything is written to
  // it: `if (!cells[b.day]) continue` therefore PASSED for a day named
  // 'toString', and the write that followed landed a slot object on
  // Object.prototype.toString itself. A day named '__proto__' went the other
  // way — `cells[day] = {}` reassigned the map's own prototype instead of
  // adding a key, so that day silently held no cells and rendered empty.
  // Object.create(null) inherits nothing, so a day name is only ever a key.
  // (CodeQL #78, #87-#92.)
  const rowsByDay = Object.create(null)
  let maxSlot = 0
  let referenceDay = null
  for (const day of days) {
    const dayPeriods = periodsForDay(day, periods, t.dayStructure, timing)
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

  // Which days share the reference's exact clock boundaries. Only those can
  // be resolved by TIME; the rest keep the original slot-based resolution so
  // a half-day Friday renders exactly as it did before.
  const rowIndexByDay = Object.create(null)
  const aligned = Object.create(null)
  for (const day of days) {
    const map = new Map()
    for (const r of rowsByDay[day]) map.set(timeKey(r), r)
    rowIndexByDay[day] = map
    aligned[day] = rows.every((r) => map.has(timeKey(r)))
  }

  const slotCount = Object.create(null)
  for (const day of days) slotCount[day] = slotCountForDay(day, periods, t.dayStructure, timing)

  // Occupancy: day → slot → { state, block }.
  const cells = Object.create(null)
  for (const day of days) cells[day] = Object.create(null)
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

  // Printed names + cell codes, resolved from the saved subject list so
  // every renderer shows the same words. Blocks keep their CANONICAL label
  // as identity — a relabelled language never breaks curriculum accounting.
  const displayLabels = {}
  const abbreviations = {}
  for (const s of Array.isArray(t.subjectAllocations) ? t.subjectAllocations : []) {
    if (!s?.label) continue
    if (s.displayLabel && s.displayLabel !== s.label) displayLabels[s.label] = s.displayLabel
    abbreviations[s.label] = resolveSubjectAbbreviation(s)
  }
  for (const label of subjects) {
    if (!abbreviations[label]) abbreviations[label] = resolveSubjectAbbreviation({ label })
  }

  return {
    header: t.header,
    days,
    layout,
    labelMode,
    rows,
    rowsByDay,
    rowIndexByDay,
    aligned,
    maxSlot,
    slotCount,
    cells,
    subjects,
    displayLabels,
    abbreviations,
    subjectAllocations: Array.isArray(t.subjectAllocations) ? t.subjectAllocations : [],
    languageName: t.languageName || null,
    dayStructure: t.dayStructure || null,
    timing,
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

/**
 * What one day holds in the time column a REFERENCE lesson row occupies.
 *
 * This is the call every renderer should make when walking `model.rows`,
 * because it is the only one that can answer "Monday has ASSEMBLY where
 * Tuesday has a lesson". A time-aligned day is looked up by its clock
 * times; anything else falls back to the slot lookup renderers have always
 * used, so no existing timetable changes.
 *
 * @returns {{state:'start'|'covered'|'empty'|'off'|'band', block, row, bandLabel}}
 */
export function resolveDayCell(model, day, refRow) {
  if (!refRow || refRow.kind !== 'lesson') return { state: 'off', block: null, row: null }
  if (model.aligned?.[day]) {
    const own = model.rowIndexByDay?.[day]?.get(timeKey(refRow))
    if (!own) return { state: 'off', block: null, row: null }
    if (own.kind === 'break') {
      return { state: 'band', block: null, row: own, bandLabel: own.label, event: own.event }
    }
    return { ...cellState(model, day, own.slot), row: own }
  }
  return { ...cellState(model, day, refRow.slot), row: dayRowForSlot(model, day, refRow.slot) }
}

/** The name printed in a cell: the subject's display name (a relabelled
 * language) or its canonical label. */
export function displayLabelFor(model, label) {
  return model?.displayLabels?.[label] || label
}

/** The short code printed in a narrow cell. */
export function abbreviationFor(model, label) {
  return model?.abbreviations?.[label] || resolveSubjectAbbreviation({ label })
}

/** The text a cell prints, per the resolved cell-text mode. */
export function cellTextFor(model, label, mode) {
  return mode === 'abbrev' ? abbreviationFor(model, label) : displayLabelFor(model, label)
}

/** Soft, print-safe tints cycled across the distinct subjects in the grid. */
export const SUBJECT_TINTS = [
  '#fbe7c8', '#dfeadd', '#e3dcf5', '#dbe7f4', '#fde2c4',
  '#e1e8ee', '#f4d6e2', '#f9d8c8', '#d8ecd0', '#fde9b8',
]

/** Distinct-subject → tint colour map for a model. Activities use none. */
export function subjectTintMap(model) {
  // Null-prototype for the same reason the grid maps above are: the keys are
  // subject labels off a saved timetable. A subject named '__proto__' had its
  // tint SILENTLY DROPPED (the assignment hit the prototype setter, so the
  // subject rendered untinted), and one named 'constructor' made every reader's
  // `tints[label]` return the Object constructor -- which the Word exporter
  // then calls `.replace('#','')` on, throwing mid-export.
  const map = Object.create(null)
  model.subjects.forEach((label, i) => { map[label] = SUBJECT_TINTS[i % SUBJECT_TINTS.length] })
  return map
}
