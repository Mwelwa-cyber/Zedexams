#!/usr/bin/env node
/**
 * Tests for the weekly-forecast calendar helpers in src/utils/moeCalendar.js
 * (getTermWeeks / getCurrentForecastWeek / getTotalTeachingWeeks …).
 *
 * These drive the Weekly Forecast studio's smart week-number + week
 * beginning/ending dropdowns, so a regression here silently feeds teachers
 * the wrong dates. Run: npm run test:moe-calendar
 */

import {
  getCalendarYears, getTermByNumber, getTotalTeachingWeeks,
  getTermWeeks, getCurrentForecastWeek,
} from '../src/utils/moeCalendar.js'

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
  if (!cond) throw new Error(msg)
}

test('getCalendarYears returns the MoE years ascending', () => {
  const years = getCalendarYears()
  assert(years[0] === 2026, `expected first year 2026, got ${years[0]}`)
  for (let i = 1; i < years.length; i++) {
    assert(years[i] > years[i - 1], 'years must be ascending')
  }
})

test('getTermByNumber finds the right term', () => {
  const t = getTermByNumber(2026, 1)
  assert(t && t.number === 1, 'term 1 not found')
  assert(t.open === '2026-01-12', `unexpected open ${t?.open}`)
  assert(getTermByNumber(2026, 9) === null, 'unknown term should be null')
})

test('getTotalTeachingWeeks is a sane 10–14 week span', () => {
  const t = getTermByNumber(2026, 1)
  const weeks = getTotalTeachingWeeks(t)
  assert(weeks >= 10 && weeks <= 15, `expected 10–15 weeks, got ${weeks}`)
})

test('getTermWeeks builds Mon→Fri weeks anchored on the open date', () => {
  const weeks = getTermWeeks(2026, 1)
  assert(weeks.length === getTotalTeachingWeeks(getTermByNumber(2026, 1)), 'week count mismatch')
  assert(weeks[0].weekNumber === 1, 'first week should be week 1')
  assert(weeks[0].beginning === '2026-01-12', `week 1 begins ${weeks[0].beginning}`)
  assert(weeks[0].ending === '2026-01-16', `week 1 ends ${weeks[0].ending}`)
  assert(weeks[1].beginning === '2026-01-19', `week 2 begins ${weeks[1].beginning}`)
  // Labels are short, human-readable, and carry the year.
  assert(/12/.test(weeks[0].beginningLabel) && /2026/.test(weeks[0].beginningLabel),
    `unexpected begin label ${weeks[0].beginningLabel}`)
})

test('getTermWeeks returns [] for an unknown year', () => {
  assert(getTermWeeks(1999, 1).length === 0, 'unknown year should yield no weeks')
})

test('getCurrentForecastWeek points at the live week inside a term', () => {
  const wk = getCurrentForecastWeek(new Date('2026-01-20T00:00:00'))
  assert(wk, 'expected a week during term 1')
  assert(wk.year === 2026 && wk.termNumber === 1, `wrong term ${wk?.year}/${wk?.termNumber}`)
  assert(wk.weekNumber === 2, `expected week 2, got ${wk.weekNumber}`)
  assert(wk.beginning === '2026-01-19', `wrong beginning ${wk.beginning}`)
})

test('getCurrentForecastWeek rolls to the next term during the holidays', () => {
  const wk = getCurrentForecastWeek(new Date('2026-04-20T00:00:00'))
  assert(wk, 'expected the next upcoming term')
  assert(wk.termNumber === 2 && wk.weekNumber === 1, `expected T2 wk1, got T${wk?.termNumber} wk${wk?.weekNumber}`)
  assert(wk.beginning === '2026-05-11', `wrong beginning ${wk.beginning}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
