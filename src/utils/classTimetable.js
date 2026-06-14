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

import { getSubjectsForGradeForm } from '../config/library.js'
import { resolveGradeForm } from './libraryClassification.js'

export const SCHEMA_VERSION = 'class-timetable-1.0'

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
  startTime: '07:30',
  periodMinutes: 40,
  lessonPeriods: 8,
  breaks: [
    { afterPeriod: 2, minutes: 20, name: 'BREAK' },
    { afterPeriod: 5, minutes: 40, name: 'LUNCH' },
  ],
}

/**
 * Build the ordered list of time rows from a timing config. Each row is
 * either a lesson period (kind: 'lesson') or a break/lunch (kind: 'break').
 * Lesson ids are stable ('p1', 'p2', …) so saved grids survive a re-build
 * as long as the lesson count is unchanged.
 *
 * @returns {{id,kind,label,start,end}[]}
 */
export function buildPeriods(config = {}) {
  const {
    startTime = DEFAULT_TIMING.startTime,
    periodMinutes = DEFAULT_TIMING.periodMinutes,
    lessonPeriods = DEFAULT_TIMING.lessonPeriods,
    breaks = DEFAULT_TIMING.breaks,
  } = config

  const count = Math.min(14, Math.max(1, Math.round(Number(lessonPeriods) || 1)))
  const len = Math.min(180, Math.max(5, Math.round(Number(periodMinutes) || 40)))

  // Map enabled breaks by the lesson number they follow.
  const breaksAfter = new Map()
  for (const b of Array.isArray(breaks) ? breaks : []) {
    if (b?.enabled === false) continue
    const after = Math.round(Number(b?.afterPeriod) || 0)
    const mins = Math.round(Number(b?.minutes) || 0)
    if (after < 1 || mins <= 0) continue
    if (!breaksAfter.has(after)) breaksAfter.set(after, [])
    breaksAfter.get(after).push({ minutes: mins, name: (b?.name || 'BREAK').toUpperCase() })
  }

  const rows = []
  let cursor = timeToMinutes(startTime)
  for (let i = 1; i <= count; i += 1) {
    const start = cursor
    const end = start + len
    rows.push({ id: `p${i}`, kind: 'lesson', label: `Period ${i}`, start: minutesToTime(start), end: minutesToTime(end) })
    cursor = end
    for (const b of breaksAfter.get(i) || []) {
      const bStart = cursor
      const bEnd = bStart + b.minutes
      rows.push({ id: `brk-${i}-${rows.length}`, kind: 'break', label: b.name, start: minutesToTime(bStart), end: minutesToTime(bEnd) })
      cursor = bEnd
    }
  }
  return rows
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
function makeSubject(label) {
  subjectSeq += 1
  return { id: `s${subjectSeq}`, label, periodsPerWeek: defaultPeriodsPerWeek(label) }
}

/**
 * The curriculum subject list for a teacher grade (e.g. 'G5'), each seeded
 * with a default weekly allocation. Pulls from the same canonical subject
 * lists the Library uses (src/config/library.js) via the grade→syllabus
 * resolver, so the studio always offers exactly the subjects taught at that
 * grade. Returns [] for grades with no catalogued list (caller falls back to
 * a manual subject list).
 */
export function curriculumSubjectsForGrade(grade) {
  const { syllabus, gradeForm } = resolveGradeForm(grade)
  const labels = getSubjectsForGradeForm(syllabus, gradeForm)
  return labels.map(makeSubject)
}

/** Build a fresh custom subject row the studio can append. */
export function newSubject(label = 'New subject') {
  return makeSubject(label)
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
 * Distribute subjects across the lesson grid.
 *
 * Returns a `slots` map: { [lessonPeriodId]: { [day]: subjectLabel } }. The
 * placement is greedy and deterministic:
 *   1. expand subjects into round-robin tokens (spreads each subject out),
 *   2. walk cells in row-major order (period, then day),
 *   3. for each token take the first free cell whose day does NOT already
 *      hold that subject; if none qualifies (grid getting tight), take the
 *      first free cell regardless.
 *
 * Subjects whose combined allocation exceeds capacity simply stop being
 * placed once the grid is full; spare capacity leaves cells empty.
 */
export function autoFillTimetable({ subjects, days, periods }) {
  const rows = lessonPeriods(periods)
  const dayList = Array.isArray(days) ? days : []
  const cells = []
  for (const p of rows) for (const day of dayList) cells.push({ pid: p.id, day })

  const occupied = new Set()
  const usedPerDay = new Map(dayList.map((d) => [d, new Set()]))
  const slots = {}
  const tokens = roundRobinTokens(subjects)

  for (const tok of tokens) {
    let target = cells.find((c) => !occupied.has(`${c.pid}__${c.day}`) && !usedPerDay.get(c.day).has(tok.id))
    if (!target) target = cells.find((c) => !occupied.has(`${c.pid}__${c.day}`))
    if (!target) break // grid full
    occupied.add(`${target.pid}__${target.day}`)
    usedPerDay.get(target.day).add(tok.id)
    if (!slots[target.pid]) slots[target.pid] = {}
    slots[target.pid][target.day] = tok.label
  }
  return slots
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
 */
export function buildTimetableArtifact({ header, days, periods, slots }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    header: header || {},
    days: Array.isArray(days) ? days : [],
    periods: Array.isArray(periods) ? periods : [],
    slots: slots || {},
  }
}
