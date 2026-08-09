/**
 * Class Timetable studio — deterministic core (no AI).
 *
 * A class timetable is a grid of teaching days × time periods, each lesson
 * cell holding a subject drawn from the site curriculum. This module is the
 * pure, DOM-free engine behind ClassTimetableStudio:
 *
 *   - buildPeriods()            → ordered time rows (lessons + breaks) from a
 *                                 simple timing config (start, length, breaks)
 *   - curriculumSubjectsForGrade() → the CBC subject list for a grade, seeded
 *                                 with sensible weekly period allocations
 *   - autoFillTimetable()       → spread each subject's weekly periods across
 *                                 the grid, balanced so a subject avoids
 *                                 landing twice in one day while capacity lasts
 *
 * Kept side-effect-free (and free of the firebase SDK) so `node` can unit
 * test it — see scripts/test-class-timetable.mjs.
 */

import { getSubjectsForGradeForm } from '../../config/library.js'
import { resolveGradeForm } from '../../utils/libraryClassification.js'
import {
  resolveTimetableCurriculum,
  DEFAULT_CURRICULUM_ID,
  subjectLoad,
  subjectLoadWeight,
  LOAD_WEIGHT,
} from '../../utils/curriculumFramework.js'
import {
  BLOCK_TYPES,
  segmentsOf,
  fitsInOneSegment,
  makeBlock,
  blockSlots,
  blocksToSlots,
  slotsToBlocks,
  validateBlockLayout,
} from './timetableBlocks.js'
import { DEFAULT_PRINT_LAYOUT, DEFAULT_PRINT_TEMPLATE } from './timetablePrintTemplates.js'
import { DEFAULT_SESSION_ID, sessionDefaults } from './timetableSessions.js'

export const SCHEMA_VERSION_1 = 'class-timetable-1.0'
export const SCHEMA_VERSION = 'class-timetable-2.0'

/* ── Display preferences ──────────────────────────────────────── */

export const TIMETABLE_LAYOUTS = [
  { id: 'days-as-columns', label: 'Days across the top' },
  { id: 'days-as-rows', label: 'Days down the left' },
]

export const PERIOD_LABEL_MODES = [
  { id: 'period-time', label: 'Period number and time' },
  { id: 'time', label: 'Time only' },
  { id: 'period', label: 'Period number only' },
]

export const DEFAULT_DISPLAY_PREFERENCES = {
  // On screen (the studio preview + the library view).
  timetableLayout: 'days-as-columns',
  periodLabelMode: 'period-time',
  // Print / export. Deliberately a SEPARATE orientation: both reference
  // documents put days down the left on paper, while the on-screen editor
  // keeps days across the top. See timetablePrintTemplates.js.
  printLayout: DEFAULT_PRINT_LAYOUT,
  printTemplate: DEFAULT_PRINT_TEMPLATE,
  cellText: 'auto',          // 'auto' | 'full' | 'abbrev'
  showMinistryHeader: true,  // only rendered by the government template
  showLegend: true,          // the abbreviation key under the grid
}

/** The teaching days a school can run, in week order. Mon–Fri are the
 * default; Saturday is offered for schools that run weekend lessons. */
export const DAYS_OF_WEEK = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

export const DEFAULT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

/* ── Time helpers ─────────────────────────────────────────────── */

/** "07:30" → minutes since midnight (450). Tolerant of bad input → 0. */
export function timeToMinutes(hhmm) {
  const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const h = Math.min(23, Math.max(0, Number(m[1])))
  const min = Math.min(59, Math.max(0, Number(m[2])))
  return h * 60 + min
}

