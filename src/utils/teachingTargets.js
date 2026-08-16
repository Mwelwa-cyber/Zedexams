// Weekly teaching targets — pure resolver (no Firebase, unit-testable).
//
// For each teaching assignment, work out the expected number of weekly periods
// and WHERE that number came from.
//
// INTERIM order (until Phase 7 wires real Class Timetable detection), per the
// Phase 3 risk review:
//   1. Teacher-entered value   — the periodsPerWeek the teacher typed (trusted)
//   2. Curriculum allocation   — the official 2023 Framework periods/week
//   3. No target               — when no safe value can be produced (we do NOT
//                                fabricate an estimate; the card shows "Not set"
//                                and prompts the teacher to enter periods)
//
// Phase 7 will reintroduce the Class Timetable as the TOP priority — the
// `timetablePeriods` tier below stays in place but is only ever supplied then.
//
// Deliberately does NOT assume five periods for every subject — English/Maths
// are 6, Integrated Science 6, Social Studies 5, etc. in the primary framework.
//
// Run tests: npm run test:teaching-targets

import { matchFrameworkSubject } from '../curriculum/resolvers/frameworkSubjectMatch.js'

/**
 * @param {{grade,subject,periodsPerWeek}} assignment  a normalized assignment
 * @param {{timetablePeriods?:number|null}} sources  timetablePeriods is Phase-7-only
 * @returns {{periods:number|null, source:'timetable'|'teacher'|'curriculum'|'none', label:string}}
 */
export function weeklyTargetForAssignment(assignment = {}, { timetablePeriods = null } = {}) {
  // Phase 7: a real timetable, when supplied, is the most authoritative source.
  const tt = Number(timetablePeriods)
  if (Number.isFinite(tt) && tt > 0) {
    return { periods: tt, source: 'timetable', label: 'From Class Timetable' }
  }
  // Interim priority 1: the teacher's own entry is trusted over a generic
  // allocation (they know their real timetable better than the framework does).
  const entered = Number(assignment.periodsPerWeek)
  if (Number.isFinite(entered) && entered > 0) {
    return { periods: entered, source: 'teacher', label: 'Teacher-entered' }
  }
  // Interim priority 2: the official 2023 Framework allocation (primary only).
  const fw = matchFrameworkSubject(assignment.grade, assignment.subject)
  if (fw && fw.periodsPerWeek > 0) {
    return { periods: fw.periodsPerWeek, source: 'curriculum', label: 'From Curriculum' }
  }
  // Interim priority 3: no safe value — do not fabricate an estimate.
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
