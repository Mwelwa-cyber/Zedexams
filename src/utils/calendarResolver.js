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
// CONTRACT (the load-bearing safeguard): resolveTeachingContext ALWAYS returns
// a structured object with a `status` field — never a bare null. Later phases
// must never assume a valid term/week is returned; they branch on
// `context.status === 'ok'` (or the `isContextUsable` helper) and render the
// documented calendar-unavailable fallback otherwise.
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
// the reference survives when more calendars appear. The NAME is deliberately
// honest — it is the national Ministry of Education calendar, NOT a
// school-managed or inherited one (no school-level calendar record exists yet).
export const NATIONAL_CALENDAR_ID = 'moe-national'
export const NATIONAL_CALENDAR_NAME = 'Zambia Ministry of Education Calendar'

// The registry of resolvable calendars. Deliberately a list (not a bare
// constant) so 'school'/'teacher' entries slot in here later.
const CALENDAR_REGISTRY = [
  { id: NATIONAL_CALENDAR_ID, name: NATIONAL_CALENDAR_NAME, source: 'national' },
]

// The default teaching-day set: Monday–Friday. JS Date.getDay(): Sun=0 … Sat=6,
// so [1,2,3,4,5] is Mon–Fri. This is the ONE place the "weekends are closed"
// assumption lives — a future school calendar can override the teaching days
// without touching call sites (isTeachingWeekday/isNonTeachingDay/
// teachingDaysInWeek all accept a teachingDays override defaulting to this).
// It is intentionally NOT stored on every teacher profile.
export const DEFAULT_TEACHING_DAYS = [1, 2, 3, 4, 5]

/** Every calendar a teacher can currently be connected to. */
export function listAvailableCalendars() {
  return CALENDAR_REGISTRY.map((c) => ({ ...c }))
}

/**
 * Resolve a calendar reference to its descriptor, or null when the id is
 * unknown (e.g. a future school-calendar id we can't yet load). A blank id
 * falls back to the national calendar so an un-migrated profile still resolves.
 * NOTE: this is the low-level lookup and MAY return null; the high-level
 * resolveTeachingContext never does — it maps a null here to status
 * 'unavailable'.
 */
export function resolveCalendar(calendarId) {
  if (!calendarId) return { ...CALENDAR_REGISTRY[0] }
  const found = CALENDAR_REGISTRY.find((c) => c.id === calendarId)
  return found ? { ...found } : null
}

/** Display name for a calendar id ("Zambia Ministry of Education Calendar"). */
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

/**
 * Normalise a date input for the predicate helpers. Unlike parseDateInput
 * (which flags invalid dates for the resolver), this is lenient: unknown input
 * falls back to today so a predicate never throws.
 */
function asDate(dateLike) {
  if (dateLike instanceof Date) {
    if (Number.isNaN(dateLike.getTime())) return todayLocal()
    const d = new Date(dateLike)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (typeof dateLike === 'string' && dateLike) {
    const d = parseISO(dateLike)
    return Number.isNaN(d.getTime()) ? todayLocal() : d
  }
  return todayLocal()
}

/**
 * Strict parse for resolveTeachingContext: distinguishes "no date given"
 * (default to today) from "an actual but unparseable date" (invalid). Returns
 * { date, invalid }.
 */
function parseDateInput(date) {
  if (date == null || date === '') return { date: todayLocal(), invalid: false }
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return { date: null, invalid: true }
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return { date: d, invalid: false }
  }
  if (typeof date === 'string') {
    const d = new Date(date + 'T00:00:00')
    if (Number.isNaN(d.getTime())) return { date: null, invalid: true }
    d.setHours(0, 0, 0, 0)
    return { date: d, invalid: false }
  }
  return { date: null, invalid: true }
}

// ── teaching-day / holiday / closure predicates (the gap the audit flagged) ──

/** True when the date is a scheduled teaching weekday (Mon–Fri by default). */
export function isTeachingWeekday(dateLike, teachingDays = DEFAULT_TEACHING_DAYS) {
  return teachingDays.includes(asDate(dateLike).getDay())
}

/** Saturday or Sunday under the default Mon–Fri teaching week. */
export function isWeekend(dateLike) {
  return !isTeachingWeekday(dateLike)
}

/** True when the date is a gazetted public holiday in the calendar. */
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
 * A day on which no teaching happens: a term break, a non-teaching weekday
 * (weekend by default), or a public holiday. Used to exclude closed days from
 * Weekly Focus / lesson-date pickers (sections 18–19). Pass a `teachingDays`
 * override for a future Saturday-teaching school.
 */
export function isNonTeachingDay(dateLike, teachingDays = DEFAULT_TEACHING_DAYS) {
  const d = asDate(dateLike)
  return isTermBreak(d) || !isTeachingWeekday(d, teachingDays) || isPublicHoliday(d)
}

/**
 * The Monday–Friday teaching days of the week beginning `weekBeginningISO`,
 * each flagged with why it is or isn't a teaching day. Section 18: if Friday is
 * a public holiday the week has four teaching days, not five. `teachingDays`
 * is the overridable set (defaults Mon–Fri).
 * Returns [{ date, weekday, isTeachingDay, holiday|null }].
 */
