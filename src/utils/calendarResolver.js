// Calendar Resolver — the reference seam between a Teaching Profile's stored
// calendar REFERENCE (calendarId + source) and the actual calendar data.
//
// Today there is exactly one resolvable calendar: the hardcoded national MoE
// calendar in ./moeCalendar.js. This module is the single indirection point so
// the Level-2 (school) and Level-3 (teacher) calendars from the spec can be
// added later — a Firestore-backed schoolCalendars collection, personal
// overrides — WITHOUT touching every caller. Callers ask the resolver for a
// calendar id and get back derived term/week/holiday context; they never reach
// into MOE_CALENDAR directly.
//
// Everything here is DERIVED at read time from the referenced calendar, so a
// calendar change is reflected everywhere with no stored-date migration. All
// date math delegates to the pure, already-node-tested helpers in
// ./moeCalendar.js.
//
// Run tests: npm run test:calendar-resolver

import {
  getActiveTerm,
  getNextTerm,
  getCurrentForecastWeek,
  getTotalTeachingWeeks,
  getAllHolidaysForYear,
  getUpcomingHolidays,
  daysUntil,
  fmtDate,
} from './moeCalendar.js'

// The one calendar that resolves today. Stored on the profile as calendarId so
// the reference survives when more calendars appear.
export const NATIONAL_CALENDAR_ID = 'moe-national'
export const NATIONAL_CALENDAR_NAME = 'Zambia MoE School Calendar'

// The registry of resolvable calendars. Deliberately a list (not a bare
// constant) so 'school'/'teacher' entries slot in here later.
const CALENDAR_REGISTRY = [
  { id: NATIONAL_CALENDAR_ID, name: NATIONAL_CALENDAR_NAME, source: 'national' },
]

/** Every calendar a teacher can currently be connected to. */
export function listAvailableCalendars() {
  return CALENDAR_REGISTRY.map((c) => ({ ...c }))
}

/**
 * Resolve a calendar reference to its descriptor, or null when the id is
 * unknown (e.g. a future school-calendar id we can't yet load). A blank id
 * falls back to the national calendar so an un-migrated profile still resolves.
 */
export function resolveCalendar(calendarId) {
  if (!calendarId) return { ...CALENDAR_REGISTRY[0] }
  return CALENDAR_REGISTRY.find((c) => c.id === calendarId)
    ? { ...CALENDAR_REGISTRY.find((c) => c.id === calendarId) }
    : null
}

/** Display name for a calendar id ("Zambia MoE School Calendar"). */
export function calendarLabel(calendarId) {
  const c = resolveCalendar(calendarId)
  return c ? c.name : ''
}

// ── date helpers (kept local so the module has no private-import coupling) ───

