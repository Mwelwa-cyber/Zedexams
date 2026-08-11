#!/usr/bin/env node
/**
 * Tests for src/utils/attendanceInsights.js — the patterns a term's attendance
 * shows, stated as observations and never as conclusions.
 * Pure logic; no Firebase, no DOM.
 * Run: npm run test:attendance-insights  (also via npm run test:all)
 */

const {
  longestAbsenceRun,
  weekdayPattern,
  attendanceDrop,
  buildAttendanceInsights,
} = await import('../src/features/register/lib/attendanceInsights.js')
const { resolveAttendancePolicy } = await import('../src/utils/attendanceConstants.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const POLICY = resolveAttendancePolicy()
const entry = (date, status) => ({ date, status })

// Weekdays of a real term window: 2026-05-11 is a Monday.
function weekdays(count, from = '2026-05-11') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < count) {
    const day = d.getUTCDay()
    if (day >= 1 && day <= 5) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** Build the day objects the register hands out, with records attached. */
function buildDays(dates, recordsByDate = {}) {
  return dates.map((date) => ({
    date,
    markable: true,
    isFuture: false,
    classification: 'teaching_day',
    records: recordsByDate[date] || {},
  }))
}

// ── consecutive absence ──────────────────────────────────────────

console.log('\nconsecutive absence')

test('counts consecutive TEACHING days, not calendar days', () => {
  // Friday, then the following Monday and Tuesday — three teaching days in a
  // row with a weekend inside them.
  const run = longestAbsenceRun([
    entry('2026-05-14', 'present'),
    entry('2026-05-15', 'absent'), // Friday
    entry('2026-05-18', 'absent'), // Monday
    entry('2026-05-19', 'absent'), // Tuesday
  ])
  eq(run.length, 3)
  eq(run.from, '2026-05-15')
  eq(run.to, '2026-05-19')
  eq(run.ongoing, true)
})

test('a present day breaks the run', () => {
  const run = longestAbsenceRun([
    entry('2026-05-11', 'absent'),
    entry('2026-05-12', 'present'),
    entry('2026-05-13', 'absent'),
    entry('2026-05-14', 'absent'),
  ])
  eq(run.length, 2)
  eq(run.from, '2026-05-13')
})

test('an UNMARKED day neither continues nor breaks a run', () => {
  // We do not know what happened; treating the gap either way is an invention.
  const run = longestAbsenceRun([
    entry('2026-05-11', 'absent'),
    entry('2026-05-12', null),
    entry('2026-05-13', 'absent'),
  ])
  eq(run.length, 2, 'the two known absences are still consecutive absences')
})

test('sick and excused count as absence-like; late does not', () => {
  eq(longestAbsenceRun([entry('a', 'sick'), entry('b', 'excused')]).length, 2)
  eq(longestAbsenceRun([entry('a', 'late'), entry('b', 'late')]).length, 0)
})

// ── weekday pattern ──────────────────────────────────────────────

console.log('\nweekday pattern')

test('finds a learner who misses Mondays', () => {
  const days = weekdays(20)
  const entries = days.map((date) => {
    const isMonday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1
    return entry(date, isMonday ? 'absent' : 'present')
  })
  const p = weekdayPattern(entries)
  assert(p, 'expected a Monday pattern')
  eq(p.weekdayName, 'Monday')
  eq(p.missed, 4)
})

test('three scattered absences are three absences, not a pattern', () => {
  const days = weekdays(20)
  const entries = days.map((date, i) => entry(date, [2, 7, 14].includes(i) ? 'absent' : 'present'))
  eq(weekdayPattern(entries), null)
})

test('fewer than three misses is never a pattern', () => {
  const days = weekdays(10)
  const entries = days.map((date, i) => entry(date, i < 2 ? 'absent' : 'present'))
  eq(weekdayPattern(entries), null)
})

// ── attendance drop ──────────────────────────────────────────────

console.log('\nattendance drop')

test('reports a real fall between the halves of a term', () => {
  const entries = [
    ...Array.from({ length: 10 }, (_, i) => entry(`d${i}`, 'present')),
    ...Array.from({ length: 10 }, (_, i) => entry(`e${i}`, i < 5 ? 'absent' : 'present')),
  ]
  const drop = attendanceDrop(entries, POLICY)
  assert(drop, 'expected a drop')
  eq(drop.from, 100)
  eq(drop.to, 50)
  eq(drop.delta, 50)
})

test('ordinary week-to-week variation is not reported', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry(`d${i}`, i === 3 || i === 17 ? 'absent' : 'present'))
  eq(attendanceDrop(entries, POLICY), null)
})

