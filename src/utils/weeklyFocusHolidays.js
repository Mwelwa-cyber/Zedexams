// Weekly Focus — school-calendar day availability (pure, unit-testable).
//
// Turns a week's Monday date into the teaching-day availability for that week:
// which weekdays are teaching days and which are closed by a public holiday.
// Weekly Focus uses this so a week with a Friday public holiday offers FOUR
// teaching days, not five, and never auto-creates a lesson slot on a closed day.
//
// Delegates the date/holiday math to calendarResolver.teachingDaysInWeek.
//
// Run tests: npm run test:weekly-focus-holidays

import { teachingDaysInWeek } from './calendarResolver.js'

/**
 * @param {string} weekBeginningISO  Monday of the week, 'YYYY-MM-DD'
 * @returns {{ teachingDays:string[], holidays:{weekday,holiday}[], count:number }}
 *   teachingDays — weekday names that are open (Mon–Fri minus holidays)
 *   holidays     — the closed weekdays with their holiday name
 *   count        — number of available teaching days
 */
export function weekTeachingAvailability(weekBeginningISO) {
  const days = weekBeginningISO ? teachingDaysInWeek(weekBeginningISO) : []
  const teachingDays = days.filter((d) => d.isTeachingDay).map((d) => d.weekday)
  const holidays = days
    .filter((d) => !d.isTeachingDay && d.holiday)
    .map((d) => ({ weekday: d.weekday, holiday: d.holiday }))
  return { teachingDays, holidays, count: teachingDays.length }
}

/** Drop weekdays that fall on a holiday (from a { weekday } list). */
export function excludeHolidayWeekdays(weekdays, holidays) {
  const set = new Set((holidays || []).map((h) => h.weekday))
  return (weekdays || []).filter((d) => !set.has(d))
}

/**
 * Open teaching weekdays in the current week that aren't already occupied — the
 * valid destinations when moving a lesson off a closed day. `currentDays` items
 * may be day objects ({ day }) or plain weekday strings.
 */
export function openMoveTargets(currentDays, teachingDays) {
  const occupied = new Set((currentDays || []).map((d) => (d && d.day) || d))
  return (teachingDays || []).filter((wd) => !occupied.has(wd))
}

/** A short, human summary of the week's holidays, or '' when none. */
export function holidaySummary(holidays) {
  if (!Array.isArray(holidays) || holidays.length === 0) return ''
  const parts = holidays.map((h) => `${h.weekday} (${h.holiday})`)
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  const isAre = holidays.length === 1 ? 'is a public holiday' : 'are public holidays'
  return `${list} ${isAre}`
}
