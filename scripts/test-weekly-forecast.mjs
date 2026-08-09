#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Weekly Forecast studio's scheme→forecast mapper
 * (src/shared/utils/weeklyForecast.js): both saved-scheme shapes (the app
 * generator's schema and the new official 9-column shape), day
 * splitting, and clamping.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:weekly-forecast   (also via npm run test:all)
 */
import {
  schemeWeeks,
  weekNumberOf,
  isOfficialSchemeWeek,
  isOfficialScheme,
  normalizeSchemeWeek,
  buildForecastDays,
} from '../src/shared/utils/weeklyForecast.js'

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// The app generator's saved shape (what real teachers have in their libraries).
const OLD_WEEK = {
  weekNumber: 3,
  topic: 'Phonics & Word Study',
  subtopics: ['Letter sounds', 'Two-letter blends'],
  specificOutcomes: ['Sound out all single letters correctly', 'Blend two-letter clusters'],
  keyCompetencies: ['Communication'],
  values: ['Confidence'],
  teachingLearningActivities: ['Flashcard drill', 'Sound walk', 'Blending race'],
  materials: ['Letter flashcards', 'Chalkboard'],
  assessment: 'Oral check: each learner sounds out five letters.',
  references: "Pupil's Book pp. 2-5",
}

// The new official 9-column shape (the /teachers sample + future generator).
const NEW_WEEK = {
  week: '1',
  topic: '4.1 THE HUMAN BODY',
  subtopic: '4.1.1 The Respiratory System',
  specificCompetences: ['4.1.1.1 Demonstrate understanding of the respiratory system'],
  learningActivities: ['Describing the respiratory system', 'Drawing the respiratory system'],
  expectedStandard: 'Understanding of the respiratory system demonstrated satisfactorily',
  methods: ['Exposition', 'Q & A'],
  tlAids: ['Charts', 'Models', 'Science Module'],
  references: 'Grade 4 Science Syllabus p.1',
}

console.log('\nshape detection + normalisation')
test('old app-schema week flattens to forecast fields', () => {
  const n = normalizeSchemeWeek(OLD_WEEK)
  assert(n.weekNumber === 3, 'weekNumber from weekNumber field')
  assert(n.subtopic === 'Letter sounds, Two-letter blends', `subtopics joined (got: ${n.subtopic})`)
  assert(n.specificCompetence.includes('Sound out') && n.specificCompetence.includes('; '), 'outcomes joined with semicolons')
  assert(n.learningActivities.length === 3, 'activities carried over')
  assert(n.expectedStandard.startsWith('Oral check'), 'old schema uses the assessment sentence as the expected standard')
  assert(n.resources.join() === 'Letter flashcards,Chalkboard', 'materials become resources')
})
test('new 9-column week maps field-for-field', () => {
  const n = normalizeSchemeWeek(NEW_WEEK)
  assert(n.weekNumber === 1, 'weekNumber from week field')
  assert(n.subtopic === '4.1.1 The Respiratory System', 'subtopic verbatim')
  assert(n.specificCompetence === '4.1.1.1 Demonstrate understanding of the respiratory system', 'single competence not double-joined')
  assert(n.expectedStandard.includes('satisfactorily'), 'expectedStandard verbatim')
  assert(n.resources.length === 3 && n.resources[0] === 'Charts', 'tlAids become resources')
})
test('normalizeSchemeWeek tolerates junk', () => {
  assert(normalizeSchemeWeek(null) === null, 'null in, null out')
  const n = normalizeSchemeWeek({ topic: 'X' })
  assert(n.topic === 'X' && n.learningActivities.length === 0 && n.weekNumber === null, 'missing fields default empty')
})

console.log('\nweek listing')
test('schemeWeeks + weekNumberOf read either shape', () => {
  assert(schemeWeeks({ weeks: [OLD_WEEK, NEW_WEEK] }).length === 2, 'weeks array surfaced')
  assert(schemeWeeks({}).length === 0 && schemeWeeks(null).length === 0, 'no weeks → empty array')
  assert(weekNumberOf(OLD_WEEK) === 3 && weekNumberOf(NEW_WEEK) === 1, 'week numbers from both shapes')
})

console.log('\nofficial-format detection (shared by SchemeOfWorkView + DOCX export)')
test('isOfficialSchemeWeek tells the two week shapes apart', () => {
  assert(isOfficialSchemeWeek(NEW_WEEK) === true, '9-column week detected')
  assert(isOfficialSchemeWeek(OLD_WEEK) === false, 'app-schema week is not official-shape')
  assert(isOfficialSchemeWeek(null) === false, 'null is not official-shape')
})
test('isOfficialScheme reads schemaVersion fast-paths and falls back to sniffing', () => {
  assert(isOfficialScheme({ schemaVersion: '2.0', weeks: [] }) === true, 'v2 generator output')
  assert(isOfficialScheme({ schemaVersion: 'sow-table-1.0', weeks: [NEW_WEEK] }) === true, 'marketing sample version')
  assert(isOfficialScheme({ schemaVersion: '1.0', weeks: [OLD_WEEK] }) === false, 'v1 generator output stays legacy')
  assert(isOfficialScheme({ weeks: [NEW_WEEK] }) === true, 'unversioned new-shape sniffed from first week')
  assert(isOfficialScheme({ weeks: [OLD_WEEK] }) === false, 'unversioned old-shape sniffed from first week')
  assert(isOfficialScheme(null) === false && isOfficialScheme({}) === false, 'junk is not official')
})

console.log('\nday splitting')
test('buildForecastDays repeats the week per day with blank remarks', () => {
  const days = buildForecastDays(NEW_WEEK, 3)
  assert(days.length === 3, 'three teaching days')
  assert(days.every((d) => d.topic === NEW_WEEK.topic), 'topic repeated per day, like the printed forecast')
  assert(days.every((d) => d.remarks === ''), 'remarks start blank for the teacher')
  assert(days.map((d) => d.day).join(',') === '1,2,3', 'days numbered 1..n')
})
test('each day is independently editable (no shared array references)', () => {
  const days = buildForecastDays(OLD_WEEK, 2)
  days[0].learningActivities.push('Extra revision drill')
  assert(days[1].learningActivities.length === 3, 'editing day 1 does not leak into day 2')
})
test('day count clamps to 1..5', () => {
  assert(buildForecastDays(NEW_WEEK, 0).length === 1, 'minimum one day')
  assert(buildForecastDays(NEW_WEEK, 9).length === 5, 'maximum five days')
  assert(buildForecastDays(NEW_WEEK, 'x').length === 3, 'garbage defaults to 3')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
