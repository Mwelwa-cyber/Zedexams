#!/usr/bin/env node
/**
 * Tests for the admin generations summary reducer — specifically that a
 * failed generation drops out of the "Needs attention" count once an admin
 * marks it resolved. Run: npm run test:generations-summary
 */

const { isUnresolvedFailure, summarizeGenerationRows } =
  await import('../src/utils/generationsSummary.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
  } catch (err) {
    fail++
    failures.push(`${name}: ${err.message}`)
  }
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

test('isUnresolvedFailure: a fresh failed run needs attention', () => {
  eq(isUnresolvedFailure({ status: 'failed' }), true)
})

test('isUnresolvedFailure: a resolved failed run does not', () => {
  eq(isUnresolvedFailure({ status: 'failed', adminResolved: true }), false)
})

test('isUnresolvedFailure: non-failures never count', () => {
  eq(isUnresolvedFailure({ status: 'complete' }), false)
  eq(isUnresolvedFailure({ status: 'flagged' }), false)
  eq(isUnresolvedFailure(null), false)
  eq(isUnresolvedFailure(undefined), false)
})

test('summary: counts only unresolved failures', () => {
  const rows = [
    { status: 'complete', tool: 'lesson_plan' },
    { status: 'failed', tool: 'worksheet' },
    { status: 'failed', tool: 'rubric', adminResolved: true },
    { status: 'failed', tool: 'flashcards' },
  ]
  const s = summarizeGenerationRows(rows)
  eq(s.total, 4, 'total')
  eq(s.failed, 2, 'failed (resolved one excluded)')
})

test('summary: resolving the last failure clears the count', () => {
  const before = summarizeGenerationRows([{ status: 'failed', tool: 'worksheet' }])
  eq(before.failed, 1, 'before')
  const after = summarizeGenerationRows([{ status: 'failed', tool: 'worksheet', adminResolved: true }])
  eq(after.failed, 0, 'after resolve')
})

test('summary: flagged counts via status or visibility, independent of resolve', () => {
  const s = summarizeGenerationRows([
    { status: 'flagged', tool: 'worksheet' },
    { status: 'complete', tool: 'rubric', visibility: 'flagged_for_review' },
    { status: 'failed', tool: 'notes', adminResolved: true },
  ])
  eq(s.flagged, 2, 'flagged')
  eq(s.failed, 0, 'failed')
})

test('summary: cost is summed and formatted to 2dp', () => {
  const s = summarizeGenerationRows([
    { status: 'complete', tool: 'lesson_plan', costUsdCents: 125 },
    { status: 'complete', tool: 'worksheet', costUsdCents: 75 },
  ])
  eq(s.totalCostUsd, '2.00', 'totalCostUsd')
})

test('summary: empty input is safe', () => {
  const s = summarizeGenerationRows()
  eq(s.total, 0)
  eq(s.failed, 0)
  eq(s.totalCostUsd, '0.00')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
