#!/usr/bin/env node
/**
 * Tests for Scheme of Work calendar-derived term/year defaults (pure).
 * Run: npm run test:scheme-calendar-defaults
 */
import { resolveSchemeTermYear, isOffCurrentTerm } from '../src/features/schemeOfWork/lib/schemeCalendarDefaults.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const YEARS = [2026, 2027, 2028, 2029, 2030]

console.log('\nresolveSchemeTermYear')
test('uses the live calendar term + year', () => {
  const r = resolveSchemeTermYear({ forecastWeek: { year: 2027, termNumber: 2 }, calendarYears: YEARS, todayYear: 2027 })
  eq(r.term, 2); eq(r.year, 2027); eq(r.fromCalendar, true)
})
test('falls back to Term 1 + today when the calendar cannot place today', () => {
  const r = resolveSchemeTermYear({ forecastWeek: null, calendarYears: YEARS, todayYear: 2028 })
  eq(r.term, 1); eq(r.year, 2028); eq(r.fromCalendar, false)
})
test('falls back to the first calendar year when today is out of range', () => {
  const r = resolveSchemeTermYear({ forecastWeek: null, calendarYears: YEARS, todayYear: 2099 })
  eq(r.year, 2026); eq(r.fromCalendar, false)
})
test('a forecast year outside the calendar list is replaced by the fallback', () => {
  const r = resolveSchemeTermYear({ forecastWeek: { year: 2099, termNumber: 3 }, calendarYears: YEARS, todayYear: 2026 })
  eq(r.term, 3); eq(r.year, 2026); eq(r.fromCalendar, true)
})
test('an out-of-range term number is ignored (fallback)', () => {
  const r = resolveSchemeTermYear({ forecastWeek: { year: 2027, termNumber: 5 }, calendarYears: YEARS, todayYear: 2027 })
  eq(r.term, 1); eq(r.fromCalendar, false)
})
test('empty args do not throw', () => {
  const r = resolveSchemeTermYear()
  eq(r.term, 1); eq(r.fromCalendar, false)
})

console.log('\nisOffCurrentTerm')
test('true when the selected term differs from the live term', () => {
  eq(isOffCurrentTerm({ term: 2, year: 2027, fromCalendar: true }, { term: 1, year: 2027 }), true)
})
test('false when they match', () => {
  eq(isOffCurrentTerm({ term: 2, year: 2027, fromCalendar: true }, { term: 2, year: 2027 }), false)
})
test('false when the current term is not calendar-derived (nothing to anchor to)', () => {
  eq(isOffCurrentTerm({ term: 1, year: 2027, fromCalendar: false }, { term: 3, year: 2027 }), false)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
