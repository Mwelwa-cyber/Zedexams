#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Weekly Focus planner (src/utils/weeklyFocusPlanner.js):
 * timetable→schedule derivation, syllabus topic catalogue, per-topic field
 * auto-fill (with module fallback flag), and the forecast alerts.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:weekly-focus-planner   (also via npm run test:all)
 */
import {
  WEEKDAYS,
  splitLines,
  normalizeGrade,
  subjectMatches,
  subjectScheduleFromTimetable,
  buildTopicCatalog,
  subtopicsForTopic,
  dayFieldsFromTopic,
  forecastAlerts,
} from '../src/utils/weeklyFocusPlanner.js'

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
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// Sample merged KB topics (the shape listAllSyllabusTopics returns).
const KB = [
  {
    grade: 'G4', subject: 'mathematics', topic: 'Whole Numbers', _source: 'syllabi_studio',
    specificOutcomes: [],
    subtopics: [
      { name: 'Place Value', specificCompetence: 'Read and write whole numbers', learningActivities: 'Counting in groups\nWriting numbers in words', expectedStandard: 'Whole numbers read and written correctly' },
      { name: 'Ordering Numbers', specificCompetence: 'Order whole numbers', learningActivities: 'Ordering number cards', expectedStandard: 'Numbers ordered correctly' },
    ],
  },
  {
    grade: 'G4', subject: 'mathematics', topic: 'Fractions', _source: 'firestore',
    specificOutcomes: ['Identify fractions'],
    subtopics: [
      { name: 'Halves and Quarters', specificCompetence: 'Identify halves and quarters', learningActivities: 'Folding paper; shading shapes', expectedStandard: 'Halves and quarters identified' },
    ],
  },
  // Different grade — must be filtered out.
  { grade: 'G5', subject: 'mathematics', topic: 'Large Numbers', subtopics: [] },
  // Different subject — must be filtered out.
  { grade: 'G4', subject: 'english', topic: 'Phonics', subtopics: [] },
]

console.log('\nhelpers')
test('normalizeGrade accepts 4 / "4" / "g4"', () => {
  assert(normalizeGrade(4) === 'G4' && normalizeGrade('4') === 'G4' && normalizeGrade('g4') === 'G4', 'grade normalisation')
  assert(normalizeGrade('') === '', 'empty in, empty out')
})
test('splitLines breaks newlines, semicolons and bullets', () => {
  assert(splitLines('a\n- b; c').join('|') === 'a|b|c', `got ${splitLines('a\n- b; c').join('|')}`)
  assert(splitLines(['x', '', 'y']).length === 2, 'array trimmed of blanks')
  assert(splitLines('').length === 0, 'empty string → []')
})
test('subjectMatches is tolerant of label drift', () => {
  assert(subjectMatches('Integrated Science', 'Science'), 'contains match')
  assert(subjectMatches('Mathematics', 'mathematics'), 'case-insensitive')
  assert(!subjectMatches('English', 'Mathematics'), 'no false positive')
})

console.log('\ntimetable → schedule')
const TIMETABLE = {
  slots: {
    p1: { Monday: 'Mathematics', Wednesday: 'Mathematics', Friday: 'Mathematics' },
    p2: { Monday: 'English', Tuesday: 'Mathematics' },
  },
}
test('subjectScheduleFromTimetable counts days + periods, Mon→Fri order', () => {
  const s = subjectScheduleFromTimetable(TIMETABLE, 'Mathematics')
  assert(s.days.join(',') === 'Monday,Tuesday,Wednesday,Friday', `ordered days (got ${s.days.join(',')})`)
  assert(s.periodsPerWeek === 4, `four periods (got ${s.periodsPerWeek})`)
})
test('subject not on the timetable → empty schedule', () => {
  const s = subjectScheduleFromTimetable(TIMETABLE, 'Cinyanja')
  assert(s.days.length === 0 && s.periodsPerWeek === 0, 'nothing scheduled')
})
test('no timetable → empty schedule (no throw)', () => {
  assert(subjectScheduleFromTimetable(null, 'Mathematics').periodsPerWeek === 0, 'null tolerated')
})

