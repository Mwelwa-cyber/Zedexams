// Scheme of Work — calendar-derived term/year defaults (pure, unit-testable).
//
// The Scheme of Work studio already derives the teaching-WEEK count from the
// School Calendar (buildTermPlan → getTermWeeks). The one piece still entered by
// hand was WHICH term/year: the form defaulted to Term 1 of the current year, so
// a teacher in Term 2 opened on the wrong term. This resolves the term/year the
// teacher is actually in from the live calendar week, falling back safely when
// the calendar can't place today (between terms / out of range).
//
// Run tests: npm run test:scheme-calendar-defaults

/**
 * @param {object|null} forecastWeek  getCurrentForecastWeek() result
 *   ({ year, termNumber, ... }) or null when today isn't in a known term/range.
 * @param {number[]} calendarYears     getCalendarYears()
 * @param {number} todayYear           new Date().getFullYear()
 * @returns {{ term: number, year: number, fromCalendar: boolean }}
 *   fromCalendar — true when the term/year came from the live calendar (not the
 *   plain fallback), so the UI can show a "from your School Calendar" affordance.
 */
export function resolveSchemeTermYear({ forecastWeek, calendarYears, todayYear } = {}) {
  const years = Array.isArray(calendarYears) ? calendarYears : []
  const fallbackYear = years.includes(todayYear) ? todayYear : (years.length ? years[0] : todayYear)
  const fw = forecastWeek || null
  const term = fw && Number.isInteger(fw.termNumber) ? fw.termNumber : null
  if (term && term >= 1 && term <= 3) {
    const year = years.includes(fw.year) ? fw.year : fallbackYear
    return { term, year, fromCalendar: true }
  }
  return { term: 1, year: fallbackYear, fromCalendar: false }
}

/**
 * Whether the form is currently focused on a term OTHER than the live calendar
 * term — used to offer a one-click "use current term". Both args are the
 * resolveSchemeTermYear-style { term, year }.
 */
export function isOffCurrentTerm(current, selected) {
  if (!current || !selected || !current.fromCalendar) return false
  return current.term !== Number(selected.term) || current.year !== Number(selected.year)
}
