#!/usr/bin/env node
/**
 * Tests for the weekly-teaching-targets resolver (priority: timetable →
 * curriculum → teacher-entered). Uses real framework data via
 * frameworkSubjectMatch.
 * Run: npm run test:teaching-targets
 */

import {
  weeklyTargetForAssignment,
  weeklyTargets,
  anyTargetFromTimetable,
} from '../src/utils/teachingTargets.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}
function eq(a, b, msg) {
  assert(a === b, `${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

console.log('\nweeklyTargetForAssignment priority')
test('timetable wins when present', () => {
  const t = weeklyTargetForAssignment(
    { grade: 'G4', subject: 'mathematics', periodsPerWeek: 3 },
    { timetablePeriods: 7 },
  )
  eq(t.periods, 7)
  eq(t.source, 'timetable')
})
test('curriculum framework supplies primary allocation (not five-per-subject)', () => {
  // Upper-primary framework: Integrated Science is 6 periods, Social Studies 5.
  const sci = weeklyTargetForAssignment({ grade: 'G5', subject: 'integrated_science' })
  eq(sci.source, 'curriculum')
  assert(sci.periods > 0, 'expected a curriculum period count')
  const soc = weeklyTargetForAssignment({ grade: 'G5', subject: 'social_studies' })
  eq(soc.source, 'curriculum')
  // The two subjects must not both be a hardcoded 5.
  assert(!(sci.periods === 5 && soc.periods === 5), 'periods should reflect real per-subject allocation')
})
test('teacher-entered used when framework does not cover the subject (secondary)', () => {
  const t = weeklyTargetForAssignment({ grade: 'G10', subject: 'physics', periodsPerWeek: 4 })
  eq(t.source, 'teacher')
  eq(t.periods, 4)
})
test('none when nothing available', () => {
  const t = weeklyTargetForAssignment({ grade: 'G10', subject: 'physics' })
  eq(t.source, 'none')
  eq(t.periods, null)
})

console.log('\nweeklyTargets list')
test('skips inactive assignments and maps ids', () => {
  const rows = weeklyTargets(
    [
      { id: 'a1', grade: 'G5', subject: 'mathematics', isActive: true },
      { id: 'a2', grade: 'G5', subject: 'english', isActive: false },
    ],
  )
  eq(rows.length, 1)
  eq(rows[0].id, 'a1')
})
test('honours a per-assignment timetable map', () => {
  const rows = weeklyTargets(
    [{ id: 'a1', grade: 'G5', subject: 'mathematics', isActive: true }],
    { a1: 8 },
  )
  eq(rows[0].source, 'timetable')
  eq(rows[0].periods, 8)
  eq(anyTargetFromTimetable(rows), true)
})
test('anyTargetFromTimetable false without a timetable', () => {
  const rows = weeklyTargets([{ id: 'a1', grade: 'G5', subject: 'mathematics', isActive: true }])
  eq(anyTargetFromTimetable(rows), false)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
