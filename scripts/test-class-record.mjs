#!/usr/bin/env node
/**
 * Tests for the Class Register marking maths: CBC grade bands
 * (src/config/grading.js) + per-learner/record computation
 * (src/utils/classRecordMath.js). Pure logic — no Firebase.
 * Run: npm run test:class-record  (also via npm run test:all)
 */

const { CBC_GRADE_BANDS, PASS_THRESHOLD, gradeLabelForPercent, isPass } =
  await import('../src/config/grading.js')
const { snapshotFromRoster, maxTotalOf, computeRecordRows, computeRecordStats, computeRecord, addLearnerToRecord } =
  await import('../src/utils/classRecordMath.js')

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// ── grade bands ──────────────────────────────────────────────────

console.log('\nCBC grade bands')

test('bands match the server scale (90/75/60/50)', () => {
  eq(gradeLabelForPercent(100), 'Excellent')
  eq(gradeLabelForPercent(90), 'Excellent')
  eq(gradeLabelForPercent(89), 'Very Good')
  eq(gradeLabelForPercent(75), 'Very Good')
  eq(gradeLabelForPercent(60), 'Good')
  eq(gradeLabelForPercent(59), 'Developing')
  eq(gradeLabelForPercent(50), 'Developing')
  eq(gradeLabelForPercent(49), 'Needs Improvement')
  eq(gradeLabelForPercent(0), 'Needs Improvement')
})

test('pass threshold is 50', () => {
  eq(PASS_THRESHOLD, 50)
  eq(isPass(50), true)
  eq(isPass(49), false)
  eq(CBC_GRADE_BANDS.length, 5)
})

test('gradeLabelForPercent tolerates junk', () => {
  eq(gradeLabelForPercent(undefined), 'Needs Improvement')
  eq(gradeLabelForPercent('abc'), 'Needs Improvement')
  eq(gradeLabelForPercent(null), 'Needs Improvement')
})

// ── snapshot ─────────────────────────────────────────────────────

console.log('\nsnapshotFromRoster')

test('freezes only active learners, preserving fields + order', () => {
  const roster = [
    { id: 'a', fullName: 'Mary', learnerNumber: '1', gender: 'F', status: 'active' },
    { id: 'b', fullName: 'John', learnerNumber: '2', gender: 'M', status: 'transferred' },
    { id: 'c', fullName: 'Grace', learnerNumber: '3', gender: 'F', status: 'active' },
  ]
  const snap = snapshotFromRoster(roster)
  eq(snap.length, 2)
  eq(snap[0].rosterId, 'a')
  eq(snap[0].fullName, 'Mary')
  eq(snap[1].rosterId, 'c')
})

// ── record computation ───────────────────────────────────────────

console.log('\ncomputeRecord')

const columns = [
  { key: 'maths', label: 'Maths', max: 50 },
  { key: 'eng', label: 'English', max: 50 },
]
const snapshot = [
  { rosterId: 'a', fullName: 'Mary', learnerNumber: '1' },
  { rosterId: 'b', fullName: 'John', learnerNumber: '2' },
  { rosterId: 'c', fullName: 'Grace', learnerNumber: '3' },
]
const marks = {
  a: { maths: 45, eng: 45 }, // 90 / 100 = 90% Excellent
  b: { maths: 45, eng: 45 }, // tie with Mary
  c: { maths: 20, eng: 20 }, // 40 / 100 = 40% fail
}

test('maxTotalOf sums column maxima', () => {
  eq(maxTotalOf(columns), 100)
})

test('per-learner total, percentage and grade', () => {
  const rows = computeRecordRows({ snapshot, columns, marks })
  const mary = rows.find((r) => r.rosterId === 'a')
  eq(mary.total, 90)
  eq(mary.percentage, 90)
  eq(mary.gradeLabel, 'Excellent')
  const grace = rows.find((r) => r.rosterId === 'c')
  eq(grace.total, 40)
  eq(grace.percentage, 40)
  eq(grace.gradeLabel, 'Needs Improvement')
})

test('dense-ranked positions (ties share a place)', () => {
  const rows = computeRecordRows({ snapshot, columns, marks })
  eq(rows.find((r) => r.rosterId === 'a').position, 1)
  eq(rows.find((r) => r.rosterId === 'b').position, 1)
  eq(rows.find((r) => r.rosterId === 'c').position, 2)
})

test('rows stay in snapshot order regardless of rank', () => {
  const rows = computeRecordRows({ snapshot, columns, marks })
  eq(rows.map((r) => r.rosterId).join(','), 'a,b,c')
})

test('class stats: average, highest, lowest, pass rate', () => {
  const { stats } = computeRecord({ snapshot, columns, marks })
  eq(stats.count, 3)
  eq(stats.highest, 90)
  eq(stats.lowest, 40)
  // percentages 90, 90, 40 → avg 73
  eq(stats.classAverage, 73)
  eq(stats.classAverageMark, 73) // totals 90,90,40 avg 73.3 → 73
  // 2 of 3 at/above 50% → 67
  eq(stats.passRate, 67)
})

test('empty record yields all-zero stats, not NaN', () => {
  const { rows, stats } = computeRecord({ snapshot: [], columns, marks: {} })
  eq(rows.length, 0)
  eq(stats.count, 0)
  eq(stats.classAverage, 0)
  eq(stats.passRate, 0)
  eq(stats.highest, 0)
  assert(!Number.isNaN(stats.lowest), 'lowest should not be NaN')
})

test('missing marks count as zero', () => {
  const { rows } = computeRecord({ snapshot, columns, marks: { a: { maths: 50 } } })
  const mary = rows.find((r) => r.rosterId === 'a')
  eq(mary.total, 50)
  const john = rows.find((r) => r.rosterId === 'b')
  eq(john.total, 0)
})

// ── add learner to existing record (new-learner sync) ────────────

console.log('\naddLearnerToRecord')

test('appends a learner and recomputes stats; old marks untouched', () => {
  const record = {
    columns,
    rosterSnapshot: [...snapshot],
    marks: { ...marks },
  }
  const before = computeRecord({ snapshot: record.rosterSnapshot, columns, marks: record.marks }).stats
  eq(before.count, 3)
  const { rosterSnapshot, stats, changed } = addLearnerToRecord(record, { rosterId: 'd', fullName: 'New Pupil', learnerNumber: '4', gender: 'M' })
  eq(changed, true)
  eq(rosterSnapshot.length, 4)
  eq(stats.count, 4)
  // New learner has no marks → lowest becomes 0, pass rate drops (2 of 4 = 50).
  eq(stats.lowest, 0)
  eq(stats.passRate, 50)
  // Existing marks are unchanged in the snapshot/marks we passed in.
  eq(record.marks.a.maths, 45)
})

test('is idempotent — re-adding the same learner changes nothing', () => {
  const record = { columns, rosterSnapshot: [...snapshot], marks: { ...marks } }
  const { changed } = addLearnerToRecord(record, { rosterId: 'a', fullName: 'Mary', learnerNumber: '1', gender: 'F' })
  eq(changed, false)
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
