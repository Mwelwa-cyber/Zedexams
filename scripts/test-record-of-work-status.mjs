#!/usr/bin/env node
/**
 * Tests for Record of Work planned-vs-actual comparison states (pure).
 * Run: npm run test:record-of-work-status
 */
import {
  currentWeekForRecord,
  weekComparisonStatus,
  recordAttentionSummary,
  oldestDueIncompleteWeek,
  termCoverageSummary,
  WEEK_STATUS_META,
} from '../src/utils/recordOfWorkStatus.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const NOW = { year: 2026, termNumber: 2, weekNumber: 8 }

console.log('\ncurrentWeekForRecord')
test('current term + year → the live week number', () => {
  eq(currentWeekForRecord({ term: 2, year: '2026' }, NOW), 8)
})
test('a past term is fully due; a future term not yet due', () => {
  eq(currentWeekForRecord({ term: 1, year: '2026' }, NOW), Infinity)
  eq(currentWeekForRecord({ term: 3, year: '2026' }, NOW), 0)
})
test('a past year is fully due; a future year not yet due', () => {
  eq(currentWeekForRecord({ term: 3, year: '2025' }, NOW), Infinity)
  eq(currentWeekForRecord({ term: 1, year: '2027' }, NOW), 0)
})
test('no calendar context → null (no date-derived states, never Week 1)', () => {
  eq(currentWeekForRecord({ term: 2, year: '2026' }, null), null)
  eq(currentWeekForRecord({ term: '', year: '' }, NOW), null)
})

console.log('\nweekComparisonStatus — recorded coverage always wins')
test('full / partial / none map to their states regardless of date', () => {
  eq(weekComparisonStatus({ week: '2', coverage: 'full' }, 8), 'completed')
  eq(weekComparisonStatus({ week: '12', coverage: 'full' }, 8), 'completed') // future week, teacher recorded anyway
  eq(weekComparisonStatus({ week: '2', coverage: 'partial' }, 8), 'partial')
  eq(weekComparisonStatus({ week: '2', coverage: 'none' }, 8), 'not-covered')
})
test('a planned topic alone never marks a week taught', () => {
  eq(weekComparisonStatus({ week: '2', topic: 'Fractions', coverage: '' }, 8), 'overdue')
})

console.log('\nweekComparisonStatus — date-derived (nothing recorded)')
test('past → overdue, current → due, future → not yet due', () => {
  eq(weekComparisonStatus({ week: '7', coverage: '' }, 8), 'overdue')
  eq(weekComparisonStatus({ week: '8', coverage: '' }, 8), 'due')
  eq(weekComparisonStatus({ week: '9', coverage: '' }, 8), 'future')
})
test('no calendar context → pending (never guessed due/overdue)', () => {
  eq(weekComparisonStatus({ week: '3', coverage: '' }, null), 'pending')
})
test('a non-numeric week number → pending', () => {
  eq(weekComparisonStatus({ week: 'abc', coverage: '' }, 8), 'pending')
})
test('past-term record: every unrecorded week reads overdue', () => {
  eq(weekComparisonStatus({ week: '13', coverage: '' }, Infinity), 'overdue')
})
test('future-term record: every unrecorded week reads not-yet-due', () => {
  eq(weekComparisonStatus({ week: '1', coverage: '' }, 0), 'future')
})

console.log('\nindicators')
test('every state has a text label + icon (never colour alone)', () => {
  for (const s of ['completed', 'partial', 'not-covered', 'due', 'overdue', 'future', 'pending']) {
    assert(WEEK_STATUS_META[s]?.icon && WEEK_STATUS_META[s]?.label, `missing meta for ${s}`)
  }
})

console.log('\noldestDueIncompleteWeek (deep-link target)')
test('targets the OLDEST unrecorded due week, not today', () => {
  const weeks = [
    { week: '6', coverage: '' },        // overdue — oldest
    { week: '7', coverage: '' },        // overdue
    { week: '8', coverage: '' },        // due (current)
  ]
  eq(oldestDueIncompleteWeek(weeks, 8), 6)
})
test('recorded weeks (full/partial/none) are never targeted', () => {
  const weeks = [
    { week: '5', coverage: 'full' },
    { week: '6', coverage: 'partial' },
    { week: '7', coverage: 'none' },
    { week: '8', coverage: '' },
  ]
  eq(oldestDueIncompleteWeek(weeks, 8), 8)
})
test('current week is the target when it is the only unresolved entry', () => {
  eq(oldestDueIncompleteWeek([{ week: '8', coverage: '' }], 8), 8)
})
test('future weeks are excluded; fully recorded → null', () => {
  eq(oldestDueIncompleteWeek([{ week: '9', coverage: '' }, { week: '10', coverage: '' }], 8), null)
  eq(oldestDueIncompleteWeek([{ week: '7', coverage: 'full' }, { week: '8', coverage: 'partial' }], 8), null)
})
test('no calendar context → null (no guessed deep-link)', () => {
  eq(oldestDueIncompleteWeek([{ week: '3', coverage: '' }], null), null)
})

console.log('\ntermCoverageSummary (dashboard rollup)')
test('counts covered / partial / behind over due weeks with planned work', () => {
  const weeks = [
    { week: '1', topic: 'A', coverage: 'full' },
    { week: '2', topic: 'B', coverage: 'full' },
    { week: '3', topic: 'C', coverage: 'partial' },
    { week: '4', topic: 'D', coverage: 'none' },    // behind (recorded not covered)
    { week: '5', topic: 'E', coverage: '' },        // behind (due, unrecorded)
    { week: '6', topic: '', coverage: '' },         // due, nothing planned → excluded
    { week: '9', topic: 'F', coverage: '' },        // future → excluded, counted separately
  ]
  const s = termCoverageSummary(weeks, 8)
  eq(s.due, 5)
  eq(s.covered, 2)
  eq(s.partial, 1)
  eq(s.behind, 2)
  eq(s.future, 1)
  eq(s.percent, 40)
})
test('a recorded week without a planned topic still counts (teacher taught it)', () => {
  const s = termCoverageSummary([{ week: '2', topic: '', coverage: 'full' }], 8)
  eq(s.due, 1); eq(s.covered, 1); eq(s.percent, 100)
})
test('future weeks are never counted as missed', () => {
  eq(termCoverageSummary([{ week: '9', topic: 'X', coverage: '' }], 8), null)
})
test('completion is never inferred — a planned topic alone reads behind, not covered', () => {
  const s = termCoverageSummary([{ week: '2', topic: 'Planned only', coverage: '' }], 8)
  eq(s.behind, 1); eq(s.covered, 0)
})
test('no calendar context → null (never a guessed 0%)', () => {
  eq(termCoverageSummary([{ week: '1', topic: 'A', coverage: 'full' }], null), null)
})
test('nothing due yet → null', () => {
  eq(termCoverageSummary([], 8), null)
})

console.log('\nrecordAttentionSummary')
test('counts overdue + partial weeks', () => {
  const weeks = [
    { week: '6', coverage: '' },        // overdue
    { week: '7', coverage: 'partial' }, // partial
    { week: '8', coverage: '' },        // due — not flagged
    { week: '9', coverage: '' },        // future — not flagged
    { week: '5', coverage: 'full' },    // completed — not flagged
  ]
  eq(recordAttentionSummary(weeks, 8), '1 past week not recorded yet · 1 partially covered')
})
test('nothing to flag → empty string; no calendar → empty string', () => {
  eq(recordAttentionSummary([{ week: '8', coverage: 'full' }], 8), '')
  eq(recordAttentionSummary([{ week: '2', coverage: '' }], null), '')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
