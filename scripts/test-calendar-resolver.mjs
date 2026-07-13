#!/usr/bin/env node
/**
 * Tests for the Calendar Resolver reference seam + derived closure/holiday
 * helpers. All dates are inside the hardcoded 2026 MoE calendar so the
 * assertions are deterministic (no dependency on "today").
 * Run: npm run test:calendar-resolver
 */

import {
  NATIONAL_CALENDAR_ID,
  listAvailableCalendars,
  resolveCalendar,
  calendarLabel,
  isWeekend,
  isPublicHoliday,
  publicHolidayOn,
  isTermBreak,
  isNonTeachingDay,
  teachingDaysInWeek,
  resolveTeachingContext,
} from '../src/utils/calendarResolver.js'

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

// 2026 MoE reference points:
//   T1 2026-01-12 … 2026-04-10
//   T2 2026-05-11 … 2026-08-07   (opens on a Monday)
//   T3 2026-09-07 … 2026-12-04
//   Break between T1 and T2: 2026-04-11 … 2026-05-10
//   Heroes Day 2026-07-06 (Mon), Unity Day 2026-07-07 (Tue)

// ── registry / resolution ────────────────────────────────────────────────────
console.log('\ncalendar registry')
test('lists the national calendar', () => {
  const all = listAvailableCalendars()
  eq(all.length >= 1, true)
  eq(all[0].id, NATIONAL_CALENDAR_ID)
})
test('resolves known id, blank → national, unknown → null', () => {
  eq(resolveCalendar(NATIONAL_CALENDAR_ID).id, NATIONAL_CALENDAR_ID)
  eq(resolveCalendar('').id, NATIONAL_CALENDAR_ID)
  eq(resolveCalendar('school-xyz'), null)
})
test('calendarLabel is human', () => {
  assert(calendarLabel(NATIONAL_CALENDAR_ID).length > 0)
  eq(calendarLabel('unknown'), '')
})

// ── weekend / holiday / break predicates ─────────────────────────────────────
console.log('\nclosure predicates')
test('isWeekend detects Sat/Sun', () => {
  eq(isWeekend('2026-05-16'), true) // Saturday
  eq(isWeekend('2026-05-17'), true) // Sunday
  eq(isWeekend('2026-05-18'), false) // Monday
})
test('isPublicHoliday matches gazetted holidays', () => {
  eq(isPublicHoliday('2026-01-01'), true) // New Year's Day
  eq(isPublicHoliday('2026-12-25'), true) // Christmas
  eq(isPublicHoliday('2026-05-20'), false)
})
test('publicHolidayOn returns the name', () => {
  eq(publicHolidayOn('2026-07-06').name, 'Heroes Day')
  eq(publicHolidayOn('2026-05-20'), null)
})
test('isTermBreak true between terms, false inside a term', () => {
  eq(isTermBreak('2026-04-20'), true) // between T1 and T2
  eq(isTermBreak('2026-05-20'), false) // inside T2
})
test('isNonTeachingDay combines break + weekend + holiday', () => {
  eq(isNonTeachingDay('2026-04-20'), true) // break
  eq(isNonTeachingDay('2026-05-16'), true) // weekend
  eq(isNonTeachingDay('2026-07-06'), true) // holiday
  eq(isNonTeachingDay('2026-05-20'), false) // ordinary teaching day
})

// ── teaching days in a week (section 18: holiday shortens the week) ──────────
console.log('\nteaching days in a week')
test('a week with two holidays has three teaching days', () => {
  // Week beginning Mon 2026-07-06: Heroes Day (Mon) + Unity Day (Tue) are holidays.
  const days = teachingDaysInWeek('2026-07-06')
  eq(days.length, 5)
  eq(days[0].weekday, 'Monday')
  eq(days[0].isTeachingDay, false)
  eq(days[0].holiday, 'Heroes Day')
  eq(days[1].isTeachingDay, false)
  eq(days[1].holiday, 'Unity Day')
  const teaching = days.filter((d) => d.isTeachingDay).length
  eq(teaching, 3)
})
test('an ordinary week has five teaching days', () => {
  const days = teachingDaysInWeek('2026-05-18') // no holiday this week
  eq(days.filter((d) => d.isTeachingDay).length, 5)
})

// ── resolveTeachingContext ───────────────────────────────────────────────────
console.log('\nresolveTeachingContext')
test('active term: not closed, correct term + week + next term', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2026-05-20' })
  assert(ctx, 'context should resolve')
  eq(ctx.isActiveTerm, true)
  eq(ctx.isClosed, false)
  eq(ctx.academicYear, 2026)
  eq(ctx.termNumber, 2)
  eq(ctx.weekNumber, 2) // T2 opens 05-11 (Mon); 05-20 is week 2
  assert(ctx.totalTeachingWeeks > 0)
  assert(ctx.remainingTeachingWeeks >= 0)
  eq(ctx.nextTerm.termNumber, 3)
  assert(ctx.weekBeginningLabel.length > 0)
})
test('term break: isClosed true and points at the next term to prepare', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2026-04-20' })
  assert(ctx, 'context should resolve during a break')
  eq(ctx.isActiveTerm, false)
  eq(ctx.isClosed, true)
  eq(ctx.termNumber, 2) // the upcoming term
  eq(ctx.nextTerm.termNumber, 2)
  assert(ctx.nextTerm.daysUntilOpen > 0)
  eq(ctx.nextTerm.open, '2026-05-11')
})
test('unknown calendar resolves to null (callers must handle it)', () => {
  eq(resolveTeachingContext({ calendarId: 'school-xyz', date: '2026-05-20' }), null)
})

// ── report ───────────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
