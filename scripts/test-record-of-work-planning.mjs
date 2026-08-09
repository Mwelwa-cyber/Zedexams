#!/usr/bin/env node
/**
 * Tests for Record of Work planned-teaching integration (pure).
 * Run: npm run test:record-of-work-planning
 */
import {
  plannedLessonsForTerm,
  buildRecordWeeksFromCalendar,
  buildRecordOfWorkFromPlan,
  recordWeekHasContent,
  restoreRecordFromGeneration,
} from '../src/features/recordOfWork/lib/recordOfWorkPlanning.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

let planSeq = 0
function plan({ grade, subject, topic, subtopic, term, week, year = '2026', plannedDate = '2026-05-19', id, createdAt = 1000, inputsGrade, inputsSubject }) {
  return {
    id: id || `plan-${++planSeq}`,
    tool: 'lesson_plan',
    createdAt,
    inputs: { grade: inputsGrade ?? grade, subject: inputsSubject ?? subject, topic, subtopic, term: term != null ? String(term) : null },
    meta: { planned: { grade, subject, termNumber: term, schoolWeek: week, plannedDate, academicYear: year } },
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
test('a different academic year never seeds the record', () => {
  const gens = [plan({ grade: 'G4', subject: 'mathematics', topic: 'From2025', term: 2, week: 1, year: '2025' })]
  eq(plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2, academicYear: '2026' }).size, 0)
})
test('earliest planned lesson in the week wins (deterministic, not Firestore order)', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Wednesday', term: 2, week: 1, plannedDate: '2026-05-20', id: 'z' }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Monday', term: 2, week: 1, plannedDate: '2026-05-18', id: 'a' }),
  ]
  const m = plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 })
  eq(m.get(1).topic, 'Monday')
  eq(m.get(1).sourceLessonPlanId, 'a')
})
test('same planned date ties break on stable document id', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'B', term: 2, week: 1, plannedDate: '2026-05-18', id: 'bbb' }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'A', term: 2, week: 1, plannedDate: '2026-05-18', id: 'aaa' }),
  ]
  eq(plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 }).get(1).topic, 'A')
})
test('a week with genuinely different planned topics is flagged as a conflict', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 1, plannedDate: '2026-05-18' }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Decimals', term: 2, week: 1, plannedDate: '2026-05-20' }),
  ]
  const m = plannedLessonsForTerm(gens, { grade: 'G4', subject: 'mathematics', termNumber: 2 })
  eq(m.get(1).conflict, true)
  // Same topic twice (e.g. double lesson) is NOT a conflict.
  const same = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 2, plannedDate: '2026-05-25' }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 2, plannedDate: '2026-05-27' }),
  ]
  eq(plannedLessonsForTerm(same, { grade: 'G4', subject: 'mathematics', termNumber: 2 }).get(2).conflict, false)
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

