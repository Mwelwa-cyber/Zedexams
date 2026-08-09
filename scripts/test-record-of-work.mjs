#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Record of Work studio's scheme→record mapper
 * (src/shared/utils/recordOfWork.js): both saved-scheme shapes, the work-done
 * prefill, coverage labels / printed remarks, and the coverage summary.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:record-of-work   (also via npm run test:all)
 */
import {
  COVERAGE_OPTIONS,
  coverageLabel,
  blankRecordWeek,
  workDonePrefill,
  buildRecordWeeks,
  printedRemark,
  coverageSummary,
} from '../src/shared/utils/recordOfWork.js'
import { normalizeSchemeWeek } from '../src/shared/utils/weeklyForecast.js'

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
  specificOutcomes: ['Sound out all single letters correctly'],
  teachingLearningActivities: ['Flashcard drill', 'Sound walk', 'Blending race'],
  materials: ['Letter flashcards', 'Chalkboard'],
  assessment: 'Oral check: each learner sounds out five letters.',
  references: "Pupil's Book pp. 2-5",
}

// The new official 9-column shape (the v2 generator + /teachers sample).
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

// A week with no activities at all — prefill must fall back to the competence.
const SPARSE_WEEK = {
  week: '2',
  topic: 'Revision',
  subtopic: '',
  specificCompetences: ['Consolidate term 1 number work'],
  learningActivities: [],
  expectedStandard: '',
  tlAids: [],
}

console.log('\nwork-done prefill')
test('activities seed the work-done log', () => {
  const lines = workDonePrefill(normalizeSchemeWeek(NEW_WEEK))
  assert(lines.length === 2, 'both activities carried over')
  assert(lines[0] === 'Describing the respiratory system', 'activities verbatim')
})
test('weeks without activities fall back to the specific competence', () => {
  const lines = workDonePrefill(normalizeSchemeWeek(SPARSE_WEEK))
  assert(lines.length === 1, 'one fallback line')
  assert(lines[0] === 'Consolidate term 1 number work', 'competence used as the work-done seed')
})
test('junk in, empty log out', () => {
  assert(workDonePrefill(null).length === 0, 'null normalised week')
  assert(workDonePrefill(normalizeSchemeWeek({ topic: 'X' })).length === 0, 'no activities, no competence')
})

console.log('\nterm derivation from a saved scheme')
test('every scheme week becomes a record row (official shape)', () => {
  const rows = buildRecordWeeks({ schemaVersion: '2.0', weeks: [NEW_WEEK, SPARSE_WEEK] })
  assert(rows.length === 2, 'one row per scheme week')
  assert(rows[0].week === '1' && rows[1].week === '2', 'week numbers carried over')
  assert(rows[0].topic === '4.1 THE HUMAN BODY', 'topic carried over')
  assert(rows[0].subtopic === '4.1.1 The Respiratory System', 'subtopic carried over')
  assert(rows[0].workDone.length === 2, 'work done prefilled from activities')
  assert(rows.every((r) => r.coverage === '' && r.remarks === '' && r.weekEnding === ''), 'coverage, remarks and dates start blank for the teacher')
})
test('legacy app-schema weeks map too', () => {
  const rows = buildRecordWeeks({ schemaVersion: '1.0', weeks: [OLD_WEEK] })
  assert(rows.length === 1, 'one row')
  assert(rows[0].week === '3', 'weekNumber field read')
  assert(rows[0].subtopic === 'Letter sounds, Two-letter blends', 'subtopics joined')
  assert(rows[0].workDone.join('|') === 'Flashcard drill|Sound walk|Blending race', 'activities seed work done')
})
test('rows are independent copies (no shared array references)', () => {
  const rows = buildRecordWeeks({ weeks: [NEW_WEEK, NEW_WEEK] })
  rows[0].workDone.push('Extra revision drill')
  assert(rows[1].workDone.length === 2, 'editing week 1 does not leak into week 2')
})
test('weeks without numbers fall back to their position', () => {
  const rows = buildRecordWeeks({ weeks: [{ topic: 'A' }, { topic: 'B' }] })
  assert(rows[0].week === '1' && rows[1].week === '2', 'positional week numbers')
})
test('junk schemes derive to nothing', () => {
  assert(buildRecordWeeks(null).length === 0, 'null scheme')
  assert(buildRecordWeeks({}).length === 0, 'no weeks array')
})

console.log('\ncoverage + printed remarks')
test('coverage labels resolve and junk stays blank', () => {
  assert(coverageLabel('full') === 'Fully covered', 'full')
  assert(coverageLabel('partial') === 'Partially covered', 'partial')
  assert(coverageLabel('none') === 'Not covered', 'none')
  assert(coverageLabel('') === '' && coverageLabel('xyz') === '', 'blank/junk → empty')
  assert(COVERAGE_OPTIONS.some((o) => o.value === '' ), 'blank option offered for not-yet-logged weeks')
})
test('printedRemark joins coverage and the teacher remark', () => {
  assert(printedRemark({ coverage: 'partial', remarks: 're-teach carrying tens' }) === 'Partially covered — re-teach carrying tens', 'label — remark')
  assert(printedRemark({ coverage: 'full', remarks: '' }) === 'Fully covered', 'label alone')
  assert(printedRemark({ coverage: '', remarks: 'absent: sports day' }) === 'absent: sports day', 'remark alone')
  // Signed-off print addition: a recorded follow-up closes the REMARKS cell.
  assert(
    printedRemark({ coverage: 'partial', remarks: 're-teach carrying tens', variance: { followUp: 'complete next lesson' } }) ===
      'Partially covered — re-teach carrying tens · Follow-up: complete next lesson',
    'follow-up appended',
  )
  assert(printedRemark({ coverage: '', remarks: '', variance: { followUp: 'finish exercise' } }) === 'Follow-up: finish exercise', 'follow-up alone')
  assert(
    printedRemark({ coverage: 'full', remarks: '', variance: { reason: 'digital only', actualDate: '2026-07-14', initials: 'MM' } }) === 'Fully covered',
    'other variance fields never print',
  )
  assert(printedRemark({}) === '' && printedRemark(null) === '', 'nothing → empty')
})

console.log('\ncoverage summary')
test('summary counts every state', () => {
  const s = coverageSummary([
    { coverage: 'full' }, { coverage: 'full' }, { coverage: 'partial' },
    { coverage: 'none' }, { coverage: '' }, {},
  ])
  assert(s.full === 2 && s.partial === 1 && s.none === 1, 'full/partial/none tallied')
  assert(s.blank === 2 && s.total === 6, 'blank rows counted toward the total')
})
test('summary tolerates junk', () => {
  const s = coverageSummary(null)
  assert(s.total === 0 && s.blank === 0, 'null rows → zeroed summary')
})

console.log('\nblank row')
test('blankRecordWeek produces an empty editable row', () => {
  const row = blankRecordWeek(7)
  assert(row.week === '7', 'week stringified')
  assert(row.workDone.length === 0 && row.coverage === '' && row.remarks === '', 'all fields start blank')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
