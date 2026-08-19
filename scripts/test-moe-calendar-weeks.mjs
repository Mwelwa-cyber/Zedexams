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
  getTermWeeks, getCurrentForecastWeek, getActiveTerm, getMostRecentTerm,
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

/* ── getMostRecentTerm — the learner's term through a holiday ────────── */

test('getActiveTerm reports nothing between terms — the fact the learner side tripped on', () => {
  // 19 Aug 2026 is 12 days after Term 2 closed and 19 before Term 3 opens.
  // This assertion is not testing a fix; it pins the input that made the
  // learner term fall through to its Term 1 default for a month a year.
  assert(getActiveTerm(new Date('2026-08-19T00:00:00')) === null, 'expected no active term mid-holiday')
})

test('getMostRecentTerm names the term that just closed, through the holiday', () => {
  const r = getMostRecentTerm(new Date('2026-08-19T00:00:00'))
  assert(r, 'expected a term during the August holiday')
  assert(r.term.number === 2, `expected T2, got T${r?.term?.number}`)
  assert(r.phase === 'holiday', `expected phase holiday, got ${r?.phase}`)
  // Every day of the gap, not just the one the bug was found on.
  for (const day of ['2026-08-08', '2026-08-31', '2026-09-06']) {
    const g = getMostRecentTerm(new Date(`${day}T00:00:00`))
    assert(g?.term?.number === 2 && g.phase === 'holiday', `${day} resolved to T${g?.term?.number}/${g?.phase}`)
  }
})

test('getMostRecentTerm reports the active term unchanged while school is in', () => {
  for (const [day, num] of [['2026-02-02', 1], ['2026-06-15', 2], ['2026-10-05', 3]]) {
    const r = getMostRecentTerm(new Date(`${day}T00:00:00`))
    assert(r?.term?.number === num, `${day} expected T${num}, got T${r?.term?.number}`)
    assert(r?.phase === 'in-term', `${day} expected in-term, got ${r?.phase}`)
  }
})

test('getMostRecentTerm crosses the year end and stops before the calendar starts', () => {
  // Late December: Term 3 has closed, next year's Term 1 has not opened.
  const dec = getMostRecentTerm(new Date('2026-12-20T00:00:00'))
  assert(dec?.term?.number === 3 && dec.year === 2026, `expected 2026 T3, got ${dec?.year} T${dec?.term?.number}`)
  // Early January, before Term 1 opens: still last year's Term 3, which is
  // what the learner was last taught.
  const jan = getMostRecentTerm(new Date('2027-01-05T00:00:00'))
  assert(jan?.term?.number === 3 && jan.year === 2026, `expected 2026 T3, got ${jan?.year} T${jan?.term?.number}`)
  // Before the calendar has any closed term there is nothing to name, and
  // the caller's own Term 1 default is the right answer there.
  assert(getMostRecentTerm(new Date('2026-01-05T00:00:00')) === null, 'expected null before the first term')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
