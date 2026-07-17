/**
 * attendanceCalendarResolver — turns a register's { term, year } selection into
 * the concrete list of register dates for the Class Register Studio.
 *
 * The school calendar is the source of truth: term open/close dates and
 * gazetted public holidays come from the national MoE calendar
 * (src/utils/moeCalendar.js — the same data behind calendarResolver.js), and a
 * class's attendanceTerms doc can layer per-date overrides (school closures,
 * half days, optional-attendance days) plus custom term dates for years the
 * MoE data does not cover.
 *
 * Pure + dependency-light (imports only the hardcoded calendar + attendance
 * constants) so scripts/test-attendance-calendar.mjs runs it under plain node.
 * All dates are ISO 'YYYY-MM-DD' strings; weekday math uses UTC parsing so no
 * host timezone can shift a date.
 */

import { MOE_CALENDAR } from './moeCalendar.js'
import { TERMS } from './classTerms.js'
import { DAY_CLASSIFICATIONS, VALID_DAY_CLASSIFICATIONS } from './attendanceConstants.js'

// Mon–Fri, matching DEFAULT_TEACHING_DAYS in calendarResolver.js (Date.getDay
// numbering: Sun=0 … Sat=6). Accepted as a parameter everywhere below so a
// Saturday-teaching school can override without touching call sites.
export const DEFAULT_TEACHING_WEEKDAYS = [1, 2, 3, 4, 5]

// ── versioned calendar datasets ──────────────────────────────────
// Official calendars are registered here as versioned datasets so future MoE
// releases (2031+) slot in WITHOUT touching attendance components: add an
// entry (and its data source) and resolveTermInfo picks it up. Years with no
// official dataset fall back to teacher/administrator-entered custom term
// dates (customTermInfo) — dates are NEVER silently reused from a previous
// year: resolution is exact-year only, or null.
export const CALENDAR_DATASETS = [
  {
    id: 'moe-zambia-2026-2030',
    name: 'Zambia MoE Calendar 2026–2030',
    version: 1,
    years: Object.keys(MOE_CALENDAR).map(Number),
    getTerm: (year, termNumber) => MOE_CALENDAR[year]?.terms?.[termNumber - 1] || null,
  },
]

/** The official dataset covering a year, or null (→ custom dates required). */
export function officialDatasetFor(year) {
  const numericYear = Number(year)
  return CALENDAR_DATASETS.find((d) => d.years.includes(numericYear)) || null
}

/**
 * Display + storage metadata for where a term's dates came from. Stored on
 * the attendanceTerms doc (calendarSource/calendarDatasetId/calendarVersion)
 * so a printed register can always say which calendar produced it.
 */
