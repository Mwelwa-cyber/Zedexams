#!/usr/bin/env node
/**
 * Tests for the Calendar Resolver reference seam + derived closure/holiday
 * helpers. All dates are inside the hardcoded 2026 MoE calendar so the
 * assertions are deterministic (no dependency on "today").
 * Run: npm run test:calendar-resolver
 */

import {
  NATIONAL_CALENDAR_ID,
  DEFAULT_TEACHING_DAYS,
  listAvailableCalendars,
  resolveCalendar,
  calendarLabel,
  isTeachingWeekday,
  isWeekend,
  isPublicHoliday,
  publicHolidayOn,
  isTermBreak,
  isNonTeachingDay,
  teachingDaysInWeek,
  resolveTeachingContext,
  isContextUsable,
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

// ── centralised teaching-day config (Risk 3) ─────────────────────────────────
console.log('\nteaching-day config')
test('default teaching days are Mon–Fri', () => {
  eq(JSON.stringify(DEFAULT_TEACHING_DAYS), JSON.stringify([1, 2, 3, 4, 5]))
})
test('isTeachingWeekday honours the default and an override', () => {
  eq(isTeachingWeekday('2026-05-18'), true) // Monday
  eq(isTeachingWeekday('2026-05-16'), false) // Saturday, default
  eq(isTeachingWeekday('2026-05-16', [1, 2, 3, 4, 5, 6]), true) // Saturday-teaching override
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

// ── resolveTeachingContext — the load-bearing safeguard (Risk 2) ────────────
// Never returns null; always a structured object with a `status`. Every failure
// mode below must degrade to closed/null fields, never a crash or a guessed
// Week 1.
console.log('\nresolveTeachingContext — success')
test('valid term date: ok, correct term + week + next term, isTeachingDay', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2026-05-20' })
  eq(ctx.status, 'ok')
  eq(isContextUsable(ctx), true)
  eq(ctx.isActiveTerm, true)
  eq(ctx.isClosed, false)
  eq(ctx.isTeachingDay, true) // 2026-05-20 is a Wednesday in term, no holiday
  eq(ctx.academicYear, 2026)
  eq(ctx.termNumber, 2)
  eq(ctx.weekNumber, 2) // T2 opens 05-11 (Mon); 05-20 is week 2
  assert(ctx.totalTeachingWeeks > 0)
  assert(ctx.remainingTeachingWeeks >= 0)
  eq(ctx.nextTerm.termNumber, 3)
  assert(ctx.weekBeginningLabel.length > 0)
})
test('holiday date: ok but isTeachingDay false', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2026-07-06' })
  eq(ctx.status, 'ok')
  eq(ctx.isTeachingDay, false) // Heroes Day
})
test('missing calendarId falls back to national (ok, not a failure)', () => {
  const ctx = resolveTeachingContext({ date: '2026-05-20' })
  eq(ctx.status, 'ok')
  eq(ctx.calendarId, NATIONAL_CALENDAR_ID)
})
test('referenceDate resolves the term for that date (not today)', () => {
  // A document planned for Term 3 resolves Term 3 regardless of "today".
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, referenceDate: '2026-09-14' })
  eq(ctx.status, 'ok')
  eq(ctx.termNumber, 3)
  eq(ctx.academicYear, 2026)
})
test('term break: ok, isClosed true, points at the next term to prepare', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2026-04-20' })
  eq(ctx.status, 'ok')
  eq(ctx.isActiveTerm, false)
  eq(ctx.isClosed, true)
  eq(ctx.isTeachingDay, false)
  eq(ctx.termNumber, 2) // the upcoming term
  eq(ctx.nextTerm.termNumber, 2)
  assert(ctx.nextTerm.daysUntilOpen > 0)
  eq(ctx.nextTerm.open, '2026-05-11')
})

console.log('\nresolveTeachingContext — failure modes never crash')
function assertSafeEmpty(ctx) {
  eq(isContextUsable(ctx), false)
  eq(ctx.isTeachingDay, false)
  eq(ctx.termNumber, null)
  eq(ctx.weekNumber, null)
  eq(ctx.nextTerm, null)
  assert(Array.isArray(ctx.upcomingHolidays))
}
test('unknown calendar id → unavailable / calendar_not_found', () => {
  const ctx = resolveTeachingContext({ calendarId: 'school-xyz', date: '2026-05-20' })
  eq(ctx.status, 'unavailable')
  eq(ctx.reason, 'calendar_not_found')
  assertSafeEmpty(ctx)
})
test('year after 2030 → out_of_range / year_not_supported', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2031-06-01' })
  eq(ctx.status, 'out_of_range')
  eq(ctx.reason, 'year_not_supported')
  assertSafeEmpty(ctx)
})
test('date before supported range still resolves forward, never crashes', () => {
  // Late-2025 use: no active term, but 2026 T1 is upcoming — degrade to a
  // "closed, prepare for next term" context rather than a hard failure.
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: '2025-12-01' })
  eq(ctx.status, 'ok')
  eq(ctx.isClosed, true)
  eq(ctx.nextTerm.academicYear, 2026)
})
test('invalid date string → invalid_date', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID, date: 'not-a-date' })
  eq(ctx.status, 'invalid_date')
  eq(ctx.reason, 'invalid_date')
  assertSafeEmpty(ctx)
})
test('no date given defaults to today and still returns a structured object', () => {
  const ctx = resolveTeachingContext({ calendarId: NATIONAL_CALENDAR_ID })
  assert(['ok', 'out_of_range'].includes(ctx.status)) // depends on "today", but never throws/null
  assert(typeof ctx.isTeachingDay === 'boolean')
})

// ── report ───────────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