console.log('\ntopic catalogue')
const catalog = buildTopicCatalog(KB, 'G4', 'mathematics')
test('catalogue filters to grade + subject', () => {
  assert(catalog.length === 2, `two G4 maths topics (got ${catalog.length})`)
  assert(catalog.map((c) => c.topic).join(',') === 'Fractions,Whole Numbers', 'sorted topics')
})
test('catalogue flags module-sourced topics', () => {
  assert(catalog.find((c) => c.topic === 'Fractions').source === 'module', 'firestore → module')
  assert(catalog.find((c) => c.topic === 'Whole Numbers').source === 'syllabi_studio', 'syllabi source')
})
test('subtopicsForTopic depends on the topic', () => {
  assert(subtopicsForTopic(catalog, 'Whole Numbers').join(',') === 'Place Value,Ordering Numbers', 'WN subtopics')
  assert(subtopicsForTopic(catalog, 'Fractions').join(',') === 'Halves and Quarters', 'fractions subtopics')
  assert(subtopicsForTopic(catalog, 'Nonexistent').length === 0, 'unknown topic → []')
})

console.log('\ntopic → day fields')
test('dayFieldsFromTopic aggregates across subtopics when none chosen', () => {
  const f = dayFieldsFromTopic(catalog, 'Whole Numbers')
  assert(f.subtopic === 'Place Value, Ordering Numbers', `subtopics joined (got ${f.subtopic})`)
  assert(f.specificCompetence.includes('Read and write') && f.specificCompetence.includes('; '), 'competences joined')
  assert(f.learningActivities.length === 3, `activities split (got ${f.learningActivities.length})`)
  assert(f.expectedStandard.includes('read and written') && f.expectedStandard.includes('ordered'), 'standards joined')
})
test('dayFieldsFromTopic narrows to one subtopic', () => {
  const f = dayFieldsFromTopic(catalog, 'Whole Numbers', 'Ordering Numbers')
  assert(f.subtopic === 'Ordering Numbers', 'single subtopic')
  assert(f.learningActivities.join() === 'Ordering number cards', 'only that subtopic activities')
})
test('dayFieldsFromTopic reports the source + null for unknown', () => {
  assert(dayFieldsFromTopic(catalog, 'Fractions').source === 'module', 'source surfaced')
  assert(dayFieldsFromTopic(catalog, 'Unknown') === null, 'unknown topic → null')
})

console.log('\nalerts')
test('warns when subject is missing from the timetable', () => {
  const a = forecastAlerts({ subjectLabel: 'Cinyanja', timetableSelected: true, scheduleDays: [] })
  assert(a.some((x) => x.level === 'warn' && /doesn't appear/.test(x.message)), 'missing-subject warning')
})
test('warns when planned days exceed allocated periods', () => {
  const days = WEEKDAYS.slice(0, 4).map((d) => ({ day: d, topic: 'X' }))
  const a = forecastAlerts({ subjectLabel: 'Mathematics', timetableSelected: true, scheduleDays: WEEKDAYS.slice(0, 2), periodsPerWeek: 2, days })
  assert(a.some((x) => /only 2 period/.test(x.message)), 'over-allocation warning')
})
test('warns on off-curriculum topics', () => {
  const a = forecastAlerts({ subjectLabel: 'Mathematics', topicCatalog: catalog, days: [{ day: 'Monday', topic: 'Astrophysics', learningActivities: ['x'], expectedStandard: 'y' }] })
  assert(a.some((x) => /Not in the/.test(x.message) && /Astrophysics/.test(x.message)), 'off-curriculum warning')
})
test('info when activities/standards missing + module fallback used', () => {
  const a = forecastAlerts({ days: [{ day: 'Monday', topic: 'Whole Numbers', learningActivities: [], expectedStandard: '' }], usedModuleFallback: true })
  assert(a.some((x) => x.level === 'info' && /learning activities/.test(x.message)), 'missing-detail info')
  assert(a.some((x) => x.level === 'info' && /uploaded module/.test(x.message)), 'module-fallback info')
})
test('a complete, on-curriculum forecast has no warnings', () => {
  const days = [{ day: 'Monday', topic: 'Whole Numbers', learningActivities: ['Counting'], expectedStandard: 'Done' }]
  const a = forecastAlerts({ subjectLabel: 'Mathematics', timetableSelected: true, scheduleDays: ['Monday'], periodsPerWeek: 3, topicCatalog: catalog, days })
  assert(!a.some((x) => x.level === 'warn'), 'no warnings on a clean plan')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
