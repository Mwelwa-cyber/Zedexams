#!/usr/bin/env node
/**
 * Tests for Record of Work planned-teaching integration (pure).
 * Run: npm run test:record-of-work-planning
 */
import {
  plannedLessonsForTerm,
  buildRecordWeeksFromCalendar,
  buildRecordOfWorkFromPlan,
} from '../src/utils/recordOfWorkPlanning.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

function plan({ grade, subject, topic, subtopic, term, week, createdAt = 1000, inputsGrade, inputsSubject }) {
  return {
    tool: 'lesson_plan',
    createdAt,
    inputs: { grade: inputsGrade ?? grade, subject: inputsSubject ?? subject, topic, subtopic, term: term != null ? String(term) : null },
    meta: { planned: { grade, subject, termNumber: term, schoolWeek: week, plannedDate: '2026-05-19' } },
  }
}

const TERM_WEEKS = [
  { weekNumber: 1, ending: '2026-05-22', endingLabel: '22 May 2026' },
  { weekNumber: 2, ending: '2026-05-29', endingLabel: '29 May 2026' },
  { weekNumber: 3, ending: '2026-06-05', endingLabel: '5 Jun 2026' },
]

console.log('\nplannedLessonsForTerm')
test('indexes lesson plans by planned school week', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', subtopic: 'Equivalent', term: 2, week: 1 }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Decimals', term: 2, week: 3 }),
  ]
  const m = plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 })
  eq(m.get(1).topic, 'Fractions'); eq(m.get(1).subtopic, 'Equivalent')
  eq(m.get(3).topic, 'Decimals')
  eq(m.has(2), false)
})
test('matches label vs slug subject and Grade-4 vs G4 grade', () => {
  const gens = [plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 1 })]
  const m = plannedLessonsForTerm(gens, { grade: 'Grade 4', subject: 'Mathematics', termNumber: 2 })
  eq(m.get(1).topic, 'Fractions')
})
test('excludes other grades / subjects / terms', () => {
  const gens = [
    plan({ grade: 'G5', subject: 'mathematics', topic: 'X', term: 2, week: 1 }),
    plan({ grade: 'G4', subject: 'english', topic: 'Y', term: 2, week: 1 }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Z', term: 1, week: 1 }),
  ]
  eq(plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 }).size, 0)
})
test('newest plan wins a week', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Old', term: 2, week: 1, createdAt: 1000 }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'New', term: 2, week: 1, createdAt: 5000 }),
  ]
  eq(plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 }).get(1).topic, 'New')
})
test('ignores non-lesson-plan docs and weekless plans', () => {
  const gens = [
    { tool: 'scheme_of_work', inputs: { grade: 'G4', subject: 'mathematics', term: '2' }, meta: { planned: { schoolWeek: 1 } } },
    plan({ grade: 'G4', subject: 'mathematics', topic: 'NoWeek', term: 2, week: null }),
  ]
  eq(plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 }).size, 0)
})

console.log('\nbuildRecordWeeksFromCalendar')
test('produces a row per calendar week with real week-endings', () => {
  const rows = buildRecordWeeksFromCalendar({ termWeeks: TERM_WEEKS, plannedByWeek: new Map() })
  eq(rows.length, 3)
  eq(rows[0].week, '1'); eq(rows[0].weekEnding, '22 May 2026')
  eq(rows[0].topic, ''); eq(rows[0].coverage, ''); eq(Array.isArray(rows[0].workDone), true)
})
test('pre-fills planned topics on matching weeks only', () => {
  const planned = new Map([[2, { week: 2, topic: 'Fractions', subtopic: 'Equivalent' }]])
  const rows = buildRecordWeeksFromCalendar({ termWeeks: TERM_WEEKS, plannedByWeek: planned })
  eq(rows[0].topic, '')
  eq(rows[1].topic, 'Fractions'); eq(rows[1].subtopic, 'Equivalent')
  eq(rows[2].topic, '')
})

console.log('\nbuildRecordOfWorkFromPlan')
test('joins calendar + lesson plans and counts prefilled weeks', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 1 }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Decimals', term: 2, week: 3 }),
  ]
  const { weeks, plannedCount } = buildRecordOfWorkFromPlan({
    generations: gens, termWeeks: TERM_WEEKS, grade: 'G4', subject: 'mathematics', termNumber: 2,
  })
  eq(weeks.length, 3)
  eq(weeks[0].topic, 'Fractions')
  eq(weeks[2].topic, 'Decimals')
  eq(plannedCount, 2)
})
test('no calendar weeks → empty', () => {
  eq(buildRecordOfWorkFromPlan({ generations: [], termWeeks: [] }).weeks.length, 0)
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
