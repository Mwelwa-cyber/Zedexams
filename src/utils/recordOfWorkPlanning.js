// Record of Work — planned-teaching integration (pure, unit-testable).
//
// The Record of Work is the statutory weekly log of what was ACTUALLY taught.
// These helpers seed it from the School Calendar (real week-ending dates) and
// pre-fill each week's planned topic from the teacher's LESSON PLANS for that
// term — joined on the planned school week (meta.planned.schoolWeek) that the
// Lesson Plan Studio already stamps. The teacher then records coverage/remarks
// against what was planned, instead of starting from a blank grid.
//
// No Firebase/DOM here — the studio passes in the generations + calendar week
// skeleton it already has. Row shape matches src/utils/recordOfWork.js exactly.
//
// Run tests: npm run test:record-of-work-planning

import { normSubject, normGrade, termNumberOf } from './prepareThisWeek.js'

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  const n = new Date(t).getTime()
  return Number.isFinite(n) ? n : 0
}

/**
 * Index the teacher's lesson plans for one term by their planned school week.
 * Matches on grade + subject (via meta.planned first, then inputs) + term;
 * the most recently created plan wins a given week.
 *
 * @returns {Map<number, {week, topic, subtopic, plannedDate}>}
 */
export function plannedLessonsForTerm(generations, { grade = '', subject = '', termNumber = null } = {}) {
  const wantGrade = normGrade(grade)
  const wantSubject = normSubject(subject)
  const byWeek = new Map()
  const stamp = new Map() // week → createdMs of the current winner

  for (const g of Array.isArray(generations) ? generations : []) {
    if (!g || g.tool !== 'lesson_plan') continue
    const planned = g.meta && typeof g.meta.planned === 'object' ? g.meta.planned : {}
    const gGrade = normGrade(planned.grade || g.inputs?.grade || '')
    const gSubject = normSubject(planned.subject || g.inputs?.subject || '')
    if (wantGrade && gGrade !== wantGrade) continue
    if (wantSubject && gSubject !== wantSubject) continue
    const gTerm = termNumberOf(planned.termNumber ?? g.inputs?.term)
    if (termNumber != null && gTerm !== termNumber) continue

    const week = Number(planned.schoolWeek)
    if (!Number.isInteger(week) || week < 1) continue

    const createdMs = toMs(g.createdAt)
    if (byWeek.has(week) && createdMs <= (stamp.get(week) || 0)) continue
    stamp.set(week, createdMs)
    byWeek.set(week, {
      week,
      topic: String(g.inputs?.topic || '').trim(),
      subtopic: String(g.inputs?.subtopic || '').trim(),
      plannedDate: planned.plannedDate || '',
    })
  }
  return byWeek
}

/**
 * Build Record of Work week rows from a calendar week skeleton, pre-filling the
 * planned topic/subtopic for weeks that have a lesson plan. Coverage/remarks are
 * left blank for the teacher to record. Row shape = blankRecordWeek's shape.
 *
 * @param termWeeks     getTermWeeks() → [{ weekNumber, ending, endingLabel }]
 * @param plannedByWeek plannedLessonsForTerm() result
 */
export function buildRecordWeeksFromCalendar({ termWeeks = [], plannedByWeek = new Map() } = {}) {
  return (Array.isArray(termWeeks) ? termWeeks : []).map((w) => {
    const planned = plannedByWeek instanceof Map ? plannedByWeek.get(w.weekNumber) : null
    return {
      week: String(w.weekNumber),
      weekEnding: w.endingLabel || w.ending || '',
      topic: planned ? planned.topic : '',
      subtopic: planned ? planned.subtopic : '',
      workDone: [],
      coverage: '',
      remarks: '',
    }
  })
}

/**
 * One call for the studio: calendar week skeleton + lesson-plan topics → record
 * week rows, plus how many weeks came pre-filled from a plan (for a friendly
 * "N of M weeks prefilled from your lesson plans" toast).
 */
export function buildRecordOfWorkFromPlan({ generations = [], termWeeks = [], grade = '', subject = '', termNumber = null } = {}) {
  const plannedByWeek = plannedLessonsForTerm(generations, { grade, subject, termNumber })
  const weeks = buildRecordWeeksFromCalendar({ termWeeks, plannedByWeek })
  const plannedCount = weeks.filter((w) => w.topic).length
  return { weeks, plannedCount }
}
