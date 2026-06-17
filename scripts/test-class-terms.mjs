#!/usr/bin/env node
/**
 * Tests for the Class Register term/year period helpers
 * (src/utils/classTerms.js). Pure logic — no Firebase.
 * Run: npm run test:class-terms  (also via npm run test:all)
 */

const {
  TERMS, periodKey, parsePeriodKey, samePeriod, formatPeriod,
  nextPeriod, periodsFromRecords, recordMatchesPeriod, filterRecordsByPeriod,
} = await import('../src/utils/classTerms.js')

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

console.log('\nperiod keys + equality')

test('periodKey / parsePeriodKey round-trip', () => {
  const p = { term: 'Term 2', year: 2026 }
  eq(periodKey(p), 'Term 2|2026')
  const back = parsePeriodKey('Term 2|2026')
  eq(back.term, 'Term 2')
  eq(back.year, 2026)
})

test('samePeriod compares term + year numerically', () => {
  eq(samePeriod({ term: 'Term 1', year: 2026 }, { term: 'Term 1', year: '2026' }), true)
  eq(samePeriod({ term: 'Term 1', year: 2026 }, { term: 'Term 2', year: 2026 }), false)
  eq(samePeriod({ term: 'Term 1', year: 2026 }, { term: 'Term 1', year: 2025 }), false)
})

test('formatPeriod is readable and tolerant', () => {
  eq(formatPeriod({ term: 'Term 2', year: 2026 }), 'Term 2 · 2026')
  eq(formatPeriod({ term: '', year: '' }), 'No term set')
  eq(formatPeriod({ term: 'Term 1', year: null }), 'Term 1')
})

console.log('\nnextPeriod')

test('advances Term 1 → 2 → 3 within the year', () => {
  eq(nextPeriod({ term: 'Term 1', year: 2026 }).term, 'Term 2')
  eq(nextPeriod({ term: 'Term 2', year: 2026 }).term, 'Term 3')
})

test('rolls Term 3 over to Term 1 of the next year', () => {
  const np = nextPeriod({ term: 'Term 3', year: 2026 })
  eq(np.term, 'Term 1')
  eq(np.year, 2027)
})

test('blank term resets to Term 1', () => {
  eq(nextPeriod({ term: '', year: 2026 }).term, 'Term 1')
  eq(TERMS.length, 3)
})

console.log('\nperiodsFromRecords + filtering')

const records = [
  { id: 'a', term: 'Term 1', year: 2026 },
  { id: 'b', term: 'Term 1', year: 2026 },
  { id: 'c', term: 'Term 2', year: 2026 },
  { id: 'd', term: 'Term 3', year: 2025 },
]

test('collects distinct periods newest-first', () => {
  const periods = periodsFromRecords(records)
  eq(periods.length, 3)
  eq(periods[0].year, 2026)
  eq(periods[0].term, 'Term 2') // 2026 Term 2 before 2026 Term 1
  eq(periods[2].year, 2025)
})

test('recordMatchesPeriod matches term + year', () => {
  eq(recordMatchesPeriod(records[0], { term: 'Term 1', year: 2026 }), true)
  eq(recordMatchesPeriod(records[0], { term: 'Term 1', year: '2026' }), true)
  eq(recordMatchesPeriod(records[2], { term: 'Term 1', year: 2026 }), false)
})

test("filter 'current' keeps only the current period", () => {
  const out = filterRecordsByPeriod(records, 'current', { term: 'Term 1', year: 2026 })
  eq(out.length, 2)
  eq(out.every((r) => r.term === 'Term 1'), true)
})

test("filter 'all' keeps everything", () => {
  eq(filterRecordsByPeriod(records, 'all', { term: 'Term 1', year: 2026 }).length, 4)
})

test('filter by an explicit period key', () => {
  const out = filterRecordsByPeriod(records, 'Term 3|2025', { term: 'Term 1', year: 2026 })
  eq(out.length, 1)
  eq(out[0].id, 'd')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
