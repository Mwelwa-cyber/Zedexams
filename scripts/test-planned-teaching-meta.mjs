#!/usr/bin/env node
/**
 * Tests for planned-teaching-metadata helpers (date priority uses the real
 * 2026 MoE calendar so assertions are deterministic).
 * Run: npm run test:planned-teaching-meta
 */
import {
  resolveActiveAssignment,
  gradeToStudioFormat,
  pickPlannedDate,
  buildPlannedTeachingMeta,
} from '../src/utils/plannedTeachingMeta.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// T2 2026: 2026-05-11 … 2026-08-07. Week of Mon 2026-05-18.
const OK = {
  status: 'ok', academicYear: 2026, termNumber: 2, termId: '2026-T2',
  weekNumber: 2, weekBeginning: '2026-05-18', weekEnding: '2026-05-22',
  termClose: '2026-08-07', calendarId: 'moe-national',
}
const A = [
  { id: 'a1', grade: 'G4', subject: 'integrated_science', className: '4A', curriculumType: 'cbc', isActive: true },
  { id: 'a2', grade: 'G4', subject: 'mathematics', className: '', curriculumType: 'previous', isActive: true },
]

console.log('\nresolveActiveAssignment')
test('stored → default → first', () => {
  eq(resolveActiveAssignment(A, 'a1', 'a2').id, 'a2')
  eq(resolveActiveAssignment(A, 'a2', 'gone').id, 'a2')
  eq(resolveActiveAssignment(A, null, null).id, 'a1')
  eq(resolveActiveAssignment([], 'x', 'y'), null)
})

console.log('\ngradeToStudioFormat')
test('G-code → "Grade N"; ECE/unknown → empty', () => {
  eq(gradeToStudioFormat('G4'), 'Grade 4')
  eq(gradeToStudioFormat('G12'), 'Grade 12')
  eq(gradeToStudioFormat('ECE_N'), '')
  eq(gradeToStudioFormat('junk'), '')
})

console.log('\npickPlannedDate priority')
test('explicit date wins', () => {
  eq(pickPlannedDate({ explicitDate: '2026-05-20', forecastDate: '2026-05-21', context: OK }), '2026-05-20')
})
test('forecast date next', () => {
  eq(pickPlannedDate({ forecastDate: '2026-05-21', context: OK }), '2026-05-21')
})
test('next teaching day in current week (>= today)', () => {
  // Today Wed 2026-05-20 → next teaching day in week is Wed 2026-05-20 itself.
  eq(pickPlannedDate({ context: OK, todayISO: '2026-05-20' }), '2026-05-20')
})
test('skips a holiday to the next teaching day in the week', () => {
  // Week of Heroes Day (Mon 2026-07-06) + Unity Day (Tue 07-07). Today = Monday
  // holiday → first teaching day is Wed 2026-07-08.
  const wk = { ...OK, weekBeginning: '2026-07-06', weekEnding: '2026-07-10' }
  eq(pickPlannedDate({ context: wk, todayISO: '2026-07-06' }), '2026-07-08')
})
test('empty when calendar not ok', () => {
  eq(pickPlannedDate({ context: { status: 'unavailable' }, todayISO: '2026-05-20' }), '')
  eq(pickPlannedDate({ context: null }), '')
})
test('never returns a weekend', () => {
  // Today Sat 2026-05-16: the current-week branch picks the next in-week
  // teaching day (all Mon–Fri are >= today? no — Mon 18 >= Sat 16). Returns Mon.
  const d = pickPlannedDate({ context: OK, todayISO: '2026-05-16' })
  // Whatever it returns, it must be a weekday teaching date, not Sat/Sun.
  const day = new Date(d + 'T00:00:00').getDay()
  assert(day >= 1 && day <= 5, `expected a weekday, got ${d}`)
})

console.log('\nbuildPlannedTeachingMeta')
test('captures assignment + calendar fields', () => {
  const meta = buildPlannedTeachingMeta({ assignment: A[0], context: OK, plannedDate: '2026-05-20' })
  eq(meta.assignmentId, 'a1')
  eq(meta.className, '4A')
  eq(meta.curriculumType, 'cbc')
  eq(meta.academicYear, '2026')
  eq(meta.termId, '2026-T2')
  eq(meta.schoolWeek, 2)
  eq(meta.plannedDate, '2026-05-20')
  eq(meta.weekStartDate, '2026-05-18')
  eq(meta.schoolCalendarId, 'moe-national')
})
test('calendar-unavailable → empty calendar fields, still records assignment + date', () => {
  const meta = buildPlannedTeachingMeta({ assignment: A[0], context: { status: 'unavailable', calendarId: 'moe-national' }, plannedDate: '2026-05-20' })
  eq(meta.assignmentId, 'a1')
  eq(meta.academicYear, '')
  eq(meta.termId, '')
  eq(meta.schoolWeek, null)
  eq(meta.plannedDate, '2026-05-20')
})
test('null when nothing to record', () => {
  eq(buildPlannedTeachingMeta({ assignment: null, plannedDate: '' }), null)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
