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
import {
  getFrameworkForGrade,
  subjectLoad,
  subjectLoadWeight,
  LOAD_WEIGHT,
} from './curriculumFramework.js'

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
    // Day bookends: assembly sits before Period 1 (afterPeriod 0), closing
    // after the last lesson (afterPeriod 'end'). Break and lunch fall mid-day.
    { afterPeriod: 0,     minutes: 15, name: 'ASSEMBLY', event: 'assembly' },
    { afterPeriod: 2,     minutes: 20, name: 'BREAK',    event: 'break' },
    { afterPeriod: 5,     minutes: 40, name: 'LUNCH',    event: 'lunch' },
    { afterPeriod: 'end', minutes: 10, name: 'CLOSING',  event: 'closing' },
  ],
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
 * @returns {{id,kind,event?,label,start,end}[]}
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
    id: `s${subjectSeq}`,
    label,
    periodsPerWeek: extra.periodsPerWeek ?? defaultPeriodsPerWeek(label),
    load: extra.load || subjectLoad(label),
    category: extra.category || null,
    choiceGroup: extra.choiceGroup || null,
    timeAllocation: extra.timeAllocation || null,
  }
}

/**
 * The curriculum subject list for a teacher grade (e.g. 'G5'), each seeded
 * with its weekly allocation.
 *
 * When the 2023 Curriculum Framework prescribes an allocation for the grade
 * (Lower / Upper Primary), the official subjects and period counts are used
 * verbatim — so the studio knows, for example, that a Grade 5 week is the
 * seven CBC learning areas at the framework's exact period counts (42/week).
 * For grades the framework doesn't yet cover (secondary), it falls back to
 * the canonical Library subject list with heuristic weekly counts. Returns []
 * only when no list exists at all (caller seeds a minimal core).
 */
export function curriculumSubjectsForGrade(grade) {
  const framework = getFrameworkForGrade(grade)
  if (framework) {
    return framework.subjects.map((s) => makeSubject(s.label, {
      periodsPerWeek: s.periodsPerWeek,
      load: s.load,
      category: s.category,
      choiceGroup: s.choiceGroup,
      timeAllocation: s.timeAllocation,
    }))
  }
  const { syllabus, gradeForm } = resolveGradeForm(grade)
  const labels = getSubjectsForGradeForm(syllabus, gradeForm)
  return labels.map((l) => makeSubject(l))
}

/** Build a fresh custom subject row the studio can append. */
export function newSubject(label = 'New subject') {
  return makeSubject(label)
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