test('too few marked days to compare returns nothing', () => {
  const entries = Array.from({ length: 6 }, (_, i) => entry(`d${i}`, i < 3 ? 'present' : 'absent'))
  eq(attendanceDrop(entries, POLICY), null)
})

// ── the class pass ───────────────────────────────────────────────

console.log('\nthe class pass')

const TERM = { startDate: '2026-05-11', endDate: '2026-08-07' }

test('builds the insights a term summary shows, worst first', () => {
  const dates = weekdays(20)
  const records = {}
  for (const date of dates) {
    records[date] = {
      naomi: { status: dates.indexOf(date) < 4 ? 'absent' : 'present' },
      alex: { status: 'present' },
    }
  }
  const insights = buildAttendanceInsights({
    learners: [
      { id: 'naomi', fullName: 'Naomi Chipeta' },
      { id: 'alex', fullName: 'Alex Lobela' },
    ],
    days: buildDays(dates, records),
    policy: POLICY,
    term: TERM,
  })
  const run = insights.find((i) => i.kind === 'consecutive_absence')
  assert(run, 'expected a consecutive-absence insight')
  eq(run.learnerName, 'Naomi Chipeta')
  assert(run.headline.includes('4 consecutive teaching days'), run.headline)

  const perfect = insights.find((i) => i.kind === 'perfect_attendance')
  assert(perfect && perfect.learnerName === 'Alex Lobela')

  // Worst first.
  eq(insights[0].kind, 'consecutive_absence')
})

test('unmarked days are reported once for the class, not once per learner', () => {
  const dates = weekdays(5)
  const records = {}
  dates.forEach((date, i) => {
    records[date] = i < 3 ? { a: { status: 'present' }, b: { status: 'present' } } : {}
  })
  const insights = buildAttendanceInsights({
    learners: [{ id: 'a', fullName: 'A Learner' }, { id: 'b', fullName: 'B Learner' }],
    days: buildDays(dates, records),
    policy: POLICY,
    term: TERM,
  })
  const unmarked = insights.filter((i) => i.kind === 'unmarked_days')
  eq(unmarked.length, 1)
  eq(unmarked[0].days, 2)
  eq(unmarked[0].learnerId, null)
})

test('every headline is an observation, never a conclusion', () => {
  const dates = weekdays(20)
  const records = {}
  dates.forEach((date, i) => { records[date] = { x: { status: i % 2 ? 'absent' : 'present' } } })
  const insights = buildAttendanceInsights({
    learners: [{ id: 'x', fullName: 'Test Learner' }],
    days: buildDays(dates, records),
    policy: POLICY,
    term: TERM,
  })
  const banned = /truan|lazy|neglect|at risk|unwell|sick child|drop.?out|parent.{0,12}fail/i
  for (const insight of insights) {
    assert(!banned.test(insight.headline), `medical/disciplinary language in: ${insight.headline}`)
    assert(!banned.test(insight.detail || ''), `medical/disciplinary language in: ${insight.detail}`)
  }
  assert(insights.length > 0, 'this learner should produce at least one insight')
})

test('a learner outside their enrolment window contributes no insights', () => {
  const dates = weekdays(10)
  const insights = buildAttendanceInsights({
    learners: [{ id: 'late', fullName: 'Late Joiner', joinedClassOn: '2026-12-01' }],
    days: buildDays(dates, {}),
    policy: POLICY,
    term: TERM,
  })
  eq(insights.filter((i) => i.learnerId === 'late').length, 0)
})

test('an empty register produces no insights rather than throwing', () => {
  eq(buildAttendanceInsights({ learners: [], days: [], policy: POLICY, term: TERM }).length, 0)
  eq(buildAttendanceInsights({}).length, 0)
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