export function teachingDaysInWeek(weekBeginningISO, teachingDays = DEFAULT_TEACHING_DAYS) {
  const start = asDate(weekBeginningISO)
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  return WEEKDAYS.map((weekday, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const iso = toISO(d)
    const holiday = publicHolidayOn(d)
    const teaching = !isTermBreak(d) && isTeachingWeekday(d, teachingDays) && !holiday
    return { date: iso, weekday, isTeachingDay: teaching, holiday: holiday ? holiday.name : null }
  })
}

// ── the single read-time context builder ─────────────────────────────────────

// The safe, fully-populated shape returned when context can't be resolved. Every
// field a consumer might read is present with a null-ish value, so destructuring
// never throws and no caller can accidentally treat a failure as a real term.
function unavailableContext(status, reason, calendar) {
  return {
    status,
    reason,
    calendarId: calendar ? calendar.id : '',
    calendarName: calendar ? calendar.name : '',
    calendarSource: calendar ? calendar.source : '',
    isActiveTerm: false,
    isClosed: true,
    isTeachingDay: false,
    academicYear: null,
    termNumber: null,
    termName: '',
    termId: '',
    termOpen: null,
    termClose: null,
    termOpenLabel: '',
    termCloseLabel: '',
    weekNumber: null,
    totalTeachingWeeks: 0,
    remainingTeachingWeeks: 0,
    weekBeginning: null,
    weekEnding: null,
    weekBeginningLabel: '',
    weekEndingLabel: '',
    upcomingHolidays: [],
    nextTerm: null,
  }
}

/** True only for a fully-resolved context (status === 'ok'). */
export function isContextUsable(context) {
  return !!context && context.status === 'ok'
}

/**
 * Resolve the full teaching context for a calendar reference on a given date.
 * This is what the dashboard, Prepare-This-Week, and studios call — one place
 * that turns (calendarId, date) into the term/week/holiday/closure picture.
 *
 * ALWAYS returns a structured object; `status` is one of:
 *   'ok'          — resolved; term/week/holiday fields are populated.
 *   'unavailable' — calendar id unknown (reason 'calendar_not_found').
 *   'out_of_range'— no term data covers the date or any future date, e.g. a
 *                   year beyond the calendar (reason 'year_not_supported').
 *   'invalid_date'— the date could not be parsed (reason 'invalid_date').
 * On any non-ok status the term/week fields are null and `isClosed` is true, so
 * a consumer that forgets to branch degrades to "closed / nothing to prepare"
 * rather than crashing or inventing Week 1.
 *
 * When school is closed (term break) but the calendar/date are valid, `status`
 * is still 'ok', `isClosed` is true, and the term/week fields describe the NEXT
 * term to prepare for, with `nextTerm` populated.
 *
 * Note: a blank/missing calendarId falls back to the national calendar (so an
 * un-migrated profile still resolves) — that is 'ok', not 'unavailable'. Only a
 * NON-EMPTY id we don't recognise is 'unavailable'.
 *
 * `referenceDate` is the date to resolve the term/week for — a Lesson Plan's
 * planned date, a Weekly Focus week, a historical Record of Work, etc. It
 * defaults to today ONLY when no date is supplied, so a consumer resolving a
 * document for another date never accidentally gets "today". (`date` is kept as
 * a backwards-compatible alias.)
 */
export function resolveTeachingContext({ calendarId, referenceDate, date } = {}) {
  const calendar = resolveCalendar(calendarId)
  if (!calendar) return unavailableContext('unavailable', 'calendar_not_found', null)

  const parsed = parseDateInput(referenceDate !== undefined ? referenceDate : date)
  if (parsed.invalid) return unavailableContext('invalid_date', 'invalid_date', calendar)
  const d = parsed.date

  const active = getActiveTerm(d)
  const ref = active ?? getNextTerm(d)
  // No active term AND no upcoming term → the date is beyond the calendar data
  // (e.g. after 2030). Honest 'out_of_range' rather than a guessed term.
  if (!ref) return unavailableContext('out_of_range', 'year_not_supported', calendar)

  const forecast = getCurrentForecastWeek(d) // holiday-safe; week 1 of next term on break
  const totalTeachingWeeks = getTotalTeachingWeeks(ref.term)
  const isClosed = !active

  const weekNumber = forecast ? forecast.weekNumber : null
  const remainingTeachingWeeks =
    active && weekNumber != null ? Math.max(0, totalTeachingWeeks - weekNumber) : totalTeachingWeeks

  const next = getNextTerm(d)

  return {
    status: 'ok',
    reason: null,

    calendarId: calendar.id,
    calendarName: calendar.name,
    calendarSource: calendar.source,

    isActiveTerm: !!active,
    isClosed,
    // Whether the resolved date itself is a teaching day (Mon–Fri, not a
    // holiday, in an active term). False on weekends/holidays/breaks.
    isTeachingDay: !isNonTeachingDay(d),

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
