#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for curriculum coverage in a school's own units
 * (src/features/classTimetable/lib/timetableCoverage.js): weekly TIME converted into this
 * school's lessons, the shift-session allocation strategies, and the
 * coverage chip.
 *
 * The load-bearing claim under test: converting a subject's PERIOD COUNT
 * is wrong the moment a lesson is not 40 minutes long. Six periods of
 * English at a 60-minute school is six hours, not the four the curriculum
 * asks for.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-coverage   (also via npm run test:all)
 */
import {
  ALLOCATION_STRATEGIES,
  DEFAULT_ALLOCATION_STRATEGY,
  getAllocationStrategy,
  isCoreSubject,
  formatDuration,
  formatAllocation,
  convertToLessons,
  describeConversion,
  resolveSubjectTargets,
  resolveCoverageUnit,
  formatCoverage,
} from '../src/features/classTimetable/lib/timetableCoverage.js'
import { curriculumSubjectsForGrade } from '../src/utils/classTimetable.js'
import { resolveTimetableCurriculum } from '../src/utils/curriculumFramework.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) } catch (err) {
    fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, message) { if (!cond) throw new Error(message) }
const eq = (a, b, message) => assert(a === b, `${message} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)

/** The official Upper Primary week, as the framework states it. */
const UPPER = resolveTimetableCurriculum({ grade: 'G5' })
const UPPER_SUBJECTS = curriculumSubjectsForGrade('G5')

console.log('\nTime formatting\n')

test('durations read the way a teacher writes them', () => {
  eq(formatDuration(1160), '19h 20m', 'a shift session’s week')
  eq(formatDuration(1680), '28h', 'a round week drops the minutes')
  eq(formatDuration(0), '0h', 'nothing placed')
  eq(formatDuration(45), '45m', 'under an hour')
  eq(formatAllocation(240), '4h00', 'the framework’s own allocation spelling')
  eq(formatAllocation(200), '3h20', 'including the awkward ones')
})

console.log('\nTime → this school’s lessons\n')

test('a 40-minute school gets the official period counts back unchanged', () => {
  eq(convertToLessons(240, 40).lessons, 6, 'English 4h00 → 6 periods')
  eq(convertToLessons(200, 40).lessons, 5, 'Zambian Language 3h20 → 5')
  eq(convertToLessons(280, 40).lessons, 7, 'Technology Studies 4h40 → 7')
  assert(convertToLessons(240, 40).exact, 'and the conversion is exact')
})

test('a 60-minute school converts the TIME, not the period count', () => {
  // This is the whole point: "6 periods of English" is not what the
  // curriculum asks for — 4 hours is.
  eq(convertToLessons(240, 60).lessons, 4, 'English 4h00 → 4 × 60-min lessons')
  eq(convertToLessons(240, 60).remainderMinutes, 0, 'exactly four hours')
  const zambian = convertToLessons(200, 60)
  eq(zambian.lessons, 3, 'Zambian Language 3h20 → 3 lessons')
  eq(zambian.remainderMinutes, -20, 'and the 20-minute shortfall is reported, not hidden')
  assert(!zambian.exact, 'a rounded conversion is flagged as rounded')
})

test('the conversion is described in words a teacher can check', () => {
  eq(
    describeConversion({ label: 'English Language', weeklyMinutes: 240, lessons: 4, remainderMinutes: 0, lessonMinutes: 60 }),
    'English Language — 4h00/wk → 4 × 60-min lessons',
    'the exact case reads cleanly',
  )
  assert(
    describeConversion({ label: 'Zambian Language', weeklyMinutes: 200, lessons: 3, remainderMinutes: -20, lessonMinutes: 60 })
      .includes('20 min under'),
    'a rounded conversion states the remainder',
  )
})

console.log('\nWeekly targets\n')

test('a full-day 40-minute week reproduces the official 42-period table', () => {
  const res = resolveSubjectTargets({
    subjects: UPPER_SUBJECTS,
    lessonMinutes: 40,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: null,
  })
  assert(!res.scaled, 'a full day is not scaled')
  eq(res.totals.targetLessons, 42, 'the week is the official 42 periods')
  eq(res.totals.targetMinutes, 1680, 'which is 28 hours')
  const english = res.rows.find((r) => r.label === 'English Language')
  eq(english.lessons, 6, 'English keeps its 6 periods')
})

test('a full-day 60-minute week owes the same TIME in fewer, longer lessons', () => {
  const res = resolveSubjectTargets({
    subjects: UPPER_SUBJECTS,
    lessonMinutes: 60,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: null,
  })
  eq(res.rows.find((r) => r.label === 'English Language').lessons, 4, 'English 4h00 → 4 lessons')
  eq(res.rows.find((r) => r.label === 'Mathematics').lessons, 4, 'Maths 4h00 → 4 lessons')
  eq(res.rows.find((r) => r.label === 'Technology Studies').lessons, 5, 'Tech 4h40 → 5 lessons')
  assert(res.totals.targetLessons < 42, 'the week is fewer lessons, not fewer hours')
})

console.log('\nShift sessions — core-first vs proportional\n')

/* The reference afternoon session: 29 forty-minute lessons a week. */
const SHIFT_CAPACITY = 29

test('core-first protects English, Mathematics and Science at their full time', () => {
  const res = resolveSubjectTargets({
    subjects: UPPER_SUBJECTS,
    lessonMinutes: 40,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: SHIFT_CAPACITY,
    strategy: 'core-first',
  })
  assert(res.scaled, 'a session smaller than the curriculum week is scaled')
  eq(res.totals.targetLessons, SHIFT_CAPACITY, 'the targets sum to EXACTLY the session’s capacity')
  for (const label of ['English Language', 'Mathematics', 'Science']) {
    eq(res.rows.find((r) => r.label === label).lessons, 6, `${label} keeps its full official allocation`)
  }
  // Everything else is scaled down, and nothing is scaled to nothing.
  for (const row of res.rows) {
    assert(row.lessons >= 1, `${row.label} can still reach ✓ — it has at least one lesson`)
  }
})

test('proportional keeps every subject’s share of the time the session has', () => {
  const res = resolveSubjectTargets({
    subjects: UPPER_SUBJECTS,
    lessonMinutes: 40,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: SHIFT_CAPACITY,
    strategy: 'proportional',
  })
  eq(res.totals.targetLessons, SHIFT_CAPACITY, 'still sums to the session’s capacity')
  const english = res.rows.find((r) => r.label === 'English Language')
  assert(english.lessons < 6, 'core subjects are scaled too under this strategy')
  // The heaviest official subject stays the heaviest here.
  const tech = res.rows.find((r) => r.label === 'Technology Studies')
  assert(tech.lessons >= english.lessons,
    'Technology Studies (4h40) keeps at least English’s share (4h00)')
})

test('every subject can reach ✓ inside the session, under either strategy', () => {
  for (const strategy of ['core-first', 'proportional']) {
    const res = resolveSubjectTargets({
      subjects: UPPER_SUBJECTS,
      lessonMinutes: 40,
      curriculumPeriodMinutes: UPPER.periodMinutes,
      capacityLessons: SHIFT_CAPACITY,
      strategy,
    })
    for (const row of res.rows) {
      assert(row.lessons > 0, `${strategy}: ${row.label} has a reachable target`)
    }
    eq(res.rows.reduce((n, r) => n + r.lessons, 0), SHIFT_CAPACITY,
      `${strategy}: filling the session exactly satisfies every target`)
  }
})

test('an unselected option-group subject is never given time', () => {
  const res = resolveSubjectTargets({
    subjects: UPPER_SUBJECTS,
    lessonMinutes: 40,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: SHIFT_CAPACITY,
  })
  assert(!res.rows.some((r) => r.label === 'Home Economics'),
    'Home Economics is the unselected option here and gets no target at all')
  assert(res.rows.some((r) => r.label === 'Expressive Arts'), 'the selected option does')
})

console.log('\nSchool subjects\n')

test('a school subject consumes capacity but never enters curriculum accounting', () => {
  const withLiteracy = [
    ...UPPER_SUBJECTS,
    { id: 'lit', label: 'Literacy', periodsPerWeek: 3, schoolSubject: true, selected: true },
  ]
  const res = resolveSubjectTargets({
    subjects: withLiteracy,
    lessonMinutes: 40,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: SHIFT_CAPACITY,
    strategy: 'core-first',
  })
  assert(!res.rows.some((r) => r.label === 'Literacy'),
    'Literacy is not one of the curriculum rows')
  eq(res.schoolRows.length, 1, 'it is reported separately')
  eq(res.schoolRows[0].lessons, 3, 'with the teacher’s own lesson count, verbatim')
  eq(res.totals.schoolLessons, 3, 'and it is counted as capacity used')
  eq(res.totals.targetLessons, SHIFT_CAPACITY - 3,
    'the curriculum is scaled into what is LEFT of the session')
})

console.log('\nThe coverage chip\n')

test('periods only when every lesson really is one curriculum period', () => {
  eq(resolveCoverageUnit({ lessonMinutes: 40, curriculumPeriodMinutes: 40, uniformLessons: true }), 'periods',
    'a 40-minute school may speak in periods')
  eq(resolveCoverageUnit({ lessonMinutes: 60, curriculumPeriodMinutes: 40, uniformLessons: true }), 'hours',
    'a 60-minute school must speak in hours — "38/42" would mean nothing')
  eq(resolveCoverageUnit({ lessonMinutes: 40, curriculumPeriodMinutes: 40, uniformLessons: false }), 'hours',
    'a day of mixed lesson lengths must speak in hours')
})

test('a full shift session reads "…placed ✓" against its OWN capacity', () => {
  const full = formatCoverage({
    placedMinutes: 1160, targetMinutes: 1160, unit: 'hours',
  })
  eq(full.text, '19h 20m of 19h 20m placed ✓', 'success is filling the session, not reaching 28 hours')
  assert(full.complete, 'and it is reported complete')
  eq(full.shortfall, 0, 'with nothing outstanding')
})

test('an unfinished week says so without inventing a deficit', () => {
  const partial = formatCoverage({ placedMinutes: 1480, targetMinutes: 1680, unit: 'hours' })
  eq(partial.text, '24h 40m of 28h placed', 'the brief’s own example')
  assert(!partial.complete, 'not complete yet')
  const periods = formatCoverage({ placedLessons: 38, targetLessons: 42, unit: 'periods' })
  eq(periods.text, '38/42 placed', 'and the period form')
})

console.log('\nStrategy registry\n')

test('the two strategies are declared once and default to core-first', () => {
  eq(DEFAULT_ALLOCATION_STRATEGY, 'core-first', 'core-first is the default')
  eq(ALLOCATION_STRATEGIES.length, 2, 'two strategies')
  eq(getAllocationStrategy('nonsense').id, 'core-first', 'an unknown id falls back to the default')
  assert(isCoreSubject('Mathematics') && isCoreSubject('English Language') && isCoreSubject('Science'),
    'the three protected areas')
  assert(isCoreSubject('Mathematics and Science'), 'and the integrated Lower Primary spelling')
  assert(!isCoreSubject('Expressive Arts'), 'practical subjects are not core')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
