/**
 * examDates — how many days a learner has left, from ONE date per grade.
 *
 * The countdown appears in three places that must never disagree: the learner
 * home hero, every guardian request message, and the win-back notification
 * trigger. Before this module the Grade 7 date was a `new Date(...)` literal
 * inside GradeHub.jsx AND a `startsAt` inside the seeded timetable, so
 * correcting an ECZ date meant finding both.
 *
 * The Grade 7 date is therefore not written here either — it is READ from
 * `PSLE_2026.startsAt`, the timetable transcribed from the official ECZ PDF
 * (`public/timetables/grade-7-2026-exam-timetable.pdf`). The timetable is the
 * document a person checks against; a second copy of its first date would be a
 * second thing to get wrong.
 *
 * ── The rule the callers depend on ─────────────────────────────────────
 *
 * `daysToExam` returns a positive integer or `null`. Never `NaN`, never a
 * negative number, never `0` for an exam that has already started. Every
 * surface renders the countdown only when it is non-null, so an unset grade, a
 * malformed date, or the day after the papers finish all produce the same
 * thing: nothing at all. A countdown that says "-3 days" is worse than no
 * countdown, and "NaN days" is worse than both.
 */

import { PSLE_2026 } from './examTimetable2026.js'

/**
 * The one Grade 7 ECZ constant. Change the timetable, not this line.
 * `+02:00` is CAT — the exam starts at 08:00 Lusaka time, and a countdown for
 * a Zambian learner must not drift by two hours because the device is on UTC.
 */
export const GRADE7_ECZ_EXAM_START = PSLE_2026.startsAt

/**
 * Per-grade exam start dates. A grade with no date simply has no countdown —
 * absent is a valid state, not an error, and the map is deliberately sparse
 * rather than filled with guesses for grades whose timetable has not been
 * published.
 */
export const EXAM_START_DATES = Object.freeze({
  7: GRADE7_ECZ_EXAM_START,
})

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The exam start for a grade, or null. Accepts `7`, `'7'`, `'Grade 7'`. */
export function examStartForGrade(grade) {
  if (grade == null) return null
  const digits = String(grade).match(/\d+/)
  if (!digits) return null
  return toDate(EXAM_START_DATES[Number(digits[0])])
}

/**
 * Whole days from `now` until the grade's exam starts.
 *
 * @returns {number|null} a positive integer, or null when there is no date,
 *   the date is unparseable, or the exam has started/passed.
 */
export function daysToExam(grade, now = new Date()) {
  const start = examStartForGrade(grade)
  if (!start) return null
  const at = toDate(now)
  if (!at) return null
  const days = Math.ceil((start.getTime() - at.getTime()) / MS_PER_DAY)
  return days > 0 ? days : null
}

/**
 * "47 days" / "1 day", or '' when there is nothing to count down to.
 * Callers render the empty string as nothing, which is why this returns a
 * string rather than throwing or substituting a placeholder.
 */
export function examCountdownLabel(grade, now = new Date()) {
  const days = daysToExam(grade, now)
  if (days == null) return ''
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * The win-back trigger from Part 6: fire once as the countdown crosses 30 days.
 *
 * Takes the days remaining at the LAST check as well as now, because "crossed"
 * is a transition and a threshold test alone (`days <= 30`) is true every day
 * for a month — which is a daily nag, the exact thing the fade replaces.
 */
export const WIN_BACK_THRESHOLD_DAYS = 30

export function crossedWinBackThreshold(previousDays, currentDays) {
  if (currentDays == null) return false
  if (currentDays > WIN_BACK_THRESHOLD_DAYS) return false
  if (previousDays == null) return false
  return previousDays > WIN_BACK_THRESHOLD_DAYS
}
