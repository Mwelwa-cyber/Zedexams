#!/usr/bin/env node
/**
 * Tests for cross-year SBA matching (src/utils/sbaCrossYear.js): build the
 * per-grade /10 index from a teacher's registers and line up each learner's
 * Grade 5/6/7 marks by account then by name. Pure logic — no Firebase.
 * Run: npm run test:sba-cross-year  (also via npm run test:all)
 */

const { buildCrossYearIndex, matchLearnerMarks, gatherCrossYearSbaMarks } =
  await import('../src/features/register/lib/sbaCrossYear.js')

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
async function testAsync(name, fn) {
  try { await fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// A subject's SBA record at some grade. column max 100 → /10 = total/100*10.
function sbaRecord({ subject = 'english', snapshot, marks }) {
  return { type: 'sba', subject, columns: [{ key: 't', label: 'Task', max: 100 }], rosterSnapshot: snapshot, marks }
}

// Mary appears in G5 (by name) and G6 (by account uid). John only in G5.
const g5 = {
  grade: '5',
  sbaRecords: [sbaRecord({
    snapshot: [
      { rosterId: 'm5', fullName: 'Mary Banda', linkedUid: null },
      { rosterId: 'j5', fullName: 'John Phiri', linkedUid: null },
    ],
    marks: { m5: { t: 80 }, j5: { t: 50 } }, // Mary 8/10, John 5/10
  })],
}
const g6 = {
  grade: '6',
  sbaRecords: [sbaRecord({
    snapshot: [{ rosterId: 'm6', fullName: 'MARY  BANDA', linkedUid: 'uid-mary' }],
    marks: { m6: { t: 90 } }, // Mary 9/10
  })],
}
const g7 = {
  grade: '7',
  sbaRecords: [sbaRecord({
    snapshot: [{ rosterId: 'm7', fullName: 'Mary Banda', linkedUid: 'uid-mary' }],
    marks: { m7: { t: 100 } }, // Mary 10/10
  })],
}

console.log('\nbuildCrossYearIndex + matchLearnerMarks')

test('indexes /10 per grade by name and uid', () => {
  const index = buildCrossYearIndex([g5, g6, g7], 'english')
  eq(index[5].get('name:mary banda'), 8)
  eq(index[6].get('uid:uid-mary'), 9)
  eq(index[6].get('name:mary banda'), 9)
  eq(index[7].get('uid:uid-mary'), 10)
})

test('only matches the requested subject', () => {
  const index = buildCrossYearIndex([g5], 'mathematics')
  eq(index[5].size, 0)
})

test('lines up a learner across grades (account preferred, name fallback)', () => {
  const index = buildCrossYearIndex([g5, g6, g7], 'english')
  // Current Grade 7 roster entry for Mary, account-linked.
  const out = matchLearnerMarks(index, [{ id: 'cur-mary', fullName: 'Mary Banda', linkedUid: 'uid-mary' }])
  eq(out['cur-mary'].g5, 8) // matched by name (no uid in G5)
  eq(out['cur-mary'].g6, 9) // matched by uid
  eq(out['cur-mary'].g7, 10)
})

test('a learner with no prior records is omitted', () => {
  const index = buildCrossYearIndex([g5, g6, g7], 'english')
  const out = matchLearnerMarks(index, [{ id: 'x', fullName: 'Nobody Here', linkedUid: null }])
  eq(out.x, undefined)
})

test('John matches only Grade 5', () => {
  const index = buildCrossYearIndex([g5, g6, g7], 'english')
  const out = matchLearnerMarks(index, [{ id: 'cur-john', fullName: 'John Phiri', linkedUid: null }])
  eq(out['cur-john'].g5, 5)
  eq(out['cur-john'].g6, undefined)
})

test('keeps the best /10 when a learner has duplicate grade records', () => {
  const dupG5 = {
    grade: '5',
    sbaRecords: [
      sbaRecord({ snapshot: [{ rosterId: 'a', fullName: 'Mary Banda' }], marks: { a: { t: 60 } } }),
      sbaRecord({ snapshot: [{ rosterId: 'b', fullName: 'Mary Banda' }], marks: { b: { t: 80 } } }),
    ],
  }
  const index = buildCrossYearIndex([dupG5], 'english')
  eq(index[5].get('name:mary banda'), 8) // 80/100 beats 60/100
})

await testAsync('gatherCrossYearSbaMarks wires the services + filters grades', async () => {
  const deps = {
    listTeacherRegisters: async () => ([
      { id: 'r5', grade: '5' }, { id: 'r6', grade: '6' }, { id: 'r3', grade: '3' },
    ]),
    listRecords: async (regId) => {
      if (regId === 'r5') return g5.sbaRecords
      if (regId === 'r6') return g6.sbaRecords
      return [] // grade 3 is skipped before this is called
    },
  }
  const out = await gatherCrossYearSbaMarks('teacher-1', 'english', [{ id: 'cur', fullName: 'Mary Banda', linkedUid: 'uid-mary' }], deps)
  eq(out.cur.g5, 8)
  eq(out.cur.g6, 9)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
