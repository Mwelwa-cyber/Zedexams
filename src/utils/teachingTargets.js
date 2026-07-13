// Weekly teaching targets — pure resolver (no Firebase, unit-testable).
//
// For each teaching assignment, work out the expected number of weekly periods
// and WHERE that number came from, using the priority order from the spec
// (section 13):
//   1. Class Timetable         — the real placed periods (most authoritative)
//   2. Curriculum allocation   — the official 2023 Framework periods/week
//   3. Teacher-entered value   — the periodsPerWeek the teacher typed
//
// Deliberately does NOT assume five periods for every subject — English/Maths
// are 6, Integrated Science 6, Social Studies 5, etc. in the primary framework,
// and secondary subjects fall back to the teacher-entered value.
//
// The timetable source is passed in (Phase 3 has no timetable wiring yet, so it
// is null and targets come from curriculum/teacher — Phase 7 supplies it).
//
// Run tests: npm run test:teaching-profile  (covered by test-teaching-targets)

import { matchFrameworkSubject } from './frameworkSubjectMatch.js'

/**
 * @param {{grade,subject,periodsPerWeek}} assignment  a normalized assignment
 * @param {{timetablePeriods?:number|null}} sources
 * @returns {{periods:number|null, source:'timetable'|'curriculum'|'teacher'|'none', label:string}}
 */
export function weeklyTargetForAssignment(assignment = {}, { timetablePeriods = null } = {}) {
  const tt = Number(timetablePeriods)
  if (Number.isFinite(tt) && tt > 0) {
    return { periods: tt, source: 'timetable', label: 'From Class Timetable' }
  }
  const fw = matchFrameworkSubject(assignment.grade, assignment.subject)
  if (fw && fw.periodsPerWeek > 0) {
    return { periods: fw.periodsPerWeek, source: 'curriculum', label: 'From Curriculum' }
  }
  const entered = Number(assignment.periodsPerWeek)
  if (Number.isFinite(entered) && entered > 0) {
    return { periods: entered, source: 'teacher', label: 'Teacher-entered' }
  }
  return { periods: null, source: 'none', label: 'Not set' }
}

/**
 * Build the weekly-target rows for a list of assignments (active only), each
 * tagged with its source. `timetablePeriodsByAssignmentId` is an optional map
 * from assignment id → placed periods (Phase 7); absent entries fall through to
 * curriculum/teacher.
 */
export function weeklyTargets(assignments = [], timetablePeriodsByAssignmentId = {}) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((a) => a && a.isActive !== false)
    .map((a) => ({
      id: a.id,
      grade: a.grade,
      subject: a.subject,
      ...weeklyTargetForAssignment(a, {
        timetablePeriods: timetablePeriodsByAssignmentId[a.id] ?? null,
      }),
    }))
}

/** True when at least one target is derived from a real timetable. */
export function anyTargetFromTimetable(targets = []) {
  return (Array.isArray(targets) ? targets : []).some((t) => t.source === 'timetable')
}
