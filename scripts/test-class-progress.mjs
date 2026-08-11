#!/usr/bin/env node
/**
 * Tests for the Class Register progress aggregator (src/utils/classProgress.js).
 * Pure logic — no Firebase.
 * Run: npm run test:class-progress  (also via npm run test:all)
 */

const { buildClassProgress, overallGrade } = await import('../src/features/register/lib/classProgress.js')

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const cols = [{ key: 't', label: 'Test', max: 100 }]
// listRecords returns newest-first; buildClassProgress should re-order to oldest→newest.
const records = [
  {
    id: 'r2', title: 'Term 1 Exam', term: 'Term 1', type: 'assessment',
    columns: cols,
    rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary' }, { rosterId: 'b', fullName: 'John' }],
    marks: { a: { t: 80 }, b: { t: 40 } },
  },
  {
    id: 'r1', title: 'Term 1 Test', term: 'Term 1', type: 'mark_schedule',
    columns: cols,
    rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary' }, { rosterId: 'b', fullName: 'John' }],
    marks: { a: { t: 60 }, b: { t: 50 } },
  },
  {
    id: 'r0', title: 'Empty', term: 'Term 1', type: 'mark_schedule',
    columns: cols,
    rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary' }],
    marks: {},
  },
]

console.log('\nbuildClassProgress')

test('drops unmarked records', () => {
  const prog = buildClassProgress(records)
  eq(prog.records.length, 2)
  eq(prog.records.some((r) => r.id === 'r0'), false)
})

test('orders records oldest → newest', () => {
  const prog = buildClassProgress(records)
  eq(prog.records[0].id, 'r1')
  eq(prog.records[1].id, 'r2')
})

test('lists learners sorted by name', () => {
  const prog = buildClassProgress(records)
  eq(prog.learners.map((l) => l.fullName).join(','), 'John,Mary')
})

test('fills per-learner per-record percentages', () => {
  const prog = buildClassProgress(records)
  eq(prog.cells.a.r1.percentage, 60)
  eq(prog.cells.a.r2.percentage, 80)
  eq(prog.cells.b.r1.percentage, 50)
  eq(prog.cells.b.r2.percentage, 40)
})

test('computes per-learner averages', () => {
  const prog = buildClassProgress(records)
  eq(prog.averages.a, 70) // (60+80)/2
  eq(prog.averages.b, 45) // (50+40)/2
})

test('computes class average per record', () => {
  const prog = buildClassProgress(records)
  const r1 = prog.records.find((r) => r.id === 'r1')
  const r2 = prog.records.find((r) => r.id === 'r2')
  eq(r1.classAverage, 55) // (60+50)/2
  eq(r2.classAverage, 60) // (80+40)/2
})

test('overallGrade maps an average to a CBC label', () => {
  eq(overallGrade(70), 'Good')
  eq(overallGrade(45), 'Needs Improvement')
})

test('handles no records', () => {
  const prog = buildClassProgress([])
  eq(prog.records.length, 0)
  eq(prog.learners.length, 0)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