console.log('\nmanual-entry protection + source references')
test('seeding never overwrites a teacher-entered week', () => {
  const gens = [plan({ grade: 'G4', subject: 'mathematics', topic: 'PlanTopic', term: 2, week: 1 })]
  const existing = [
    { week: '1', weekEnding: 'my date', topic: 'My own topic', subtopic: '', workDone: ['taught it'], coverage: 'full', remarks: 'done' },
  ]
  const { weeks, preservedCount } = buildRecordOfWorkFromPlan({
    generations: gens, termWeeks: TERM_WEEKS, existingWeeks: existing,
    grade: 'G4', subject: 'mathematics', termNumber: 2, academicYear: '2026',
  })
  eq(weeks[0].topic, 'My own topic')
  eq(weeks[0].coverage, 'full')
  eq(weeks[0].remarks, 'done')
  eq(weeks[0].weekEnding, 'my date')
  eq(preservedCount, 1)
})
test('a preserved week with a BLANK topic gets the planned topic filled in', () => {
  const gens = [plan({ grade: 'G4', subject: 'mathematics', topic: 'PlanTopic', term: 2, week: 1, id: 'src-1' })]
  const existing = [
    { week: '1', weekEnding: '', topic: '', subtopic: '', workDone: [], coverage: 'partial', remarks: '' },
  ]
  const { weeks } = buildRecordOfWorkFromPlan({
    generations: gens, termWeeks: TERM_WEEKS, existingWeeks: existing,
    grade: 'G4', subject: 'mathematics', termNumber: 2, academicYear: '2026',
  })
  eq(weeks[0].topic, 'PlanTopic')
  eq(weeks[0].coverage, 'partial') // teacher value kept
  eq(weeks[0].weekEnding, '22 May 2026') // blank filled from calendar
  eq(weeks[0].sourceLessonPlanId, 'src-1')
})
test('seeded rows carry the source lesson-plan reference; blank rows do not', () => {
  const gens = [plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 2, id: 'src-2' })]
  const { weeks } = buildRecordOfWorkFromPlan({
    generations: gens, termWeeks: TERM_WEEKS,
    grade: 'G4', subject: 'mathematics', termNumber: 2, academicYear: '2026',
  })
  eq(weeks[1].sourceLessonPlanId, 'src-2')
  eq('sourceLessonPlanId' in weeks[0], false)
})
test('conflict weeks are reported to the caller', () => {
  const gens = [
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, week: 1, plannedDate: '2026-05-18' }),
    plan({ grade: 'G4', subject: 'mathematics', topic: 'Decimals', term: 2, week: 1, plannedDate: '2026-05-20' }),
  ]
  const { conflictWeeks } = buildRecordOfWorkFromPlan({
    generations: gens, termWeeks: TERM_WEEKS,
    grade: 'G4', subject: 'mathematics', termNumber: 2, academicYear: '2026',
  })
  eq(conflictWeeks.join(','), '1')
})
test('recordWeekHasContent distinguishes typed rows from blanks', () => {
  eq(recordWeekHasContent({ week: '1', topic: '', workDone: [], coverage: '', remarks: '' }), false)
  eq(recordWeekHasContent({ week: '1', topic: 'x', workDone: [] }), true)
  eq(recordWeekHasContent({ week: '1', topic: '', workDone: ['did'] }), true)
  eq(recordWeekHasContent(null), false)
})

console.log('\nrestoreRecordFromGeneration (open by id)')
const SAVED = {
  id: 'rec-1',
  tool: 'record_of_work',
  output: {
    schemaVersion: 'record-of-work-1.0',
    header: { school: 'Kabulonga Primary', teacherName: 'M. M.', grade: 'G4', subject: 'Mathematics', term: 2, year: '2026' },
    weeks: [
      { week: '1', weekEnding: '22 May 2026', topic: 'Fractions', subtopic: '', workDone: ['taught halves'], coverage: 'full', remarks: '', sourceLessonPlanId: 'plan-9' },
      { week: '2', weekEnding: '', topic: '', subtopic: '', workDone: [], coverage: '', remarks: '' },
    ],
  },
}
test('restores the stored header + weeks verbatim (record is authoritative)', () => {
  const r = restoreRecordFromGeneration(SAVED)
  eq(r.header.grade, 'G4'); eq(r.header.subject, 'Mathematics'); eq(r.header.term, 2); eq(r.header.year, '2026')
  eq(r.weeks.length, 2)
  eq(r.weeks[0].topic, 'Fractions'); eq(r.weeks[0].coverage, 'full')
  eq(r.weeks[0].sourceLessonPlanId, 'plan-9') // extra stored fields preserved
})
test('normalizes malformed rows into the editable shape', () => {
  const r = restoreRecordFromGeneration({
    tool: 'record_of_work',
    output: { header: {}, weeks: [{ week: 3, workDone: 'not-an-array' }] },
  })
  eq(r.weeks[0].week, '3')
  eq(Array.isArray(r.weeks[0].workDone), true)
  eq(r.header.term, 1) // out-of-range term degrades to 1
})
test('rejects anything that is not a loadable record', () => {
  eq(restoreRecordFromGeneration(null), null)
  eq(restoreRecordFromGeneration({ tool: 'lesson_plan', output: { weeks: [{}] } }), null)
  eq(restoreRecordFromGeneration({ tool: 'record_of_work' }), null)                       // no output
  eq(restoreRecordFromGeneration({ tool: 'record_of_work', output: { weeks: [] } }), null) // empty weeks
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
