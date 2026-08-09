/**
 * schemeTermPlan — turn the MoE School Calendar into a week-by-week pacing
 * skeleton the Scheme of Work + Weekly Forecast studios plan against.
 *
 * The scheme generator used to take a raw `numberOfWeeks` integer from a
 * dropdown, blind to the real term. This derives the actual teaching weeks
 * from `moeCalendar.js` for the chosen year + term (Zambian terms run 12 OR
 * 13 teaching weeks — never a fixed count), tags which weeks are holiday-hit,
 * and lets the teacher reserve exam / revision weeks so the AI paces topics
 * around them instead of over the whole span.
 *
 * A "role" per week:
 *   'teaching' — normal topic delivery
 *   'revision' — reserved for revision (no new topic)
 *   'exam'     — reserved for the end-of-term examination (+ revision)
 *
 * Dependency-light (only pulls pure helpers from moeCalendar.js) so
 * `node src/utils/schemeTermPlan.test.js` runs it with plain node.
 */

import {
  getTermByNumber,
  getTermWeeks,
  getTotalTeachingWeeks,
} from '../../../utils/moeCalendar.js'

export const WEEK_ROLES = ['teaching', 'revision', 'exam']

export function roleLabel(role) {
  if (role === 'exam') return 'Revision & Examination'
  if (role === 'revision') return 'Revision'
  return 'Teaching'
}

/** Assign each of the term's public holidays to the week it falls in. */
function holidaysByWeek(weeks, holidays) {
  const list = Array.isArray(holidays) ? holidays : []
  return weeks.map((wk, i) => {
    const next = weeks[i + 1]
    // A holiday belongs to this week when its date is on/after this week's
    // Monday and before the next week's Monday (open-ended for the last week).
    return list.filter((h) => {
      const d = String(h?.date || '')
      if (!d) return false
      if (d < wk.beginning) return false
      if (next && d >= next.beginning) return false
      return true
    })
  })
}

/**
 * Build the pacing skeleton for a term.
 *
 * @param {{year:number|string, term:number|string}} opts
 * @returns {{
 *   year:number, term:number, teachingWeeks:number,
 *   weeks: Array<{ weekNumber:number, beginning:string, ending:string,
 *                  beginningLabel:string, endingLabel:string,
 *                  holidays:Array<{name:string,date:string}>, role:string }>
 * } | null}  null when the calendar has no data for that year/term.
 */
export function buildTermPlan({ year, term } = {}) {
  const y = Number(year)
  const t = Number(term)
  const termObj = getTermByNumber(y, t)
  if (!termObj) return null
  const weeks = getTermWeeks(y, t)
  if (!weeks.length) return null

  const perWeekHolidays = holidaysByWeek(weeks, termObj.holidays)
  const lastIdx = weeks.length - 1

  const planned = weeks.map((wk, i) => ({
    weekNumber: wk.weekNumber,
    beginning: wk.beginning,
    ending: wk.ending,
    beginningLabel: wk.beginningLabel,
    endingLabel: wk.endingLabel,
    holidays: perWeekHolidays[i],
    // Default: the final week is the end-of-term revision + examination week
    // (matching how the prompt already closes a term). Everything else teaches.
    role: i === lastIdx ? 'exam' : 'teaching',
  }))

  return {
    year: y,
    term: t,
    teachingWeeks: getTotalTeachingWeeks(termObj),
    weeks: planned,
  }
}

/**
 * Override week roles from teacher-marked exam / revision week numbers.
 * Returns a NEW plan (pure) — exam wins over revision when a week is in both.
 */
export function reserveWeeks(plan, { examWeeks = [], revisionWeeks = [] } = {}) {
  if (!plan || !Array.isArray(plan.weeks)) return plan
  const exam = new Set((examWeeks || []).map(Number))
  const revision = new Set((revisionWeeks || []).map(Number))
  return {
    ...plan,
    weeks: plan.weeks.map((wk) => {
      let role = wk.role
      if (revision.has(wk.weekNumber)) role = 'revision'
      if (exam.has(wk.weekNumber)) role = 'exam'
      // A week the teacher didn't mark, and that wasn't the default last-week
      // exam, is plain teaching — so un-marking clears a previous reservation.
      if (!exam.has(wk.weekNumber) && !revision.has(wk.weekNumber) && wk.role !== 'teaching') {
        role = 'teaching'
      }
      return { ...wk, role }
    }),
  }
}

/**
 * The revision weeks a term normally reserves when the teacher hasn't marked
 * any: the weeks immediately before the (first) exam week. Terms 1–2 take 2
 * revision weeks, Term 3 takes 3 (end-of-year exams need comprehensive
 * whole-year revision) — scaled down so a short term never spends more than
 * about a quarter of its weeks revising. Returns [] for very short terms.
 *
 * @param {{totalWeeks:number, examWeeks?:number[], term?:number}} args
 * @returns {number[]} ascending week numbers to reserve as revision
 */
export function defaultRevisionWeeks({ totalWeeks, examWeeks = [], term } = {}) {
  const n = Math.round(Number(totalWeeks) || 0)
  if (n < 6) return []
  const exams = (examWeeks || []).map(Number).filter((w) => Number.isFinite(w) && w >= 1)
  const firstExam = exams.length ? Math.min(...exams) : n
  const want = Number(term) === 3 ? 3 : 2
  const count = Math.min(want, Math.max(1, Math.floor((firstExam - 1) / 4)))
  const out = []
  for (let w = firstExam - count; w < firstExam; w += 1) {
    if (w >= 1) out.push(w)
  }
  return out
}

/** How many weeks in the plan are reserved (exam or revision). */
export function reservedWeekCount(plan) {
  if (!plan || !Array.isArray(plan.weeks)) return 0
  return plan.weeks.filter((w) => w.role !== 'teaching').length
}

/** How many weeks are available for delivering new topics. */
export function deliveryWeekCount(plan) {
  if (!plan || !Array.isArray(plan.weeks)) return 0
  return plan.weeks.filter((w) => w.role === 'teaching').length
}

/**
 * A compact, prompt-safe projection of the plan for the Cloud Function:
 * just the week number, role and short date labels (no nested holiday
 * objects). The server re-sanitises, but keeping it small keeps the prompt
 * cheap.
 */
export function toWeekPlanPayload(plan) {
  if (!plan || !Array.isArray(plan.weeks)) return []
  return plan.weeks.map((w) => ({
    week: w.weekNumber,
    role: w.role,
    beginning: w.beginningLabel,
    ending: w.endingLabel,
    holidays: (w.holidays || []).map((h) => h.name),
  }))
}