/** minutes since midnight → "07:30" (wraps at 24h defensively). */
export function minutesToTime(total) {
  const t = ((Math.round(Number(total) || 0) % 1440) + 1440) % 1440
  const h = Math.floor(t / 60)
  const m = t % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/* ── Period (time row) construction ───────────────────────────── */

export const DEFAULT_TIMING = {
  // Which SESSION of the school day this class runs (timetableSessions.js).
  // 'full' keeps the original single-session behaviour; the shift sessions
  // drive both the seeded times and the coverage target.
  session: DEFAULT_SESSION_ID,
  startTime: '07:30',     // when the school reports
  endTime: '13:10',       // when the school knocks off (used in fit mode)
  // Three ways to time the day (`timingMode`; absent → derived from the
  // original `fitToEndTime` flag so every saved timetable keeps its shape):
  //   'fixed'  → fixed period length; the studio works out when the day ends.
  //              Breaks are anchored "after period N".
  //   'fit'    → the day is shared evenly between the report and knock-off
  //              times; period length is derived. Mid-day breaks are anchored
  //              to the clock time the teacher sets, so they land exactly then.
  //   'custom' → the teacher types the exact start–end of every row
  //              (`customRows`). Nothing is derived; the grid, the counts and
  //              the print render precisely what was typed. This is what a
  //              school running 60-minute lessons, a 30-minute break and a
  //              90-minute lunch needs — none of it fits a single "period
  //              length" number.
  timingMode: 'fixed',
  fitToEndTime: false,
  periodMinutes: 40,
  lessonPeriods: 8,
  customRows: [],
  breaks: [
    // Day bookends: assembly sits before Period 1 (afterPeriod 0), closing
    // after the last lesson (afterPeriod 'end'). Break and lunch fall mid-day —
    // positioned by afterPeriod in fixed mode, by `time` (clock) in fit mode.
    // Many Zambian government schools run a break but no lunch: a teacher just
    // unticks LUNCH (enabled:false) to drop it.
    //
    // `days` scopes a row to particular teaching days (null/absent = every
    // day, which is what every previously saved timetable means). `placement`
    // on the assembly row chooses between the two real patterns:
    //   'before'  — assembly is extra time before Period 1 (the default)
    //   'period1' — assembly OCCUPIES the first period slot, so that day
    //               fits one fewer lesson and still knocks off on time. This
    //               is the government pattern the reference document uses.
    // The DEFAULT stays unscoped (every day) on purpose: scoping assembly to
    // one day shifts that day's lesson times away from the rest of the week,
    // which is right when a school really does that and noise when it does
    // not. The government/private templates below scope it where the
    // reference documents do.
    { afterPeriod: 0,     time: '07:30', minutes: 15, name: 'ASSEMBLY', event: 'assembly', days: null, placement: 'before' },
    { afterPeriod: 2,     time: '09:30', minutes: 20, name: 'BREAK',    event: 'break' },
    { afterPeriod: 5,     time: '11:30', minutes: 40, name: 'LUNCH',    event: 'lunch' },
    { afterPeriod: 'end', time: '',      minutes: 10, name: 'CLOSING',  event: 'closing' },
  ],
}

/** The timing mode a config asks for, tolerating every saved shape: an
 * explicit `timingMode`, else the original `fitToEndTime` boolean. */
export function resolveTimingMode(config = {}) {
  const mode = String(config.timingMode || '').trim()
  if (mode === 'fixed' || mode === 'fit' || mode === 'custom') return mode
  return config.fitToEndTime ? 'fit' : 'fixed'
}

/**
 * Does a `days`-scoped row apply to this day?
 *
 * An unscoped row (null / [] / absent — every saved timetable) applies
 * everywhere. A scoped row applies only on its own days, and is left OUT of
 * the day-less REFERENCE list entirely: the reference is the shape every day
 * shares, so a Monday-only assembly must not appear in it.
 */
export function dayScopeMatches(days, day) {
  const scoped = Array.isArray(days) && days.length > 0
  if (!scoped) return true
  if (!day) return false
  return days.includes(day)
}

/** Normalise one break's anchor. 'end' pins it after the final lesson; a
 * number anchors it after that lesson (0 = before Period 1, i.e. assembly). */
function breakAnchor(afterPeriod, count) {
  if (afterPeriod === 'end') return count
  return Math.round(Number(afterPeriod) || 0)
}

/**
 * Build the ordered list of time rows from a timing config. Each row is
 * either a lesson period (kind: 'lesson') or a non-teaching row (kind:
 * 'break') — assembly, break, lunch or closing, distinguished by `event`.
 * Lesson ids are stable ('p1', 'p2', …) so saved grids survive a re-build
 * as long as the lesson count is unchanged.
 *
 * Two timing modes (see DEFAULT_TIMING): when `fitToEndTime` is set and a
 * valid `endTime` is given, the day is shared between the report and knock-off
 * times (period length derived, breaks anchored to their clock time);
 * otherwise the day is built forward from a fixed period length.
 *
 * @returns {{id,kind,event?,label,start,end}[]}
 */
export function buildPeriods(config = {}, { day = null } = {}) {
  const mode = resolveTimingMode(config)
  const allBreaks = Array.isArray(config.breaks) ? config.breaks : []
  const assembly = allBreaks.find((b) => b?.event === 'assembly' && b?.enabled !== false)
  const assemblyHere = Boolean(assembly) && dayScopeMatches(assembly.days, day)
  // The government pattern: assembly takes the Period 1 slot instead of
  // adding time before it, so the day fits one fewer lesson and still knocks
  // off at the same clock time.
  const occupiesPeriodOne = Boolean(assemblyHere && assembly.placement === 'period1')
  // A day-SCOPED assembly is extra time on those days only, so it is
  // backdated: it ends when the lessons start rather than pushing them
  // later. Otherwise a "Monday and Friday" assembly would run every Monday
  // lesson 20 minutes out of line with the rest of the week — which is not
  // what the school does; it reports earlier on those two days.
  const backdated = Boolean(
    assemblyHere && !occupiesPeriodOne
    && Array.isArray(assembly.days) && assembly.days.length > 0,
  )

  const scoped = {
    ...config,
    breaks: allBreaks
      .filter((b) => dayScopeMatches(b?.days, day))
      // The assembly is emitted by the helpers below in these two shapes.
      .filter((b) => !((occupiesPeriodOne || backdated) && b?.event === 'assembly')),
  }

  let rows = null
  if (mode === 'custom') rows = buildPeriodsCustom(scoped, day)
  if (!rows && mode === 'fit') rows = buildPeriodsFitted(scoped) // null when the window is degenerate
  if (!rows) rows = buildPeriodsFixed(scoped)
  if (occupiesPeriodOne) rows = applyPeriodOneAssembly(rows, assembly)
  else if (backdated) rows = prependBackdatedAssembly(rows, assembly)
  return rows
}

/** An assembly that runs BEFORE the shared start time, on its own days. */
function prependBackdatedAssembly(rows, assembly) {
  if (!rows.length) return rows
  const minutes = Math.max(0, Math.round(Number(assembly?.minutes) || 0))
  if (!minutes) return rows
  const end = timeToMinutes(rows[0].start)
  return [{
    id: 'brk-asm-pre',
    kind: 'break',
    event: 'assembly',
    label: String(assembly?.name || 'ASSEMBLY').toUpperCase(),
    start: minutesToTime(end - minutes),
    end: rows[0].start,
  }, ...rows]
}

const HHMM = /^\d{1,2}:\d{2}$/

/**
 * Custom period times: the teacher types the exact start–end of every row.
 * Nothing is derived — the grid, the placed counts and the print render
 * precisely what was typed, which is the only way to reproduce a school day
 * of 60-minute lessons, a 30-minute break and a 90-minute lunch.
 *
 * Rows that are disabled, malformed or zero-length are skipped rather than
 * silently "corrected"; a row list that yields no rows at all returns null so
 * the caller falls back to the fixed builder instead of rendering an empty
 * day.
 */
function buildPeriodsCustom(config = {}, day = null) {
  const list = Array.isArray(config.customRows) ? config.customRows : []
  const rows = []
  let slot = 0
  for (const r of list) {
    if (!r || r.enabled === false) continue
    if (!dayScopeMatches(r.days, day)) continue
    if (!HHMM.test(String(r.start || '')) || !HHMM.test(String(r.end || ''))) continue
    if (timeToMinutes(r.end) <= timeToMinutes(r.start)) continue
    if (r.kind === 'break') {
      rows.push({
        id: `brk-c${rows.length}`,
        kind: 'break',
        event: r.event || 'break',
        label: String(r.name || 'BREAK').toUpperCase(),
        start: r.start,
        end: r.end,
      })
    } else {
      slot += 1
      rows.push({ id: `p${slot}`, kind: 'lesson', label: `Period ${slot}`, start: r.start, end: r.end })
    }
  }
  return slot > 0 ? rows : null
}

/**
 * Turn the first lesson row into the ASSEMBLY band, keeping its clock times.
 *
 * The day therefore holds one fewer lesson and still ends when it always
 * did — Monday's 12:40 slot reads ASSEMBLY while Tuesday's holds a lesson,
 * exactly as the reference government timetable does. Remaining lessons are
 * renumbered so slot 1 is still the first teachable slot.
 */
function applyPeriodOneAssembly(rows, assembly) {
  const idx = rows.findIndex((r) => r.kind === 'lesson')
  if (idx < 0) return rows
  const first = rows[idx]
  const out = rows.slice()
  out[idx] = {
    id: `brk-asm-${idx}`,
    kind: 'break',
    event: 'assembly',
    label: String(assembly?.name || 'ASSEMBLY').toUpperCase(),
    start: first.start,
    end: first.end,
  }
  let slot = 0
  return out.map((r) => {
    if (r.kind !== 'lesson') return r
    slot += 1
    return { ...r, id: `p${slot}`, label: `Period ${slot}` }
  })
}

/* Fixed-length day: forward from the start time, one period length per row,
 * breaks anchored "after period N". The original, deterministic builder. */
function buildPeriodsFixed(config = {}) {
  const {
    startTime = DEFAULT_TIMING.startTime,
    periodMinutes = DEFAULT_TIMING.periodMinutes,
    lessonPeriods = DEFAULT_TIMING.lessonPeriods,
    breaks = DEFAULT_TIMING.breaks,
  } = config

  const count = Math.min(14, Math.max(1, Math.round(Number(lessonPeriods) || 1)))
  const len = Math.min(180, Math.max(5, Math.round(Number(periodMinutes) || 40)))

  // Map enabled breaks by the lesson number they follow (0 = before Period 1).
  const breaksAfter = new Map()
  for (const b of Array.isArray(breaks) ? breaks : []) {
    if (b?.enabled === false) continue
    const after = breakAnchor(b?.afterPeriod, count)
    const mins = Math.round(Number(b?.minutes) || 0)
    if (after < 0 || after > count || mins <= 0) continue
    if (!breaksAfter.has(after)) breaksAfter.set(after, [])
    breaksAfter.get(after).push({ minutes: mins, name: (b?.name || 'BREAK').toUpperCase(), event: b?.event || 'break' })
  }

  const rows = []
  let cursor = timeToMinutes(startTime)
  const emitBreaks = (after) => {
    for (const b of breaksAfter.get(after) || []) {
      const bStart = cursor
      const bEnd = bStart + b.minutes
      rows.push({ id: `brk-${after}-${rows.length}`, kind: 'break', event: b.event, label: b.name, start: minutesToTime(bStart), end: minutesToTime(bEnd) })
      cursor = bEnd
    }
  }

  emitBreaks(0) // assembly / any pre-lesson rows
  for (let i = 1; i <= count; i += 1) {
    const start = cursor
    const end = start + len
    rows.push({ id: `p${i}`, kind: 'lesson', label: `Period ${i}`, start: minutesToTime(start), end: minutesToTime(end) })
    cursor = end
    emitBreaks(i) // mid-day breaks + closing (anchored at the final lesson)
  }
  return rows
}

/**
 * Fit-to-knock-off day: the teacher gives the report time, the knock-off time
 * and the clock time of each break; the lesson periods share whatever teaching
 * time is left. Breaks therefore land exactly when the teacher set them.
 *
 * Assembly and closing stay bookends (assembly fills the gap before the first
 * lesson, closing trails the knock-off); mid-day breaks (break / lunch) carve
 * the teaching window into segments. The lesson periods are spread across the
 * segments in proportion to each segment's length, uniform within a segment so
 * every break and the knock-off fall on an exact boundary.
 *
 * Returns null when the window can't hold the day (end ≤ start, no teaching
 * time left) so the caller can fall back to the fixed builder.
 */
function buildPeriodsFitted(config = {}) {
  const {
    startTime = DEFAULT_TIMING.startTime,
    endTime = DEFAULT_TIMING.endTime,
    lessonPeriods = DEFAULT_TIMING.lessonPeriods,
    breaks = DEFAULT_TIMING.breaks,
  } = config

  const count = Math.min(14, Math.max(1, Math.round(Number(lessonPeriods) || 1)))
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  if (end <= start) return null

  const enabled = (Array.isArray(breaks) ? breaks : []).filter((b) => b?.enabled !== false)
  const assembly = enabled.find((b) => b?.event === 'assembly')
  const closing = enabled.find((b) => b?.event === 'closing')
  const aDur = assembly ? Math.max(0, Math.round(Number(assembly.minutes) || 0)) : 0
  const cDur = closing ? Math.max(0, Math.round(Number(closing.minutes) || 0)) : 0

  const teachStart = start + aDur
  if (end <= teachStart) return null

  // Mid-day breaks anchored to their clock time, inside the teaching window.
  const mid = enabled
    .filter((b) => b?.event !== 'assembly' && b?.event !== 'closing')
    .map((b) => ({
      time: timeToMinutes(b?.time),
      minutes: Math.max(0, Math.round(Number(b?.minutes) || 0)),
      name: (b?.name || 'BREAK').toUpperCase(),
      event: b?.event || 'break',
    }))
    .filter((b) => b.minutes > 0 && b.time > teachStart && b.time < end)
    .sort((a, b) => a.time - b.time)

  // Carve teaching segments between the breaks; drop any break that overlaps a
  // previous one or would run past the knock-off.
  const segments = []  // { start, end }
  const usedBreaks = []
  let segStart = teachStart
  for (const b of mid) {
    if (b.time <= segStart) continue
    if (b.time + b.minutes >= end) continue
    segments.push({ start: segStart, end: b.time })
    usedBreaks.push(b)
    segStart = b.time + b.minutes
  }
  segments.push({ start: segStart, end })

  const totalTeach = segments.reduce((sum, g) => sum + (g.end - g.start), 0)
  if (totalTeach <= 0) return null

  // Spread the lesson periods across the segments by length (largest remainder).
  const counts = segments.map((g) => {
    const exact = (count * (g.end - g.start)) / totalTeach
    return { base: Math.floor(exact), frac: exact - Math.floor(exact), min: g.end - g.start }
  })
  let assigned = counts.reduce((sum, c) => sum + c.base, 0)
  const byFrac = counts.map((c, i) => i).sort((a, b) => counts[b].frac - counts[a].frac)
  for (let k = 0; assigned < count && k < byFrac.length; k += 1) { counts[byFrac[k]].base += 1; assigned += 1 }
  if (assigned < count) { // all fractions equal — dump the rest in the longest segment
    let big = 0
    for (let i = 1; i < counts.length; i += 1) if (counts[i].min > counts[big].min) big = i
    counts[big].base += count - assigned
  }
  // Avoid a teaching segment with no lessons (a time gap) when periods allow.
  if (count >= segments.length) {
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i].base > 0) continue
      let donor = -1
      for (let j = 0; j < counts.length; j += 1) {
        if (counts[j].base > 1 && (donor < 0 || counts[j].base > counts[donor].base)) donor = j
      }
      if (donor >= 0) { counts[donor].base -= 1; counts[i].base += 1 }
    }
  }

  const rows = []
  if (assembly && aDur > 0) {
    rows.push({ id: `brk-asm-${rows.length}`, kind: 'break', event: 'assembly', label: (assembly.name || 'ASSEMBLY').toUpperCase(), start: minutesToTime(start), end: minutesToTime(teachStart) })
  }
  let idx = 0
  for (let si = 0; si < segments.length; si += 1) {
    const seg = segments[si]
    const n = counts[si].base
    let cursor = seg.start
    for (let k = 0; k < n; k += 1) {
      idx += 1
      const len = Math.round((seg.end - cursor) / (n - k)) // even split, last absorbs rounding
      const pEnd = k === n - 1 ? seg.end : cursor + len
      rows.push({ id: `p${idx}`, kind: 'lesson', label: `Period ${idx}`, start: minutesToTime(cursor), end: minutesToTime(pEnd) })
      cursor = pEnd
    }
    if (si < usedBreaks.length) {
      const b = usedBreaks[si]
      rows.push({ id: `brk-${b.time}-${rows.length}`, kind: 'break', event: b.event, label: b.name, start: minutesToTime(b.time), end: minutesToTime(b.time + b.minutes) })
    }
  }
  if (closing && cDur > 0) {
    rows.push({ id: `brk-cls-${rows.length}`, kind: 'break', event: 'closing', label: (closing.name || 'CLOSING').toUpperCase(), start: minutesToTime(end), end: minutesToTime(end + cDur) })
  }
  return rows
}

/* ── Day types ─────────────────────────────────────────────────────
 * The broad shape a teaching day takes. Each SCHOOL_DAY_TEMPLATES entry
 * below is tagged with one — the per-day picker in the studio groups its
 * template choices by this. "Half day" is the shape a regular weekly
 * shortened day takes (e.g. Friday knocking off at 12:30); "Custom" starts
 * from whatever timing is already set and stays fully free-form.
 */
export const DAY_TYPES = [
  { id: 'full', label: 'Full day' },
  { id: 'half', label: 'Half day' },
  { id: 'custom', label: 'Custom' },
]

