// Planned teaching metadata — pure helpers (no Firebase/DOM, unit-testable).
//
// Connects the active Teaching Profile assignment + School Calendar to a newly
// created Lesson Plan: it picks a valid planned teaching date and builds the
// planned-teaching metadata stored on the plan. Editing an existing plan never
// runs through here (the studio opens saved plans in the Library), so stored
// metadata is preserved.
//
// Run tests: npm run test:planned-teaching-meta

import { teachingDaysInWeek, isNonTeachingDay } from './calendarResolver.js'

/**
 * Pick the active teaching assignment: the persisted last choice → the profile
 * default → the only/first active assignment. Pure; pass the active list.
 */
export function resolveActiveAssignment(activeAssignments, effectiveDefaultId, storedId) {
  const list = (Array.isArray(activeAssignments) ? activeAssignments : []).filter(
    (a) => a && a.isActive !== false,
  )
  if (!list.length) return null
  const byId = storedId ? list.find((a) => a.id === storedId) : null
  if (byId) return byId
  const byDefault = effectiveDefaultId ? list.find((a) => a.id === effectiveDefaultId) : null
  return byDefault || list[0]
}

/**
 * Convert a Teaching Profile grade code ('G4') to the Lesson Plan Studio's grade
 * value ('Grade 4'). ECE bands aren't offered by the studio, so they map to ''
 * (skip). Returns '' for anything unrecognised.
 */
export function gradeToStudioFormat(grade) {
  const m = String(grade || '').toUpperCase().match(/^G(\d{1,2})$/)
  return m ? `Grade ${m[1]}` : ''
}

function addDaysISO(iso, n) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

/**
 * Choose a valid planned teaching date for a NEW lesson plan, in priority order
 * (section 3):
 *   1. explicitDate     — a date the teacher already set
 *   2. forecastDate     — a date carried from Weekly Focus
 *   3. next teaching day in the current school week (>= today)
 *   4. next available teaching day from the calendar (bounded forward scan,
 *      within the term)
 *   5. '' — no safe date; the studio asks the teacher to choose one.
 * Never returns a weekend, public holiday, term break or out-of-term date.
 * `todayISO` is injectable for testing.
 */
export function pickPlannedDate({ explicitDate = '', forecastDate = '', context = null, todayISO = null } = {}) {
  if (explicitDate) return explicitDate
  if (forecastDate) return forecastDate
  if (!context || context.status !== 'ok') return ''

  // 3. Next teaching day in the current school week, not before today.
  if (context.weekBeginning) {
    const days = teachingDaysInWeek(context.weekBeginning).filter((d) => d.isTeachingDay)
    const inWeek = days.find((d) => !todayISO || d.date >= todayISO)
    if (inWeek) return inWeek.date
  }

  // 4. Next available teaching day from today, bounded to the current term.
  if (todayISO) {
    let cur = todayISO
    for (let i = 0; i < 21; i++) {
      if (context.termClose && cur > context.termClose) break
      if (!isNonTeachingDay(cur)) return cur
      cur = addDaysISO(cur, 1)
      if (!cur) break
    }
  }
  return ''
}

/**
 * Build the planned-teaching metadata stored on a new lesson plan. Nested under
 * the plan's `meta` (an allowlisted map in the aiGenerations rules), so it needs
 * no rules change. Calendar-derived fields are empty/null when the calendar
 * can't resolve — never guessed. Returns null when there's nothing to record.
 */
export function buildPlannedTeachingMeta({ assignment = null, context = null, plannedDate = '' } = {}) {
  const date = plannedDate || ''
  if (!assignment && !date) return null
  const ok = context && context.status === 'ok'
  return {
    assignmentId: assignment?.id || '',
    grade: assignment?.grade || '',
    subject: assignment?.subject || '',
    className: assignment?.className || '',
    curriculumType: assignment?.curriculumType || '',
    academicYear: ok ? String(context.academicYear) : '',
    termId: ok ? context.termId : '',
    termNumber: ok ? context.termNumber : null,
    schoolWeek: ok ? context.weekNumber : null,
    plannedDate: date,
    weekStartDate: ok ? context.weekBeginning : '',
    weekEndDate: ok ? context.weekEnding : '',
    schoolCalendarId: context?.calendarId || '',
  }
}