function parseISO(s) {
  const d = new Date(s + 'T00:00:00')
  d.setHours(0, 0, 0, 0)
  return d
}
function todayLocal() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function asDate(dateLike) {
  if (dateLike instanceof Date) {
    const d = new Date(dateLike)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (typeof dateLike === 'string' && dateLike) return parseISO(dateLike)
  return todayLocal()
}

// ── closure / holiday predicates (the gap the audit flagged) ─────────────────

/** Saturday or Sunday. */
export function isWeekend(dateLike) {
  const day = asDate(dateLike).getDay()
  return day === 0 || day === 6
}

/**
 * True when the date is a gazetted public holiday in the calendar. Checks the
 * holidays of the date's own year (holidays are stored per term but flattened
 * per year). Returns the holiday name via isPublicHoliday's sibling below.
 */
export function isPublicHoliday(dateLike) {
  return !!publicHolidayOn(dateLike)
}

/** The holiday object on a date ({name,date,...}) or null. */
export function publicHolidayOn(dateLike) {
  const d = asDate(dateLike)
  const iso = toISO(d)
  const holidays = getAllHolidaysForYear(d.getFullYear())
  return holidays.find((h) => h.date === iso) || null
}

/**
 * "School is currently closed" in the term-break sense (section 16): no active
 * term covers the date. This is the banner state that flips the dashboard from
 * "Prepare This Week" to "Prepare for Next Term".
 */
export function isTermBreak(dateLike) {
  return getActiveTerm(asDate(dateLike)) === null
}

/**
 * A day on which no teaching happens: a term break, a weekend, or a public
 * holiday. Used to exclude closed days from Weekly Focus / lesson-date pickers
 * (sections 18–19). Weekends are treated as non-teaching; the caller may still
 * override for a school that teaches Saturdays.
 */
export function isNonTeachingDay(dateLike) {
  return isTermBreak(dateLike) || isWeekend(dateLike) || isPublicHoliday(dateLike)
}

/**
 * The Monday–Friday teaching days of the week beginning `weekBeginningISO`,
 * each flagged with why it is or isn't a teaching day. Section 18: if Friday is
 * a public holiday the week has four teaching days, not five.
 * Returns [{ date, weekday, isTeachingDay, holiday|null }].
 */
export function teachingDaysInWeek(weekBeginningISO) {
  const start = asDate(weekBeginningISO)
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  return WEEKDAYS.map((weekday, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const iso = toISO(d)
    const holiday = publicHolidayOn(d)
    const teaching = !isTermBreak(d) && !holiday // Mon–Fri already, so no weekend check
    return { date: iso, weekday, isTeachingDay: teaching, holiday: holiday ? holiday.name : null }
  })
}

// ── the single read-time context builder ─────────────────────────────────────

/**
 * Resolve the full teaching context for a calendar reference on a given date.
 * This is what the dashboard, Prepare-This-Week, and studios call — one place
 * that turns (calendarId, date) into the term/week/holiday/closure picture.
 *
 * When school is closed (term break) `isClosed` is true and the term/week
 * fields describe the NEXT term to prepare for, with `nextTermOpen*` populated.
 *
 * Returns null only when the referenced calendar is unknown or holds no data
 * for the date (e.g. beyond 2030) — callers must handle a null so one bad
 * lookup never breaks the dashboard (section 31).
 */
export function resolveTeachingContext({ calendarId, date } = {}) {
  const calendar = resolveCalendar(calendarId)
  if (!calendar) return null
  const d = asDate(date)

  const active = getActiveTerm(d)
  const ref = active ?? getNextTerm(d)
  if (!ref) return null

  const forecast = getCurrentForecastWeek(d) // holiday-safe; week 1 of next term on break
  const totalTeachingWeeks = getTotalTeachingWeeks(ref.term)
  const isClosed = !active

  // Remaining teaching weeks only makes sense inside an active term.
  const weekNumber = forecast ? forecast.weekNumber : null
  const remainingTeachingWeeks =
    active && weekNumber != null ? Math.max(0, totalTeachingWeeks - weekNumber) : totalTeachingWeeks

  const next = getNextTerm(d)

  return {
    calendarId: calendar.id,
    calendarName: calendar.name,
    calendarSource: calendar.source,

    isActiveTerm: !!active,
    isClosed,

    academicYear: ref.year,
    termNumber: ref.term.number,
    termName: ref.term.name,
    termId: ref.term.id,
    termOpen: ref.term.open,
    termClose: ref.term.close,
    termOpenLabel: fmtDate(ref.term.open, 'full'),
    termCloseLabel: fmtDate(ref.term.close, 'full'),

    weekNumber,
    totalTeachingWeeks,
    remainingTeachingWeeks,
    weekBeginning: forecast ? forecast.beginning : null,
    weekEnding: forecast ? forecast.ending : null,
    weekBeginningLabel: forecast ? forecast.beginningLabel : '',
    weekEndingLabel: forecast ? forecast.endingLabel : '',

    upcomingHolidays: getUpcomingHolidays(21, d),

    // Where the dashboard points during a break ("School opens on 7 September").
    nextTerm: next
      ? {
          academicYear: next.year,
          termNumber: next.term.number,
          termName: next.term.name,
          open: next.term.open,
          openLabel: fmtDate(next.term.open, 'full'),
          daysUntilOpen: daysUntil(next.term.open, d),
        }
      : null,
  }
}
