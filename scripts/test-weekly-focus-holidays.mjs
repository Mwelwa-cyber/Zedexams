#!/usr/bin/env node
/**
 * Tests for Weekly Focus holiday availability (real 2026 MoE calendar).
 * Run: npm run test:weekly-focus-holidays
 */
import {
  weekTeachingAvailability,
  excludeHolidayWeekdays,
  holidaySummary,
  openMoveTargets,
} from '../src/utils/weeklyFocusHolidays.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

console.log('\nweekTeachingAvailability')
test('an ordinary week has five teaching days, no holidays', () => {
  const a = weekTeachingAvailability('2026-05-18')
  eq(a.count, 5)
  eq(a.holidays.length, 0)
  eq(a.teachingDays.join(','), 'Monday,Tuesday,Wednesday,Thursday,Friday')
})
test('week with Heroes Day (Mon) + Unity Day (Tue) → 3 teaching days', () => {
  const a = weekTeachingAvailability('2026-07-06')
  eq(a.count, 3)
  eq(a.holidays.length, 2)
  eq(a.holidays[0].weekday, 'Monday')
  eq(a.holidays[0].holiday, 'Heroes Day')
  eq(a.teachingDays.includes('Monday'), false)
  eq(a.teachingDays.includes('Wednesday'), true)
})
test('empty week beginning → empty availability', () => {
  const a = weekTeachingAvailability('')
  eq(a.count, 0)
  eq(a.holidays.length, 0)
})

console.log('\nexcludeHolidayWeekdays')
test('drops holiday weekdays from a list', () => {
  const holidays = [{ weekday: 'Monday', holiday: 'Heroes Day' }]
  eq(excludeHolidayWeekdays(['Monday', 'Wednesday', 'Friday'], holidays).join(','), 'Wednesday,Friday')
})
test('no holidays → list unchanged', () => {
  eq(excludeHolidayWeekdays(['Monday', 'Friday'], []).join(','), 'Monday,Friday')
})

console.log('\nopenMoveTargets')
test('returns open teaching days not already occupied', () => {
  const currentDays = [{ day: 'Monday' }, { day: 'Wednesday' }, { day: 'Friday' }]
  const teaching = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  eq(openMoveTargets(currentDays, teaching).join(','), 'Tuesday,Thursday')
})
test('accepts plain weekday strings', () => {
  eq(openMoveTargets(['Monday'], ['Monday', 'Tuesday']).join(','), 'Tuesday')
})
test('empty when the week is full', () => {
  eq(openMoveTargets(['Monday', 'Tuesday'], ['Monday', 'Tuesday']).length, 0)
})

console.log('\nholidaySummary')
test('one holiday', () => {
  eq(holidaySummary([{ weekday: 'Friday', holiday: 'Youth Day' }]), 'Friday (Youth Day) is a public holiday')
})
test('two holidays', () => {
  eq(
    holidaySummary([{ weekday: 'Monday', holiday: 'Heroes Day' }, { weekday: 'Tuesday', holiday: 'Unity Day' }]),
    'Monday (Heroes Day) and Tuesday (Unity Day) are public holidays',
  )
})
test('none → empty', () => {
  eq(holidaySummary([]), '')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