export function calendarMetaForTerm(termInfo) {
  if (!termInfo) return { source: 'none', datasetId: null, version: null, label: 'No calendar configured' }
  if (termInfo.source === 'custom') {
    return { source: 'custom', datasetId: null, version: null, label: 'School-customised dates' }
  }
  const dataset = officialDatasetFor(termInfo.year)
  return {
    source: 'official',
    datasetId: dataset?.id || 'moe-national',
    version: dataset?.version ?? 1,
    label: dataset ? `Official preset (${dataset.name}, v${dataset.version})` : 'Official preset',
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── date primitives ──────────────────────────────────────────────

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Day of week for an ISO date (Sun=0 … Sat=6), timezone-proof via UTC. */
export function weekdayOf(dateIso) {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay()
}

export function addDaysIso(dateIso, n) {
  const d = new Date(`${dateIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Today's date in the user's local timezone (registers are a local-day concept). */
export function localTodayIso(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** The Monday of the week containing dateIso. */
export function mondayOf(dateIso) {
  const wd = weekdayOf(dateIso)
  return addDaysIso(dateIso, wd === 0 ? -6 : 1 - wd)
}

export function formatDayShort(dateIso) {
  return `${DAY_NAMES_SHORT[weekdayOf(dateIso)]} ${Number(dateIso.slice(8, 10))}`
}

export function formatDateLong(dateIso) {
  const wd = DAY_NAMES_SHORT[weekdayOf(dateIso)]
  return `${wd}, ${Number(dateIso.slice(8, 10))} ${MONTH_NAMES[Number(dateIso.slice(5, 7)) - 1]} ${dateIso.slice(0, 4)}`
}

// ── term resolution ──────────────────────────────────────────────

/** 'Term 1' → 1, 'Term 3' → 3, anything else → null. */
export function termNumberFromLabel(term) {
  const i = TERMS.indexOf(term)
  return i === -1 ? null : i + 1
}

export function isCalendarCoveredYear(year) {
  return Boolean(MOE_CALENDAR[Number(year)])
}

/**
 * Resolve a register's { term: 'Term 2', year: 2026 } to concrete term dates
 * from the MoE calendar. Returns null when the calendar has no data for that
 * year/term — the studio shows its calendar-not-configured empty state and
 * offers custom term dates instead (customTermInfo below).
 */
export function resolveTermInfo({ term, year }) {
  const number = termNumberFromLabel(term)
  const numericYear = Number(year)
  if (!number || !numericYear) return null
  const dataset = officialDatasetFor(numericYear)
  const data = dataset ? dataset.getTerm(numericYear, number) : null
  if (!data?.open || !data?.close) return null
  return {
    calendarDatasetId: dataset.id,
    calendarVersion: dataset.version,
    termId: data.id,
    termNumber: number,
    termLabel: term,
    termName: data.name,
    year: numericYear,
    startDate: data.open,
    endDate: data.close,
    // Only holidays that actually fall inside the term window matter for the
    // register (the MoE lists per-term holidays that can precede opening day).
    holidays: (data.holidays || []).filter((h) => h.date >= data.open && h.date <= data.close),
    eceMidBreak: data.eceMidStart && data.eceMidEnd
      ? { start: data.eceMidStart, end: data.eceMidEnd, label: 'Mid-term break' }
      : null,
    source: 'moe-national',
  }
}

/**
 * Term info from teacher-entered dates (attendanceTerms doc overrides) for
 * years/terms outside the MoE data. Same shape as resolveTermInfo.
 */
export function customTermInfo({ term, year, startDate, endDate }) {
  const number = termNumberFromLabel(term)
  const numericYear = Number(year)
  if (!numericYear || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) return null
  return {
    termId: `${numericYear}-T${number || 'X'}`,
    termNumber: number,
    termLabel: term,
    termName: term,
    year: numericYear,
    startDate,
    endDate,
    holidays: [],
    eceMidBreak: null,
    source: 'custom',
  }
}

// ── the day list ─────────────────────────────────────────────────

/**
 * Every calendar date in the term, classified. Weekends and public holidays
 * become non-teaching automatically; `closures` ([{start,end,label}], e.g. the
 * ECE mid-term break) become school_closure; `dayOverrides`
 * ({ 'YYYY-MM-DD': classification }) from the attendanceTerms doc win over
 * everything, so a school can reopen a holiday or close a normal Tuesday.
 *
 * `markable` is true only for teaching/half/optional days that are not in the
 * future — future dates are never markable. Pass todayIso (defaults to the
 * local today) so tests stay deterministic.
 *
 * Returns [{ date, weekday, classification, holidayName, closureLabel,
 *            markable, isFuture, isToday }].
 */
export function buildTermDays({
  termInfo,
  dayOverrides = {},
  closures = [],
  teachingWeekdays = DEFAULT_TEACHING_WEEKDAYS,
  todayIso = localTodayIso(),
} = {}) {
  if (!termInfo?.startDate || !termInfo?.endDate) return []
  const holidayByDate = new Map((termInfo.holidays || []).map((h) => [h.date, h.name]))
  const days = []
  // Hard cap of ~1 year guards against a bad custom range looping forever.
  let date = termInfo.startDate
  for (let i = 0; i < 370 && date <= termInfo.endDate; i += 1) {
    const weekday = weekdayOf(date)
    const holidayName = holidayByDate.get(date) || null
    const closure = closures.find((c) => c?.start && c?.end && date >= c.start && date <= c.end) || null
    const override = dayOverrides?.[date]
    let classification
    if (override && VALID_DAY_CLASSIFICATIONS.has(override)) {
      classification = override
    } else if (!teachingWeekdays.includes(weekday)) {
      classification = 'non_teaching_day'
    } else if (holidayName) {
      classification = 'non_teaching_day'
    } else if (closure) {
      classification = 'school_closure'
    } else {
      classification = 'teaching_day'
    }
    const isFuture = todayIso ? date > todayIso : false
    days.push({
      date,
      weekday,
      classification,
      holidayName,
      closureLabel: closure ? (closure.label || 'School closure') : null,
      markable: Boolean(DAY_CLASSIFICATIONS[classification]?.markable) && !isFuture,
      isFuture,
      isToday: todayIso ? date === todayIso : false,
    })
    date = addDaysIso(date, 1)
  }
  return days
}

/** Only the days that can appear as register columns (markable now or later). */
export function registerDays(days) {
  return (days || []).filter((d) => DAY_CLASSIFICATIONS[d.classification]?.markable)
}

/** Only the days markable today (teaching/half/optional, not future). */
export function markableDays(days) {
  return (days || []).filter((d) => d.markable)
}

/**
 * Register days grouped by ISO week for grid columns / print headers.
 * Week numbers count from the term's first week (Monday-based).
 */
export function groupDaysByWeek(days, termStartDate) {
  const list = registerDays(days)
  if (!list.length) return []
  const firstMonday = mondayOf(termStartDate || list[0].date)
  const groups = new Map()
  for (const d of list) {
    const monday = mondayOf(d.date)
    if (!groups.has(monday)) {
      const weekNumber = Math.round(
        (new Date(`${monday}T00:00:00Z`) - new Date(`${firstMonday}T00:00:00Z`)) / (7 * 86400000),
      ) + 1
      groups.set(monday, { key: monday, weekNumber, days: [] })
    }
    groups.get(monday).days.push(d)
  }
  return [...groups.values()].map((g) => ({
    ...g,
    label: `Week ${g.weekNumber}`,
    monthLabel: MONTH_NAMES[Number(g.days[0].date.slice(5, 7)) - 1].slice(0, 3),
  }))
}

/** Register days grouped by month for grid separators and month-paged print. */
export function groupDaysByMonth(days) {
  const list = registerDays(days)
  const groups = new Map()
  for (const d of list) {
    const key = d.date.slice(0, 7)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
        shortLabel: MONTH_NAMES[Number(key.slice(5, 7)) - 1].slice(0, 3),
        days: [],
      })
    }
    groups.get(key).days.push(d)
  }
  return [...groups.values()]
}

/** The Mon–Fri strip containing dateIso (for the mobile day picker). */
export function weekStripFor(dateIso, days) {
  const monday = mondayOf(dateIso)
  const friday = addDaysIso(monday, 4)
  return (days || []).filter((d) => d.date >= monday && d.date <= friday)
}

/**
 * The nearest markable date from `fromDate` in `direction` (+1/-1), or null.
 * Used by the previous-day/next-day controls to skip weekends and holidays.
 */
export function nearestMarkableDate(days, fromDate, direction) {
  const list = markableDays(days)
  if (!list.length) return null
  if (direction > 0) {
    const next = list.find((d) => d.date > fromDate)
    return next ? next.date : null
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].date < fromDate) return list[i].date
  }
  return null
}

/** The default date to open the register on: today if markable, else the last markable day. */
export function defaultRegisterDate(days, todayIso = localTodayIso()) {
  const list = markableDays(days)
  if (!list.length) return null
  const today = list.find((d) => d.date === todayIso)
  if (today) return today.date
  return nearestMarkableDate(days, todayIso, -1) || list[0].date
}