export function dayTypeLabel(id) {
  return DAY_TYPES.find((t) => t.id === id)?.label || 'Custom'
}

/* ── School-day templates ─────────────────────────────────────────
 * Starting points for common Zambian school-day arrangements. A template
 * only seeds the timing settings — every value stays editable afterwards.
 */
export const SCHOOL_DAY_TEMPLATES = [
  {
    id: 'full-day-break-lunch',
    label: 'Full day · break + lunch',
    description: 'Reports in the morning, runs past lunch. Assembly, one break and a lunch hour.',
    dayType: 'full',
    timing: {
      startTime: '07:30', endTime: '15:30', fitToEndTime: false, periodMinutes: 40,
      breaks: [
        { afterPeriod: 0, time: '07:30', minutes: 15, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 2, time: '09:30', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '12:00', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: true },
        { afterPeriod: 'end', time: '', minutes: 10, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    id: 'full-day-break-only',
    label: 'Full day · break only',
    description: 'A full teaching day with a single mid-morning break and no lunch hour.',
    dayType: 'full',
    timing: {
      startTime: '07:30', endTime: '13:30', fitToEndTime: false, periodMinutes: 40,
      breaks: [
        { afterPeriod: 0, time: '07:30', minutes: 15, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 3, time: '10:00', minutes: 30, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '12:00', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 10, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    id: 'government-break-only',
    label: 'Government school day · break only',
    description: 'The common government-school pattern: early report, one break, knock off after the last lesson.',
    dayType: 'full',
    timing: {
      startTime: '07:00', endTime: '12:50', fitToEndTime: false, periodMinutes: 40,
      breaks: [
        { afterPeriod: 0, time: '07:00', minutes: 15, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 3, time: '09:30', minutes: 30, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '12:00', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    id: 'morning-shift',
    label: 'Morning shift',
    description: 'The morning session of a two-session school — early start, short break, midday knock-off.',
    dayType: 'full',
    timing: {
      startTime: '06:45', endTime: '12:00', fitToEndTime: false, periodMinutes: 40,
      breaks: [
        { afterPeriod: 0, time: '06:45', minutes: 10, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 3, time: '09:00', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '11:00', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    id: 'afternoon-shift',
    label: 'Afternoon shift',
    description: 'The afternoon session of a two-session school — starts after midday, runs to late afternoon.',
    dayType: 'full',
    timing: {
      startTime: '12:15', endTime: '17:30', fitToEndTime: false, periodMinutes: 40,
      breaks: [
        { afterPeriod: 0, time: '12:15', minutes: 10, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 3, time: '14:30', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '15:30', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    id: 'double-session',
    label: 'Double-session school',
    description: 'Your school runs two sessions a day. Build this class’s session — pick morning or afternoon times.',
    dayType: 'full',
    timing: {
      startTime: '06:45', endTime: '12:00', fitToEndTime: false, periodMinutes: 40,
      breaks: [
        { afterPeriod: 0, time: '06:45', minutes: 10, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 3, time: '09:00', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '11:00', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    // The reference government primary school's morning session.
    id: 'government-morning-session',
    label: 'Government — morning session',
    description: 'The morning session of a shift school: reports 07:00, 40-minute periods, one short break, knocks off 12:40 so the afternoon session can start.',
    dayType: 'full',
    timing: {
      session: 'morning', timingMode: 'fixed',
      startTime: '07:00', endTime: '12:40', fitToEndTime: false, periodMinutes: 40, lessonPeriods: 8,
      breaks: [
        { afterPeriod: 0, time: '07:00', minutes: 15, name: 'ASSEMBLY', event: 'assembly', enabled: true, days: ['Monday'], placement: 'period1' },
        { afterPeriod: 3, time: '09:00', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '11:00', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: false },
      ],
    },
  },
  {
    // The reference Grade 4A timetable: reports 12:40, ends 16:50, assembly
    // occupying the first period slot on Monday only.
    id: 'government-afternoon-session',
    label: 'Government — afternoon session (12:40)',
    description: 'The afternoon session of a shift school: reports 12:40, 40-minute periods, a 10-minute break mid-afternoon, knocks off 16:50. Assembly takes the first period slot on Monday.',
    dayType: 'full',
    timing: {
      session: 'afternoon', timingMode: 'fixed',
      startTime: '12:40', endTime: '16:50', fitToEndTime: false, periodMinutes: 40, lessonPeriods: 6,
      breaks: [
        { afterPeriod: 0, time: '12:40', minutes: 40, name: 'ASSEMBLY', event: 'assembly', enabled: true, days: ['Monday'], placement: 'period1' },
        { afterPeriod: 3, time: '14:40', minutes: 10, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '15:30', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: false },
      ],
    },
  },
  {
    // The reference private school: 60-minute lessons, a 30-minute break and
    // a 90-minute lunch — none of which fits one "period length" number.
    id: 'private-full-day',
    label: 'Private — full day (break + lunch)',
    description: 'A private-school full day: 60-minute lessons, a 30-minute morning break, a 90-minute lunch, and assembly on Monday and Friday.',
    dayType: 'full',
    timing: {
      session: 'full', timingMode: 'fixed',
      startTime: '08:00', endTime: '16:00', fitToEndTime: false, periodMinutes: 60, lessonPeriods: 6,
      breaks: [
        { afterPeriod: 0, time: '07:40', minutes: 20, name: 'ASSEMBLY', event: 'assembly', enabled: true, days: ['Monday', 'Friday'], placement: 'before' },
        { afterPeriod: 2, time: '10:00', minutes: 30, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 4, time: '12:30', minutes: 90, name: 'LUNCH', event: 'lunch', enabled: true },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: false },
      ],
    },
  },
  {
    id: 'half-day-friday',
    label: 'Half-day Friday',
    description: 'The common weekly Friday: normal reporting time, one break, knocks off at 12:30. Apply it to Friday from the day-specific structure below.',
    dayType: 'half',
    timing: {
      session: 'full', timingMode: 'fit',
      startTime: '07:30', endTime: '12:30', fitToEndTime: true, periodMinutes: 40, lessonPeriods: 6,
      breaks: [
        { afterPeriod: 0, time: '07:30', minutes: 15, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 2, time: '09:50', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '11:30', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: false },
      ],
    },
  },
  {
    id: 'half-day',
    label: 'Half day',
    description: 'A shortened teaching day that knocks off around midday — the common weekly half-day pattern (e.g. Friday 12:30). The knock-off time is fixed and the periods share whatever teaching time is left.',
    dayType: 'half',
    timing: {
      startTime: '07:30', endTime: '12:30', fitToEndTime: true, periodMinutes: 35, lessonPeriods: 6,
      breaks: [
        { afterPeriod: 0, time: '07:30', minutes: 15, name: 'ASSEMBLY', event: 'assembly', enabled: true },
        { afterPeriod: 3, time: '09:40', minutes: 20, name: 'BREAK', event: 'break', enabled: true },
        { afterPeriod: 5, time: '11:30', minutes: 40, name: 'LUNCH', event: 'lunch', enabled: false },
        { afterPeriod: 'end', time: '', minutes: 5, name: 'CLOSING', event: 'closing', enabled: true },
      ],
    },
  },
  {
    id: 'custom',
    label: 'Custom school day',
    description: 'Start from the current settings and shape the day yourself.',
    dayType: 'custom',
    timing: null,
  },
]

/** The templates belonging to one day type — what the per-day picker offers
 * once a teacher chooses Full day / Half day / Custom for a specific day. */
export function templatesForDayType(dayType) {
  return SCHOOL_DAY_TEMPLATES.filter((t) => t.dayType === dayType)
}

export function getSchoolDayTemplate(id) {
  return SCHOOL_DAY_TEMPLATES.find((t) => t.id === id) || null
}

/** The clock time the day finishes — the end of the last row (the last lesson,
 * or the closing row when there is one). '' for an empty period list. */
export function dayEndTime(periods) {
  const rows = Array.isArray(periods) ? periods : []
  return rows.length ? rows[rows.length - 1].end : ''
}

/** The clock time the last lesson ends — the teaching knock-off, ignoring any
 * trailing closing/assembly row. '' when there are no lesson rows. */
export function lastLessonEndTime(periods) {
  const lessons = lessonPeriods(periods)
  return lessons.length ? lessons[lessons.length - 1].end : ''
}

/** Just the lesson rows of a period list (the fillable rows). */
export function lessonPeriods(periods) {
  return (Array.isArray(periods) ? periods : []).filter((p) => p.kind === 'lesson')
}

/** How many lesson cells the grid has: lesson rows × teaching days. */
export function lessonCapacity(periods, days) {
  return lessonPeriods(periods).length * (Array.isArray(days) ? days.length : 0)
}

/* ── Subjects from the curriculum ─────────────────────────────── */

/**
 * Sensible default number of weekly periods for a subject, by name. Core
 * subjects (Maths, English, Science) carry the heaviest load, matching how
 * Zambian primary timetables are weighted. Anything unrecognised gets 3.
 */
export function defaultPeriodsPerWeek(label = '') {
  const s = String(label).toLowerCase()
  if (/math/.test(s)) return 6
  if (/english|literacy|\blanguage\b/.test(s)) return 6
  if (/science/.test(s)) return 5
  if (/social|history|geograph|civic|religious/.test(s)) return 4
  return 3
}

let subjectSeq = 0
function makeSubject(label, extra = {}) {
  subjectSeq += 1
  return {
    id: extra.subjectId || `s${subjectSeq}`,
    subjectId: extra.subjectId || null,
    label,
    // The name printed on the grid when it differs from the canonical
    // learning area — a school teaching Chinyanja prints "Chinyanja" while
    // the week is still accounted for as Zambian Language.
    displayLabel: extra.displayLabel || null,
    // The cell code (ENG, MATHS, ZIL …). Null until derived/edited.
    abbreviation: extra.abbreviation || null,
    // A subject the SCHOOL adds beyond the curriculum (Literacy, Swimming).
    // Placeable and printable, never part of curriculum coverage totals.
    schoolSubject: extra.schoolSubject ?? false,
    shortName: extra.shortName || null,
    periodsPerWeek: extra.periodsPerWeek ?? defaultPeriodsPerWeek(label),
    load: extra.load || subjectLoad(label),
    category: extra.category || null,
    choiceGroup: extra.choiceGroup || null,
    optionGroupId: extra.optionGroupId ?? extra.choiceGroup ?? null,
    timeAllocation: extra.timeAllocation || null,
    weeklyMinutes: extra.weeklyMinutes ?? null,
    compulsory: extra.compulsory ?? null,
    subjectType: extra.subjectType || null,
    blockPreference: extra.blockPreference || null,
    selected: extra.selected ?? true,
  }
}

/**
 * The curriculum subject list for a curriculum + grade (+ option choices),
 * each seeded with its official weekly allocation.
 *
 * When the selected curriculum prescribes an allocation (CBC 2023 ECE /
 * Lower / Upper Primary, or the adapted baseline), the official subjects,
 * ids, block preferences and period counts are used verbatim. Option-group
 * alternatives that are NOT selected come back at 0 periods so the week
 * sums to the framework total. For grades without a prescribed allocation
 * (Grade 7, secondary, OBC 2013, custom) it falls back to the canonical
 * Library subject list with heuristic weekly counts. Returns [] only when
 * no list exists at all (caller seeds a minimal core).
 */
export function curriculumSubjectsForGrade(grade, curriculumId = DEFAULT_CURRICULUM_ID, selectedOptions = {}) {
  const framework = resolveTimetableCurriculum({ curriculumId, grade, selectedOptions })
  if (framework) {
    return framework.subjects.map((s) => makeSubject(s.label, {
      subjectId: s.id,
      shortName: s.shortName,
      periodsPerWeek: s.periodsPerWeek,
      load: s.load,
      category: s.category,
      choiceGroup: s.choiceGroup,
      optionGroupId: s.optionGroupId,
      timeAllocation: s.timeAllocation,
      weeklyMinutes: s.weeklyMinutes,
      compulsory: s.compulsory,
      subjectType: s.subjectType,
      blockPreference: s.blockPreference,
      selected: s.selected,
    }))
  }
  const { syllabus, gradeForm } = resolveGradeForm(grade)
  const labels = getSubjectsForGradeForm(syllabus, gradeForm)
  return labels.map((l) => makeSubject(l))
}

/**
 * Build a fresh subject row the studio can append.
 *
 * Anything a teacher adds by hand is a SCHOOL subject by default: it is not
 * in the curriculum's official table, so it must not count toward curriculum
 * coverage. A teacher who is really restoring an official area resets the
 * subjects from the curriculum instead.
 */
export function newSubject(label = 'New subject', extra = {}) {
  return makeSubject(label, { schoolSubject: true, ...extra })
}

/* ── The Zambian Language display name ────────────────────────────
 * A school teaches an actual language — Chinyanja, Bemba, Tonga, Lozi — and
 * writes that on the wall, while the curriculum still accounts for it as
 * "Zambian Language". The same mechanism relabels the ECE / adapted language
 * provision (English Language / Sign Language / Braille).
 */

export const ZAMBIAN_LANGUAGE_SUGGESTIONS = [
  'Chinyanja', 'IciBemba', 'Chitonga', 'Silozi', 'Kiikaonde', 'Lunda', 'Luvale',
]

/** Does this subject row carry the language provision the display name
 * applies to? Matched on the canonical subject id (never a loose name), with
 * a name fallback for hand-built lists that have no ids. */
export function isZambianLanguageSubject(subject) {
  const id = String(subject?.subjectId || '')
  if (/zambian-language/.test(id)) return true
  if (/literacy-language-zambian/.test(id)) return true
  return !subject?.subjectId && /zambian\s*lang/i.test(String(subject?.label || ''))
}

/** Apply (or clear) the language display name across a subject list.
 * Rows that already carry the right name are returned UNCHANGED (same
 * object), so a caller can tell a real edit from a no-op. */
export function withLanguageName(subjects, languageName) {
  const name = String(languageName || '').trim() || null
  return (Array.isArray(subjects) ? subjects : []).map((s) => {
    if (!isZambianLanguageSubject(s)) return s
    return (s.displayLabel || null) === name ? s : { ...s, displayLabel: name }
  })
}

/** The name a subject is PRINTED under. */
export function subjectDisplayLabel(subject) {
  return String(subject?.displayLabel || '').trim() || subject?.label || ''
}

/**
 * Generation guard — is the loaded subject list a COMPLETE resolution of the
 * curriculum's official allocation for this grade?
 *
 * Matches the studio's loaded subjects to the resolved framework by CANONICAL
 * subjectId (never by loose display-name matching) and reports, exactly as the
 * admin diagnostic panel needs:
 *   resolvedSubjects / requiredSubjects  — how many official areas are present
 *   resolvedPeriods  / requiredPeriods   — the official periods of the present
 *                                          areas vs the curriculum total
 *   resolvedMinutes  / requiredMinutes   — the same in contact minutes
 *   missing[]                            — the official areas not yet loaded
 *
 * `ready` is true only when every official area resolves (so a stale draft that
 * dropped Mathematics and Science — 32 of 42 periods — is caught and generation
 * is blocked). Editing an allocation's period counts does NOT make it
 * incomplete: readiness keys on the SET of canonical areas, using each area's
 * official periods, so a legitimate "customised from baseline" week still
 * resolves to the full 42. `applicable:false` means the curriculum prescribes no
 * allocation for this grade (OBC / custom / CBC Grade 7 / secondary).
 */
export function resolveAllocationReadiness({ subjects, curriculum } = {}) {
  if (!curriculum || !Array.isArray(curriculum.subjects)) {
    return {
      applicable: false, ready: false,
      requiredSubjects: 0, resolvedSubjects: 0,
      requiredPeriods: 0, resolvedPeriods: 0,
      requiredMinutes: null, resolvedMinutes: 0,
      missing: [],
    }
  }
  const required = curriculum.subjects.filter(
    (s) => s.selected !== false && (Number(s.weeklyPeriods ?? s.periodsPerWeek) || 0) > 0,
  )
  const loadedIds = new Set(
    (Array.isArray(subjects) ? subjects : [])
      .filter((s) => s.selected !== false)
      .map((s) => s.subjectId || s.id)
      .filter(Boolean),
  )
  const missing = []
  let resolvedSubjects = 0
  let resolvedPeriods = 0
  let resolvedMinutes = 0
  for (const r of required) {
    const id = r.subjectId || r.id
    const periods = Number(r.weeklyPeriods ?? r.periodsPerWeek) || 0
    const minutes = Number(r.weeklyMinutes) || periods * (Number(curriculum.periodLengthMinutes ?? curriculum.periodMinutes) || 0)
    if (id && loadedIds.has(id)) {
      resolvedSubjects += 1
      resolvedPeriods += periods
      resolvedMinutes += minutes
    } else {
      missing.push({ subjectId: id, label: r.label || r.canonicalName || id, weeklyPeriods: periods })
    }
  }
  const requiredPeriods = curriculum.requiredWeeklyPeriods
    ?? required.reduce((n, r) => n + (Number(r.weeklyPeriods ?? r.periodsPerWeek) || 0), 0)
  const requiredMinutes = curriculum.weeklyContactMinutes ?? null
  const ready = missing.length === 0
    && resolvedPeriods === requiredPeriods
    && (requiredMinutes == null || resolvedMinutes === requiredMinutes)
  return {
    applicable: true, ready,
    requiredSubjects: required.length, resolvedSubjects,
    requiredPeriods, resolvedPeriods,
    requiredMinutes, resolvedMinutes,
    missing,
  }
}

/**
 * Lesson periods per day needed to fit a weekly total across the teaching
 * days, e.g. 42 periods over 5 days → 9/day. Clamped to the studio's 1–14
 * range. Used to right-size the grid for the framework's weekly load.
 */
export function recommendedLessonPeriods(totalPeriods, days) {
  const d = Array.isArray(days) ? days.length : Math.round(Number(days) || 0)
  const total = Math.round(Number(totalPeriods) || 0)
  if (!d || total <= 0) return DEFAULT_TIMING.lessonPeriods
  return Math.min(14, Math.max(1, Math.ceil(total / d)))
}

/* ── Day structure (per-day lesson counts) ────────────────────── */

/**
 * Spread a weekly period total across the teaching days as evenly as
 * possible (Mode A — "exact curriculum week"). 42 over Mon–Fri →
 * { Monday: 9, Tuesday: 9, Wednesday: 8, Thursday: 8, Friday: 8 }.
 */
export function distributePeriodsPerDay(totalPeriods, days) {
  const dayList = Array.isArray(days) ? days : []
  const total = Math.max(0, Math.round(Number(totalPeriods) || 0))
  if (!dayList.length) return {}
  const base = Math.floor(total / dayList.length)
  let extra = total - base * dayList.length
  const out = {}
  for (const day of dayList) {
    out[day] = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
  }
  return out
}

/* ── Day structure (independent per-day school days) ─────────────
 *
 * A day-specific structure lives at dayStructure.daySchedules[day] =
 * { dayType: 'full'|'half'|'custom', templateId, timing }. A day with no
 * entry there inherits the timetable's base timing/periods (the original,
 * uniform-week behaviour) — so every saved v1/v2 timetable keeps loading
 * and behaving exactly as before. A day WITH an entry ignores the base
 * timing entirely: its own reporting time, knock-off time, assembly,
 * breaks, lunch and lesson-period count are all its own. `timing` is the
 * source of truth; periods are always derived fresh via buildPeriods() so
 * they can never drift stale.
 *
 * This recurring, saved-with-the-timetable structure is deliberately
 * separate from a School Calendar date-specific override (see
 * `effectiveDayScheduleForDate` below): a regular weekly half day (e.g.
 * Friday knocking off at 12:30 every week) belongs here; an occasional
 * one-off half day belongs to the calendar and must never touch this.
 */

/** The day's own override entry, or null when the day inherits the base
 * timing. */
export function dayScheduleOverride(day, dayStructure) {
  return dayStructure?.daySchedules?.[day] || null
}

/** Immutably set (or clear, when `schedule` is falsy) one day's override,
 * returning a new dayStructure. Every other field (e.g. periodsPerDay) is
 * preserved untouched. */
export function withDaySchedule(dayStructure, day, schedule) {
  const daySchedules = { ...(dayStructure?.daySchedules || {}) }
  if (schedule) daySchedules[day] = schedule
  else delete daySchedules[day]
  return { ...(dayStructure || {}), daySchedules }
}

/**
 * The built period rows (lessons + breaks) that actually apply to one
 * specific teaching day.
 *
 * Priority: that day's own school-day override, then the timetable's base
 * `timing` rebuilt FOR THIS DAY (which is what makes a Monday-only assembly
 * or a day-scoped break real), then the pre-built base rows.
 *
 * `timing` is optional throughout: a saved timetable written before this
 * pass carries none, so it resolves to `basePeriods` and behaves exactly as
 * it always did.
 */
export function periodsForDay(day, basePeriods, dayStructure, timing = null) {
  const override = dayScheduleOverride(day, dayStructure)
  if (override?.timing) return buildPeriods(override.timing, { day })
  if (timing) return buildPeriods(timing, { day })
  return Array.isArray(basePeriods) ? basePeriods : []
}

/** The clock time a specific day reports at (assembly/opening), from that
 * day's own resolved periods. '' when there are no rows. */
export function reportingTimeForDay(day, basePeriods, dayStructure, timing = null) {
  const rows = periodsForDay(day, basePeriods, dayStructure, timing)
  return rows.length ? rows[0].start : ''
}

/** The clock time a specific day's last lesson ends (the real knock-off),
 * from that day's own resolved periods. */
export function knockOffTimeForDay(day, basePeriods, dayStructure, timing = null) {
  return lastLessonEndTime(periodsForDay(day, basePeriods, dayStructure, timing))
}

/** Lesson slots available on a day: a day-specific override's own lesson
 * count when set, otherwise the grid's shared lesson rows, optionally
 * shortened by dayStructure.periodsPerDay (Mode A, legacy count-only
 * override). */
export function slotCountForDay(day, periods, dayStructure, timing = null) {
  const override = dayScheduleOverride(day, dayStructure)
  if (override?.timing) return lessonPeriods(buildPeriods(override.timing, { day })).length
  // A day-scoped assembly/break changes this day's own lesson count (the
  // government pattern gives Monday one fewer lesson), so the day's real
  // rows decide — never the shared reference list.
  const rows = timing
    ? lessonPeriods(buildPeriods(timing, { day })).length
    : lessonPeriods(periods).length
  const countOverride = dayStructure?.periodsPerDay?.[day]
  if (countOverride == null) return rows
  const n = Math.round(Number(countOverride))
  if (!Number.isFinite(n)) return rows
  return Math.min(rows, Math.max(0, n))
}

/** Total fillable lesson cells across the week, honouring per-day counts
 * and per-day school-day overrides. */
export function weeklyCapacity(periods, days, dayStructure, timing = null) {
  return (Array.isArray(days) ? days : [])
    .reduce((sum, d) => sum + slotCountForDay(d, periods, dayStructure, timing), 0)
}

/**
 * The teaching MINUTES the week actually holds — every lesson row on every
 * teaching day, measured from its own clock times.
 *
 * This is the number a shift session's coverage target is built from, and
 * the number that makes "24h 40m of 28h placed" possible. It cannot be
 * derived from a period count once a school runs 60-minute lessons or types
 * its own period times, which is exactly why it is measured.
 */
export function weeklyLessonMinutes({ periods, days, dayStructure, timing } = {}) {
  let total = 0
  for (const day of Array.isArray(days) ? days : []) {
    const rows = lessonPeriods(periodsForDay(day, periods, dayStructure, timing))
    const cap = slotCountForDay(day, periods, dayStructure, timing)
    rows.slice(0, cap).forEach((r) => { total += timeToMinutes(r.end) - timeToMinutes(r.start) })
  }
  return total
}

/**
 * How long a lesson is at this school, and whether every lesson really is
 * that long.
 *
 * `uniform` is what decides whether coverage may be spoken in PERIODS at
 * all: once a day mixes lesson lengths (custom period times, a fitted
 * half-day), "38/42" is not a true statement about anything and the studio
 * must switch to hours.
 *
 * @returns {{ minutes:number, uniform:boolean, lessons:number }}
 */
export function lessonLengthProfile({ periods, days, dayStructure, timing } = {}) {
  const lengths = []
  for (const day of Array.isArray(days) ? days : []) {
    const rows = lessonPeriods(periodsForDay(day, periods, dayStructure, timing))
    const cap = slotCountForDay(day, periods, dayStructure, timing)
    rows.slice(0, cap).forEach((r) => lengths.push(timeToMinutes(r.end) - timeToMinutes(r.start)))
  }
  if (!lengths.length) {
    const fallback = Math.round(Number(timing?.periodMinutes) || DEFAULT_TIMING.periodMinutes)
    return { minutes: fallback, uniform: true, lessons: 0 }
  }
  // The modal length — a single odd row (a fitted segment absorbing
  // rounding) must not redefine what a lesson is at this school.
  const counts = new Map()
  for (const n of lengths) counts.set(n, (counts.get(n) || 0) + 1)
  let minutes = lengths[0]
  let best = 0
  for (const [n, c] of counts) if (c > best || (c === best && n > minutes)) { minutes = n; best = c }
  return { minutes, uniform: counts.size === 1, lessons: lengths.length }
}

/**
 * Apply a session's seeded report/knock-off times to a timing config.
 * Full day and Custom seed nothing — the teacher's own times are kept.
 */
export function applySessionToTiming(timing, sessionId) {
  const defaults = sessionDefaults(sessionId)
  const next = { ...(timing || {}), session: sessionId }
  if (!defaults) return next
  return { ...next, startTime: defaults.startTime, endTime: defaults.endTime }
}

/**
 * Whether the complete weekly curriculum allocation can physically fit the
 * timetable's per-day capacity. Generation must be BLOCKED (never silently
 * truncated) when it cannot — the teacher needs to add lesson periods or
 * change a day's structure first.
 *
 * @returns {{fits:boolean, required:number, capacity:number, shortfall:number,
 *   perDay:Object<string,number>}}
 */
export function resolveCapacityFit({ subjects, days, periods, dayStructure, timing = null }) {
  const dayList = Array.isArray(days) ? days : []
  const required = totalAllocated(subjects)
  const perDay = {}
  let capacity = 0
  for (const day of dayList) {
    const n = slotCountForDay(day, periods, dayStructure, timing)
    perDay[day] = n
    capacity += n
  }
  return {
    fits: required <= capacity,
    required,
    capacity,
    shortfall: Math.max(0, required - capacity),
    perDay,
  }
}

/* ── School Calendar overrides (date-specific, one-off) ───────────
 *
 * A calendar override records an occasional change to ONE calendar date —
 * e.g. "Friday 14 Aug is a half day for a staff meeting" — WITHOUT touching
 * the saved weekly daySchedules. A regular recurring change (every Friday is
 * a half day) belongs in daySchedules (above); an occasional one-off belongs
 * here, keyed by exact date so it can never leak into the recurring weekly
 * pattern or silently change what auto-fill/generation plans for that
 * weekday every other week.
 *
 * Each override: { date: 'YYYY-MM-DD', dayType, templateId, timing, reason }
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The weekday name ('Monday', …) for a 'YYYY-MM-DD' date string, or null
 * when the date can't be parsed. */
export function weekdayNameForDate(date) {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return WEEKDAY_NAMES[d.getDay()]
}

/** Immutably add/replace one calendar override by date, returning a new
 * array sorted by date. */
export function withCalendarOverride(calendarOverrides, override) {
  const list = (Array.isArray(calendarOverrides) ? calendarOverrides : [])
    .filter((o) => o.date !== override.date)
  list.push(override)
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Remove the override recorded for one date, if any. */
export function removeCalendarOverride(calendarOverrides, date) {
  return (Array.isArray(calendarOverrides) ? calendarOverrides : []).filter((o) => o.date !== date)
}

/** The override recorded for an exact calendar date, or null. */
export function calendarOverrideForDate(calendarOverrides, date) {
  return (Array.isArray(calendarOverrides) ? calendarOverrides : []).find((o) => o.date === date) || null
}

/**
 * What school actually looks like on ONE calendar date — never a mutation of
 * the saved timetable. Priority: a School Calendar override for that EXACT
 * date wins first; otherwise the recurring weekly daySchedules entry for
 * that date's weekday; otherwise the timetable's base timing.
 *
 * `weekday` is derived from `date` when not given explicitly.
 */
export function effectiveDayScheduleForDate({ date, weekday, periods, dayStructure, calendarOverrides }) {
  const wd = weekday || weekdayNameForDate(date)
  const override = calendarOverrideForDate(calendarOverrides, date)
  if (override?.timing) {
    return {
      date, weekday: wd,
      dayType: override.dayType || 'custom',
      templateId: override.templateId || null,
      source: 'calendar-override',
      reason: override.reason || null,
      periods: buildPeriods(override.timing),
    }
  }
  const dayOverride = dayScheduleOverride(wd, dayStructure)
  if (dayOverride?.timing) {
    return {
      date, weekday: wd,
      dayType: dayOverride.dayType || 'custom',
      templateId: dayOverride.templateId || null,
      source: 'weekly-structure',
      reason: null,
      periods: buildPeriods(dayOverride.timing),
    }
  }
  return {
    date, weekday: wd,
    dayType: 'full',
    templateId: null,
    source: 'base',
    reason: null,
    periods: Array.isArray(periods) ? periods : [],
  }
}

/* ── Auto-fill ────────────────────────────────────────────────── */

/**
 * Round-robin token expansion: a subject needing N periods contributes N
 * tokens, interleaved so the same subject's tokens are maximally spaced.
 *   [{A,3},{B,2}] → [A,B,A,B,A]
 */
export function roundRobinTokens(subjects) {
  const remaining = (Array.isArray(subjects) ? subjects : [])
    .map((s) => ({ id: s.id, label: s.label, n: Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)) }))
    .filter((s) => s.n > 0)
  const out = []
  let progressed = true
  while (progressed) {
    progressed = false
    for (const s of remaining) {
      if (s.n > 0) { out.push({ id: s.id, label: s.label }); s.n -= 1; progressed = true }
    }
  }
  return out
}

/**
 * Distribute subjects across the lesson grid as a balanced, curriculum-aware
 * week.
 *
 * Returns a `slots` map: { [lessonPeriodId]: { [day]: subjectLabel } }. The
 * placement is greedy and deterministic:
 *   1. expand subjects into round-robin tokens (spreads each subject out),
 *   2. for each token gather the free cells, preferring days that don't yet
 *      hold that subject (so a subject lands once per day while it can),
 *   3. score the candidates and take the best, applying the practical school
 *      rules: spread the load evenly across the week, keep cognitively heavy
 *      subjects (Maths, Science, English, …) from piling into a single day,
 *      and seat heavy subjects earlier in the day and lighter ones later.
 *
 * Subjects whose combined allocation exceeds capacity simply stop being
 * placed once the grid is full; spare capacity leaves cells empty.
 */
export function autoFillTimetable({ subjects, days, periods }) {
  const rows = lessonPeriods(periods)
  const dayList = Array.isArray(days) ? days : []
  const subjList = Array.isArray(subjects) ? subjects : []
  const lastRow = Math.max(0, rows.length - 1)

  const weightById = new Map(subjList.map((s) => [
    s.id,
    s.load ? (LOAD_WEIGHT[s.load] || LOAD_WEIGHT.medium) : subjectLoadWeight(s.label),
  ]))

  const occupied = new Set()
  const usedPerDay = new Map(dayList.map((d) => [d, new Set()]))   // subject ids placed that day
  const heavyPerDay = new Map(dayList.map((d) => [d, 0]))          // heavy lessons per day
  const totalPerDay = new Map(dayList.map((d) => [d, 0]))          // all lessons per day
  const slots = {}
  const tokens = roundRobinTokens(subjList)

  for (const tok of tokens) {
    const weight = weightById.get(tok.id) ?? LOAD_WEIGHT.medium
    const isHeavy = weight >= LOAD_WEIGHT.heavy

    const free = []
    for (let pi = 0; pi < rows.length; pi += 1) {
      for (let di = 0; di < dayList.length; di += 1) {
        const day = dayList[di]
        if (occupied.has(`${rows[pi].id}__${day}`)) continue
        free.push({ pi, di, day, pid: rows[pi].id, fresh: !usedPerDay.get(day).has(tok.id) })
      }
    }
    if (!free.length) break // grid full
    const freshOnly = free.filter((c) => c.fresh)
    const pool = freshOnly.length ? freshOnly : free // relax once the grid is tight

    // Lower score is better.
    const score = (c) => {
      let s = totalPerDay.get(c.day) * 10        // 1. even spread across the week
      if (isHeavy) s += heavyPerDay.get(c.day) * 6 // 2. don't cluster heavy subjects
      s += isHeavy ? c.pi : (lastRow - c.pi)     // 3. heavy earlier, light later
      return s
    }
    pool.sort((a, b) => score(a) - score(b) || a.pi - b.pi || a.di - b.di)
    const best = pool[0]

    occupied.add(`${best.pid}__${best.day}`)
    usedPerDay.get(best.day).add(tok.id)
    totalPerDay.set(best.day, totalPerDay.get(best.day) + 1)
    if (isHeavy) heavyPerDay.set(best.day, heavyPerDay.get(best.day) + 1)
    if (!slots[best.pid]) slots[best.pid] = {}
    slots[best.pid][best.day] = tok.label
  }
  return slots
}

/**
 * Block-aware auto-fill — the v2 generator.
 *
 * Places explicit schedule blocks (singles + double periods) instead of raw
 * cells, honouring:
 *   - locked blocks (kept verbatim; their periods count toward the subject's
 *     weekly allocation)
 *   - per-day lesson counts (Mode A: a 42-period week over 9/9/8/8/8 days)
 *   - block preferences (a subject wanting double periods gets them placed
 *     inside one segment — never across a break/lunch/assembly)
 *   - the balanced-week scoring the studio has always used (spread the load,
 *     don't cluster heavy subjects, heavy earlier / light later)
 *   - unselected option-group subjects (0 periods) are never placed
 *
 * With `activities` given (Mode B), spare lesson cells are filled with
 * school-activity blocks — labelled, non-curriculum time — preferring the
 * end of the day, so no unexplained dashes sit mid-timetable.
 *
 * Never silently returns an invalid week: the result carries `unplaced`
 * (what couldn't fit + why) and `notes` for the validation panel.
 *
 * @returns {{ blocks:Array, unplaced:Array<{label,missing,reason}>, notes:string[] }}
 */
export function autoFillBlocks({ subjects, days, periods, dayStructure, timing = null, lockedBlocks = [], activities = [] }) {
  const dayList = Array.isArray(days) ? days : []
  const subjList = (Array.isArray(subjects) ? subjects : []).filter((s) => (Number(s.periodsPerWeek) || 0) > 0)
  // Each day resolves its OWN periods/segments — a day-specific override
  // (see periodsForDay) never shares a break layout or knock-off time with
  // another day, so a double period or a placement can never cross into
  // another day's structure, and nothing is ever placed past a day's own
  // last lesson row.
  const segmentsByDay = new Map(dayList.map((d) => [d, segmentsOf(periodsForDay(d, periods, dayStructure, timing))]))
  const capacityOf = (day) => slotCountForDay(day, periods, dayStructure, timing)
  const lastRowOf = (day) => Math.max(0, capacityOf(day) - 1)
  const notes = []
  const unplaced = []

  // Occupancy from locked blocks (drop any that no longer fit the grid).
  const occupied = new Set()
  const blocks = []
  const lockedCounts = new Map() // label → periods held by locked blocks
  for (const b of Array.isArray(lockedBlocks) ? lockedBlocks : []) {
    if (!dayList.includes(b.day)) continue
    if (b.startSlot < 1 || b.startSlot + b.length - 1 > capacityOf(b.day)) continue
    let clash = false
    for (const s of blockSlots(b)) if (occupied.has(`${b.day}__${s}`)) clash = true
    if (clash) continue
    for (const s of blockSlots(b)) occupied.add(`${b.day}__${s}`)
    blocks.push({ ...b, locked: true })
    if (b.type === BLOCK_TYPES.CURRICULUM && b.label) {
      lockedCounts.set(b.label, (lockedCounts.get(b.label) || 0) + b.length)
    }
  }

  // Balance bookkeeping (locked blocks included).
  const weightById = new Map(subjList.map((s) => [
    s.id, s.load ? (LOAD_WEIGHT[s.load] || LOAD_WEIGHT.medium) : subjectLoadWeight(s.label),
  ]))
  const totalPerDay = new Map(dayList.map((d) => [d, 0]))
  const heavyPerDay = new Map(dayList.map((d) => [d, 0]))
  const subjectPerDay = new Map(dayList.map((d) => [d, new Map()])) // day → label → count
  for (const b of blocks) {
    if (b.type !== BLOCK_TYPES.CURRICULUM) continue
    totalPerDay.set(b.day, (totalPerDay.get(b.day) || 0) + b.length)
    const map = subjectPerDay.get(b.day)
    if (map) map.set(b.label, (map.get(b.label) || 0) + b.length)
    if (subjectLoad(b.label) === 'heavy') heavyPerDay.set(b.day, (heavyPerDay.get(b.day) || 0) + b.length)
  }

  const remaining = new Map()
  for (const s of subjList) {
    const target = Math.max(0, Math.round(Number(s.periodsPerWeek) || 0))
    remaining.set(s.id, Math.max(0, target - (lockedCounts.get(s.label) || 0)))
  }
  const maxPerDayOf = (s) => {
    const explicit = Math.round(Number(s.maxPeriodsPerDay))
    if (Number.isFinite(explicit) && explicit > 0) return explicit
    const target = Math.max(0, Math.round(Number(s.periodsPerWeek) || 0))
    const spread = dayList.length ? Math.ceil(target / dayList.length) : target
    const biggestBlock = Math.max(1, ...(s.blockPreference?.preferredBlocks || [1]))
    return Math.max(spread, biggestBlock)
  }

  const place = (subject, day, startSlot, length) => {
    const isHeavy = (weightById.get(subject.id) ?? LOAD_WEIGHT.medium) >= LOAD_WEIGHT.heavy
    blocks.push(makeBlock({
      day, startSlot, length,
      subjectId: subject.subjectId || subject.id || null,
      label: subject.label,
      type: BLOCK_TYPES.CURRICULUM,
    }))
    for (let s = startSlot; s < startSlot + length; s += 1) occupied.add(`${day}__${s}`)
    totalPerDay.set(day, (totalPerDay.get(day) || 0) + length)
    const map = subjectPerDay.get(day)
    if (map) map.set(subject.label, (map.get(subject.label) || 0) + length)
    if (isHeavy) heavyPerDay.set(day, (heavyPerDay.get(day) || 0) + length)
    remaining.set(subject.id, (remaining.get(subject.id) || 0) - length)
  }

  /* Phase 1 — preferred double periods, most-doubles-first so practical
   * subjects claim adjacent pairs before the grid tightens. */
  const doublesWanted = subjList.map((s) => ({
    s,
    n: Math.min(
      Math.floor((remaining.get(s.id) || 0) / 2),
      (s.blockPreference?.preferredBlocks || []).filter((b) => b >= 2).length,
    ),
  })).filter((d) => d.n > 0)
  doublesWanted.sort((a, b) => b.n - a.n || (b.s.periodsPerWeek || 0) - (a.s.periodsPerWeek || 0))

  for (const { s, n } of doublesWanted) {
    const weight = weightById.get(s.id) ?? LOAD_WEIGHT.medium
    const isHeavy = weight >= LOAD_WEIGHT.heavy
    const maxPerDay = maxPerDayOf(s)
    for (let k = 0; k < n; k += 1) {
      if ((remaining.get(s.id) || 0) < 2) break
      const candidates = []
      for (const day of dayList) {
        const cap = capacityOf(day)
        const already = subjectPerDay.get(day)?.get(s.label) || 0
        if (already + 2 > maxPerDay) continue
        for (const seg of segmentsByDay.get(day) || []) {
          for (const slot of seg) {
            if (slot + 1 > cap || !seg.includes(slot + 1)) continue
            if (occupied.has(`${day}__${slot}`) || occupied.has(`${day}__${slot + 1}`)) continue
            candidates.push({ day, slot, already })
          }
        }
      }
      if (!candidates.length) {
        notes.push(`Could not place a preferred ${s.label} double period — it will be placed as single periods instead.`)
        break
      }
      const score = (c) => {
        let v = c.already * 40                       // spread the subject across days
          + (totalPerDay.get(c.day) || 0) * 10       // even weekly spread
        if (isHeavy) v += (heavyPerDay.get(c.day) || 0) * 6
        v += isHeavy ? c.slot : (lastRowOf(c.day) - c.slot)   // heavy early, light/practical later
        return v
      }
      candidates.sort((a, b) => score(a) - score(b) || a.slot - b.slot || dayList.indexOf(a.day) - dayList.indexOf(b.day))
      const best = candidates[0]
      place(s, best.day, best.slot, 2)
    }
  }

  /* Phase 2 — remaining periods as singles, round-robin interleaved. */
  const tokens = roundRobinTokens(subjList.map((s) => ({
    id: s.id, label: s.label, periodsPerWeek: remaining.get(s.id) || 0,
  })))
  const byId = new Map(subjList.map((s) => [s.id, s]))
  for (const tok of tokens) {
    const s = byId.get(tok.id)
    if (!s || (remaining.get(s.id) || 0) <= 0) continue
    const weight = weightById.get(s.id) ?? LOAD_WEIGHT.medium
    const isHeavy = weight >= LOAD_WEIGHT.heavy
    const maxPerDay = maxPerDayOf(s)

    const free = []
    for (const day of dayList) {
      const cap = capacityOf(day)
      const already = subjectPerDay.get(day)?.get(s.label) || 0
      for (let slot = 1; slot <= cap; slot += 1) {
        if (occupied.has(`${day}__${slot}`)) continue
        free.push({ day, slot, already, overCap: already >= maxPerDay })
      }
    }
    if (!free.length) {
      unplaced.push({ label: s.label, missing: remaining.get(s.id) || 0, reason: 'The grid is full — add lesson periods or reduce another subject.' })
      remaining.set(s.id, 0)
      continue
    }
    // Prefer days that don't hold this subject yet, then days under the
    // per-day cap; only then relax (a tight grid beats dropping the period).
    const freshOnly = free.filter((c) => c.already === 0)
    const underCap = free.filter((c) => !c.overCap)
    const pool = freshOnly.length ? freshOnly : (underCap.length ? underCap : free)

    const score = (c) => {
      let v = c.already * 40
        + (totalPerDay.get(c.day) || 0) * 10
      if (isHeavy) v += (heavyPerDay.get(c.day) || 0) * 6
      v += isHeavy ? c.slot : (lastRowOf(c.day) - c.slot)
      return v
    }
    pool.sort((a, b) => score(a) - score(b) || a.slot - b.slot || dayList.indexOf(a.day) - dayList.indexOf(b.day))
    const best = pool[0]
    place(s, best.day, best.slot, 1)
  }

  /* Phase 3 — spare cells become school activities (Mode B). Fill from the
   * END of each day so activities close the day rather than punch holes. */
  if (Array.isArray(activities) && activities.length) {
    const spare = []
    for (const day of dayList) {
      const cap = capacityOf(day)
      for (let slot = cap; slot >= 1; slot -= 1) {
        if (!occupied.has(`${day}__${slot}`)) spare.push({ day, slot })
      }
    }
    // Round-robin days so activities spread across the week.
    spare.sort((a, b) => b.slot - a.slot || dayList.indexOf(a.day) - dayList.indexOf(b.day))
    let ai = 0
    for (const cell of spare) {
      const label = activities[ai % activities.length]
      ai += 1
      blocks.push(makeBlock({
        day: cell.day, startSlot: cell.slot, length: 1,
        label, type: BLOCK_TYPES.ACTIVITY,
      }))
      occupied.add(`${cell.day}__${cell.slot}`)
    }
  }

  return { blocks, unplaced, notes }
}

/** Heavy lessons on one day beyond this count earns a "too heavy" warning. */
export const HEAVY_PER_DAY_LIMIT = 4

/**
 * Check a filled grid against the subject allocations and the practical
 * school rules. Returns structured feedback the studio surfaces so the
 * teacher can see whether the week meets the curriculum requirements before
 * saving — and fix it by hand.
 *
 * @returns {{ok:boolean, errors:string[], warnings:string[],
 *   bySubject:Array<{label,target,placed,status,load}>,
 *   totalTarget:number, totalPlaced:number}}
 */
export function validateTimetable({ slots, subjects, periods, days }) {
  const rows = lessonPeriods(periods)
  const dayList = Array.isArray(days) ? days : []
  const subjList = Array.isArray(subjects) ? subjects : []

  const placed = {}
  const heavyPerDay = new Map(dayList.map((d) => [d, 0]))
  for (const p of rows) {
    for (const day of dayList) {
      const label = slots?.[p.id]?.[day]
      if (!label) continue
      placed[label] = (placed[label] || 0) + 1
      if (subjectLoad(label) === 'heavy') heavyPerDay.set(day, (heavyPerDay.get(day) || 0) + 1)
    }
  }

  const bySubject = subjList.map((s) => {
    const target = Math.max(0, Math.round(Number(s.periodsPerWeek) || 0))
    const got = placed[s.label] || 0
    let status = 'ok'
    if (target > 0 && got === 0) status = 'missing'
    else if (got < target) status = 'under'
    else if (got > target) status = 'over'
    return { label: s.label, target, placed: got, status, load: s.load || subjectLoad(s.label) }
  })

  const errors = []
  const warnings = []
  const plural = (n) => (n === 1 ? '' : 's')

  for (const r of bySubject) {
    if (r.status === 'missing') {
      errors.push(`${r.label}: needs ${r.target} period${plural(r.target)} a week but none are placed.`)
    } else if (r.status === 'under') {
      warnings.push(`${r.label}: ${r.placed} of ${r.target} period${plural(r.target)} placed — ${r.target - r.placed} short.`)
    } else if (r.status === 'over') {
      warnings.push(`${r.label}: ${r.placed} placed, ${r.placed - r.target} more than the ${r.target} required.`)
    }
  }

  // Subjects in the grid that aren't in this grade's subject list at all.
  const known = new Set(subjList.map((s) => s.label))
  for (const label of Object.keys(placed)) {
    if (!known.has(label)) warnings.push(`${label} is placed in the week but is not in this grade's subject list.`)
  }

  // Heavy-subject clustering — flag days carrying too many demanding lessons.
  for (const day of dayList) {
    const n = heavyPerDay.get(day) || 0
    if (n > HEAVY_PER_DAY_LIMIT) {
      warnings.push(`${day} has ${n} demanding subjects — consider moving one to a lighter day.`)
    }
  }

  const totalTarget = subjList.reduce((sum, s) => sum + Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)), 0)
  const totalPlaced = Object.values(placed).reduce((a, b) => a + b, 0)

  return { ok: errors.length === 0 && warnings.length === 0, errors, warnings, bySubject, totalTarget, totalPlaced }
}

/**
 * Detailed, block-aware validation — the data behind the studio's
 * validation panel and the exports' Details sheet.
 *
 * Checks the placed blocks against the subject allocations, the official
 * curriculum figures (when one is selected), the double-period invariants
 * and the practical school rules. Distinguishes curriculum periods from
 * school activities, counts real contact time from the actual row
 * durations, and finds unexplained mid-day gaps.
 *
 * @returns {{
 *   status:'passed'|'warning'|'failed', customised:boolean,
 *   errors:string[], warnings:string[], notes:string[],
 *   bySubject:Array<{label,shortName,target,placed,remaining,status,load,compulsory,optionGroupId,selected}>,
 *   summary:{requiredPeriods,curriculumPeriods,activityPeriods,totalSlots,
 *            contactMinutes,requiredContactMinutes,validDoubles,brokenDoubles,
 *            unexplainedGaps,emptySlots}
 * }}
 */
export function validateTimetableBlocks({
  blocks, subjects, periods, days, dayStructure, timing = null, curriculum,
  allocationScaled = false, lessonMinutes = null,
}) {
  const dayList = Array.isArray(days) ? days : []
  const subjList = Array.isArray(subjects) ? subjects : []
  const blockList = Array.isArray(blocks) ? blocks : []
  // Each day's own resolved periods/segments — see periodsForDay.
  const rowsByDay = new Map(dayList.map((d) => [d, lessonPeriods(periodsForDay(d, periods, dayStructure, timing))]))
  const segmentsByDay = new Map(dayList.map((d) => [d, segmentsOf(periodsForDay(d, periods, dayStructure, timing))]))
  const capacityOf = (day) => slotCountForDay(day, periods, dayStructure, timing)

  const errors = []
  const warnings = []
  const notes = []
  const plural = (n) => (n === 1 ? '' : 's')

  /* Structural soundness: overlaps, out-of-range blocks, doubles crossing a
   * break. These are hard failures. */
  const structural = validateBlockLayout(blockList, {
    segments: (day) => segmentsByDay.get(day) || [], days: dayList, slotCountForDay: capacityOf,
  })
  errors.push(...structural)

  /* Per-subject placement counts (a double counts as 2).
   *
   * A SCHOOL subject (Literacy at a private school, say — real teaching, but
   * not one of the official learning areas) is placed and printed like any
   * other, and is deliberately kept OUT of curriculum contact time and the
   * curriculum period total. Counting it there would report a week as
   * meeting the curriculum on the strength of a subject the curriculum does
   * not contain. */
  const schoolSubjectLabels = new Set(
    subjList.filter((s) => s?.schoolSubject).map((s) => s.label).filter(Boolean),
  )
  const placed = new Map()
  let curriculumPeriods = 0
  let activityPeriods = 0
  let schoolSubjectPeriods = 0
  let contactMinutes = 0
  let validDoubles = 0
  let brokenDoubles = 0
  for (const b of blockList) {
    if (!dayList.includes(b.day)) continue
    if (b.type === BLOCK_TYPES.ACTIVITY) { activityPeriods += b.length; continue }
    placed.set(b.label, (placed.get(b.label) || 0) + b.length)
    if (schoolSubjectLabels.has(b.label)) {
      schoolSubjectPeriods += b.length
    } else {
      curriculumPeriods += b.length
      const dayRows = rowsByDay.get(b.day) || []
      for (const s of blockSlots(b)) {
        const row = dayRows[s - 1]
        if (row) contactMinutes += timeToMinutes(row.end) - timeToMinutes(row.start)
      }
    }
    if (b.length >= 2) {
      if (fitsInOneSegment(segmentsByDay.get(b.day) || [], b.startSlot, b.length)) validDoubles += 1
      else brokenDoubles += 1
    }
  }

  const bySubject = subjList.map((s) => {
    const target = Math.max(0, Math.round(Number(s.periodsPerWeek) || 0))
    const got = placed.get(s.label) || 0
    let status = 'ok'
    if (target > 0 && got === 0) status = 'missing'
    else if (got < target) status = 'under'
    else if (got > target) status = 'over'
    return {
      label: s.label,
      displayLabel: s.displayLabel || s.label,
      shortName: s.shortName || null,
      target,
      placed: got,
      remaining: Math.max(0, target - got),
      status,
      load: s.load || subjectLoad(s.label),
      compulsory: s.compulsory ?? null,
      optionGroupId: s.optionGroupId || s.choiceGroup || null,
      selected: s.selected !== false,
      schoolSubject: Boolean(s.schoolSubject),
    }
  })

  for (const r of bySubject) {
    if (!r.selected && r.target === 0) {
      if ((placed.get(r.label) || 0) > 0) {
        errors.push(`${r.label} is placed on the grid, but it is not the selected option for this class.`)
      }
      continue
    }
    if (r.status === 'missing') {
      errors.push(`${r.label}: needs ${r.target} period${plural(r.target)} a week but none are placed.`)
    } else if (r.status === 'under') {
      errors.push(`${r.label}: ${r.placed} of ${r.target} period${plural(r.target)} placed — ${r.target - r.placed} short.`)
    } else if (r.status === 'over') {
      warnings.push(`${r.label}: ${r.placed} placed, ${r.placed - r.target} more than the ${r.target} required.`)
    }
  }

  /* Subjects on the grid that aren't in the subject list at all. */
  const known = new Set(subjList.map((s) => s.label))
  for (const [label] of placed) {
    if (!known.has(label)) warnings.push(`${label} is placed in the week but is not in this class's subject list.`)
  }

  /* Repeated-subject analysis per day: adjacent matching singles are join
   * candidates; separated repeats are explicitly two singles (never a double). */
  const heavyPerDay = new Map(dayList.map((d) => [d, 0]))
  for (const day of dayList) {
    const cap = capacityOf(day)
    const bySlot = new Array(cap + 1).fill(null)
    for (const b of blockList) {
      if (b.day !== day) continue
      for (const s of blockSlots(b)) if (s <= cap) bySlot[s] = b
      if (b.type === BLOCK_TYPES.CURRICULUM && subjectLoad(b.label) === 'heavy') {
        heavyPerDay.set(day, (heavyPerDay.get(day) || 0) + b.length)
      }
    }
    // Non-consecutive repeats of the same subject (curriculum blocks only).
    const singlesByLabel = new Map()
    for (const b of blockList) {
      if (b.day !== day || b.type !== BLOCK_TYPES.CURRICULUM) continue
      if (!singlesByLabel.has(b.label)) singlesByLabel.set(b.label, [])
      singlesByLabel.get(b.label).push(b)
    }
    for (const [label, list] of singlesByLabel) {
      if (list.length < 2) continue
      const sorted = list.slice().sort((a, b) => a.startSlot - b.startSlot)
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const a = sorted[i]
        const b = sorted[i + 1]
        const adjacent = a.startSlot + a.length === b.startSlot
          && fitsInOneSegment(segmentsByDay.get(day) || [], a.startSlot, a.length + b.length)
        if (adjacent && a.length === 1 && b.length === 1) {
          notes.push(`${label} has two consecutive single periods on ${day} — you can join them into a double period.`)
        } else if (!adjacent) {
          notes.push(`${label} appears more than once on ${day}, but the lessons are not consecutive. They are separate single periods, not a double period.`)
        }
      }
    }
    // Unexplained gaps: an empty cell with a filled cell after it that day.
    // (Cells beyond the day's configured lesson count are not gaps.)
    let lastFilled = 0
    for (let s = cap; s >= 1; s -= 1) { if (bySlot[s]) { lastFilled = s; break } }
    for (let s = 1; s < lastFilled; s += 1) {
      if (!bySlot[s]) {
        const dayRows = rowsByDay.get(day) || []
        warnings.push(`${day} has an unexplained empty period before ${dayRows[lastFilled - 1]?.start || 'the last lesson'} — assign a subject or mark it as a school activity.`)
      }
    }
  }

  for (const day of dayList) {
    const n = heavyPerDay.get(day) || 0
    if (n > HEAVY_PER_DAY_LIMIT) {
      warnings.push(`${day} has ${n} demanding lessons — consider moving one to a lighter day.`)
    }
  }

  /* Curriculum totals + customisation. School subjects are excluded from
   * both — they are extra teaching, not a variation of the official week. */
  const curriculumSubjectRows = subjList.filter((s) => !s?.schoolSubject)
  const requiredPeriods = curriculum?.requiredWeeklyPeriods
    ?? curriculumSubjectRows.reduce((sum, s) => sum + Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)), 0)
  const requiredContactMinutes = curriculum?.weeklyContactMinutes ?? null
  let customised = false
  // A shift session's targets are SCALED by the studio on purpose (a session
  // that cannot hold 28 hours is a system constraint, not a teacher's
  // edit) — flagging that as "customised from the baseline" would read as an
  // accusation.
  //
  // The comparison is in MINUTES, not periods, for the same reason the whole
  // coverage model is: a school running 60-minute lessons owes English 4h00,
  // which is 4 lessons. Comparing that against the 40-minute table's "6
  // periods" would call every such school customised. The tolerance is half a
  // lesson — that is rounding, not a decision.
  if (curriculum?.subjects?.length && !allocationScaled) {
    const periodMinutes = Number(curriculum.periodMinutes ?? curriculum.periodLengthMinutes) || 0
    const officialMinutes = new Map(curriculum.subjects.map((s) => {
      const periods = Math.max(0, Math.round(Number(s.weeklyPeriods ?? s.periodsPerWeek) || 0))
      // An unselected option contributes nothing, whatever its own table says.
      const minutes = s.selected === false ? 0 : (s.weeklyMinutes ?? periods * periodMinutes)
      return [s.label, periods === 0 ? 0 : minutes]
    }))
    const len = Math.max(1, Math.round(Number(lessonMinutes) || periodMinutes || 0))
    const tolerance = len / 2
    for (const s of curriculumSubjectRows) {
      if (!officialMinutes.has(s.label)) { customised = true; break }
      const want = Number(officialMinutes.get(s.label)) || 0
      const got = Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)) * len
      if (Math.abs(got - want) > tolerance) { customised = true; break }
    }
  }

  const totalSlots = weeklyCapacity(periods, dayList, dayStructure, timing)
  const emptySlots = Math.max(0, totalSlots - curriculumPeriods - schoolSubjectPeriods - activityPeriods)
  if (brokenDoubles > 0) {
    // Already covered by structural errors, but keep the count visible.
    notes.push(`${brokenDoubles} double period${plural(brokenDoubles)} cross a break and must be split.`)
  }

  const status = errors.length ? 'failed' : (warnings.length ? 'warning' : 'passed')
  return {
    status,
    ok: status === 'passed',
    customised,
    errors,
    warnings,
    notes,
    bySubject,
    summary: {
      requiredPeriods,
      curriculumPeriods,
      activityPeriods,
      schoolSubjectPeriods,
      schoolSubjects: bySubject
        .filter((r) => r.schoolSubject && (r.placed > 0 || r.target > 0))
        .map((r) => ({ label: r.displayLabel || r.label, placed: r.placed, target: r.target })),
      totalSlots,
      contactMinutes,
      requiredContactMinutes,
      validDoubles,
      brokenDoubles,
      unexplainedGaps: warnings.filter((w) => w.includes('unexplained empty period')).length,
      emptySlots,
    },
  }
}

/** Total periods requested across all subjects. */
export function totalAllocated(subjects) {
  return (Array.isArray(subjects) ? subjects : [])
    .reduce((sum, s) => sum + Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)), 0)
}

/**
 * Count how many lesson cells are actually filled in a slots map, limited to
 * the given periods/days (so stale ids from a re-build don't inflate it).
 */
export function filledCount(slots, periods, days) {
  const rows = lessonPeriods(periods)
  const dayList = Array.isArray(days) ? days : []
  let n = 0
  for (const p of rows) {
    for (const day of dayList) {
      if (slots?.[p.id]?.[day]) n += 1
    }
  }
  return n
}

/**
 * Assemble the canonical, saveable timetable artifact from studio state.
 * The shape stored in aiGenerations.output and consumed by the view +
 * exporters.
 *
 * Schema v2 stores explicit schedule BLOCKS (the source of truth — singles,
 * double periods and school activities) alongside a derived legacy `slots`
 * map so older readers keep working. When called with only `slots` (legacy
 * callers), blocks are derived as single periods.
 */
export function buildTimetableArtifact({
  header, days, periods, slots, blocks,
  dayStructure = null, displayPreferences = null,
  curriculumId = null, selectedOptions = null, subjectAllocations = null,
  calendarOverrides = null,
  timing = null, languageName = null, allocationStrategy = null,
}) {
  const dayList = Array.isArray(days) ? days : []
  const periodList = Array.isArray(periods) ? periods : []
  const blockList = Array.isArray(blocks)
    ? blocks
    : slotsToBlocks(slots || {}, periodList, dayList)
  return {
    schemaVersion: SCHEMA_VERSION,
    header: header || {},
    days: dayList,
    periods: periodList,
    blocks: blockList,
    // The timing CONFIG, saved alongside the built rows. It is what lets a
    // reader rebuild a day's own rows — a Monday-only assembly, a day-scoped
    // break — rather than assuming every day shares the reference list. A
    // timetable saved without it (everything before this pass) simply falls
    // back to `periods`, exactly as it always has.
    timing: timing || null,
    languageName: String(languageName || '').trim() || null,
    allocationStrategy: allocationStrategy || null,
    // Derived, kept for legacy readers (old library views + exporters).
    slots: blocksToSlots(blockList, periodList, dayList),
    dayStructure: dayStructure || null,
    // School Calendar date-specific overrides — never part of the recurring
    // weekly structure above (see effectiveDayScheduleForDate).
    calendarOverrides: Array.isArray(calendarOverrides) ? calendarOverrides : [],
    displayPreferences: { ...DEFAULT_DISPLAY_PREFERENCES, ...(displayPreferences || {}) },
    curriculumId: curriculumId || null,
    selectedOptions: selectedOptions || null,
    subjectAllocations: Array.isArray(subjectAllocations)
      ? subjectAllocations.map((s) => ({
          subjectId: s.subjectId || s.id || null,
          label: s.label,
          displayLabel: s.displayLabel || null,
          abbreviation: s.abbreviation || null,
          schoolSubject: Boolean(s.schoolSubject),
          shortName: s.shortName || null,
          periodsPerWeek: Math.max(0, Math.round(Number(s.periodsPerWeek) || 0)),
          weeklyMinutes: s.weeklyMinutes ?? null,
          optionGroupId: s.optionGroupId || s.choiceGroup || null,
          selected: s.selected !== false,
        }))
      : null,
  }
}

/**
 * Upgrade any saved timetable artifact to the v2 shape without touching the
 * original document. v1 artifacts (per-cell `slots` only) get their cells
 * migrated to single-period blocks — adjacent matching cells stay separate
 * singles (the teacher can join them into doubles) — and default to the
 * "Days across the top" layout. v2 artifacts pass through with defaults
 * filled in. Existing saved timetables therefore keep loading forever.
 */
export function normalizeTimetableArtifact(timetable) {
  if (!timetable || typeof timetable !== 'object') return null
  const days = Array.isArray(timetable.days) ? timetable.days : []
  const periods = Array.isArray(timetable.periods) ? timetable.periods : []
  const hasBlocks = Array.isArray(timetable.blocks)
  const blocks = hasBlocks
    ? timetable.blocks
    : slotsToBlocks(timetable.slots || {}, periods, days)
  return {
    ...timetable,
    schemaVersion: SCHEMA_VERSION,
    header: timetable.header || {},
    days,
    periods,
    blocks,
    slots: hasBlocks
      ? (timetable.slots || blocksToSlots(blocks, periods, days))
      : (timetable.slots || {}),
    dayStructure: timetable.dayStructure || null,
    calendarOverrides: Array.isArray(timetable.calendarOverrides) ? timetable.calendarOverrides : [],
    displayPreferences: {
      ...DEFAULT_DISPLAY_PREFERENCES,
      ...(timetable.displayPreferences || {}),
    },
    curriculumId: timetable.curriculumId || null,
    selectedOptions: timetable.selectedOptions || null,
    // Absent on everything saved before the school-sessions pass — a null
    // timing means "every day shares the built `periods`", which is exactly
    // what those timetables meant.
    timing: timetable.timing || null,
    languageName: timetable.languageName || null,
    allocationStrategy: timetable.allocationStrategy || null,
    subjectAllocations: Array.isArray(timetable.subjectAllocations) ? timetable.subjectAllocations : null,
  }
}
