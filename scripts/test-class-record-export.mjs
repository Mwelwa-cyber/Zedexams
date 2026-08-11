#!/usr/bin/env node
/**
 * Tests for the Class Register export adapter (src/utils/classRecordExport.js):
 * SBA records export their ECZ /10 mark; other records export raw columns.
 * Pure logic — no Firebase, no DOM.
 * Run: npm run test:class-record-export  (also via npm run test:all)
 */

const { recordToSchedule } = await import('../src/features/register/lib/classRecordExport.js')

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const register = { school: 'Test Basic', grade: '7', term: 'Term 1', year: 2026 }

console.log('\nSBA records → /10 results sheet')

const sbaRecord = {
  type: 'sba', term: '', year: 2026,
  columns: [
    { key: 't1', label: 'T1 Composition', max: 100 },
    { key: 't2', label: 'T2 Composition', max: 100 },
  ], // total 200
  rosterSnapshot: [
    { rosterId: 'a', fullName: 'Mary Banda' },
    { rosterId: 'b', fullName: 'John Phiri' },
  ],
  marks: {
    a: { t1: 90, t2: 90 }, // 180/200 → 9/10
    b: { t1: 50, t2: 50 }, // 100/200 → 5/10
  },
}

test('uses a single SBA Mark /10 column', () => {
  const s = recordToSchedule(sbaRecord, register)
  eq(s.subjects.length, 1)
  eq(s.subjects[0].label, 'SBA Mark')
  eq(s.subjects[0].max, 10)
})

test('converts each learner total to /10', () => {
  const s = recordToSchedule(sbaRecord, register)
  const mary = s.pupils.find((p) => p.name === 'Mary Banda')
  const john = s.pupils.find((p) => p.name === 'John Phiri')
  eq(mary.marks.sba10, 9)
  eq(john.marks.sba10, 5)
})

test('ranks by the /10 mark', () => {
  const s = recordToSchedule(sbaRecord, register)
  eq(s.pupils.find((p) => p.name === 'Mary Banda').position, 1)
  eq(s.pupils.find((p) => p.name === 'John Phiri').position, 2)
})

console.log('\nnon-SBA records → raw columns')

const markRecord = {
  type: 'mark_schedule', term: 'Term 1', year: 2026,
  columns: [{ key: 'maths', label: 'Maths', max: 50 }],
  rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary Banda' }],
  marks: { a: { maths: 45 } },
}

test('keeps the raw mark columns', () => {
  const s = recordToSchedule(markRecord, register)
  eq(s.subjects.length, 1)
  eq(s.subjects[0].label, 'Maths')
  eq(s.subjects[0].max, 50)
  eq(s.pupils[0].marks.maths, 45)
  eq(s.pupils[0].total, 45)
})

test('header pulls school/grade/term/year', () => {
  const s = recordToSchedule(markRecord, register)
  eq(s.header.school, 'Test Basic')
  eq(s.header.grade, '7')
  eq(s.header.term, 'Term 1')
  eq(s.header.year, 2026)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
