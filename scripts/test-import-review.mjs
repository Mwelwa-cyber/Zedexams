#!/usr/bin/env node
/**
 * Tests for src/utils/importReviewCore.js — the compulsory review a teacher
 * does before any imported learner reaches a class list.
 * Pure logic; no Firebase, no DOM.
 * Run: npm run test:import-review  (also via npm run test:all)
 */

const {
  classifyReviewRow,
  buildImportReview,
  filterReviewRows,
  applyRowEdit,
  planImport,
  importConfirmationText,
  LOW_CONFIDENCE_THRESHOLD,
} = await import('../src/utils/importReviewCore.js')

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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const complete = (over = {}) => ({
  fullName: 'Alex Lobela', admissionNumber: 'ADM-001', gender: 'M', confidence: 0.99, ...over,
})

// ── one row ──────────────────────────────────────────────────────

console.log('\nclassifying one row')

test('a complete, confidently-read row is ready', () => {
  const c = classifyReviewRow(complete())
  eq(c.bucket, 'ready')
  eq(c.reasons.length, 0)
  eq(c.blocking, false)
})

test('a missing admission number is a question, not a blocker', () => {
  const c = classifyReviewRow(complete({ admissionNumber: null }))
  eq(c.bucket, 'missing_info')
  assert(c.reasons.includes('missing_admission_number'))
  eq(c.blocking, false)
})

test('a low-confidence reading is queued for a look', () => {
  const c = classifyReviewRow(complete({ confidence: LOW_CONFIDENCE_THRESHOLD - 0.1 }))
  eq(c.bucket, 'needs_checking')
  assert(c.reasons.includes('low_confidence'))
})

test('confidence is only ever an aid — a confident row is still a proposal', () => {
  const c = classifyReviewRow(complete({ confidence: 1 }))
  eq(c.bucket, 'ready')
  eq(c.blocking, false, 'nothing here saves itself; the teacher still confirms')
})

test('no name is the one thing that blocks a row', () => {
  const c = classifyReviewRow({ fullName: '   ' })
  eq(c.blocking, true)
  assert(c.reasons.includes('missing_name'))
})

test('a duplicate is shown as a duplicate even when it is also incomplete', () => {
  const c = classifyReviewRow(complete({ admissionNumber: null }), { duplicateOf: { kind: 'within_import' } })
  eq(c.bucket, 'duplicate')
})

// ── the whole import ─────────────────────────────────────────────

console.log('\nthe whole import')

const EXISTING = [
  { id: 'e1', fullName: 'Ruth Mwila', admissionNumber: 'ADM-005', gender: 'F' },
]

test('counts add up and every bucket is represented', () => {
  const review = buildImportReview([
    complete(),
    complete({ fullName: 'Bright Kapaso', admissionNumber: 'ADM-002' }),
    complete({ fullName: 'Naomi Chipeta', admissionNumber: null, gender: 'F' }),
    complete({ fullName: 'Chanda Mulenga', admissionNumber: null, gender: 'F', confidence: 0.5 }),
    complete({ fullName: 'Chanda Mulenga', admissionNumber: null, gender: 'F' }),
  ], EXISTING)
  eq(review.counts.total, 5)
  eq(review.counts.ready, 2)
  eq(review.counts.missing_info, 1)
  eq(review.counts.needs_checking, 1)
  eq(review.counts.duplicate, 1)
})

test('a learner already on the class list is found and defaults to SKIP', () => {
  const review = buildImportReview([complete({ fullName: 'Ruth Mwila', admissionNumber: 'ADM-005', gender: 'F' })], EXISTING)
  const row = review.rows[0]
  eq(row.bucket, 'duplicate')
  eq(row.duplicateOf.kind, 'already_on_list')
  eq(row.decision, 'skip', 're-importing a file must not silently double a class')
})

test('the EARLIER of two matching rows is the one kept', () => {
  const review = buildImportReview([
    complete({ fullName: 'Chanda Mulenga', admissionNumber: null }),
    complete({ fullName: 'Chanda M. Mulenga', admissionNumber: null }),
  ])
  assert(review.rows[0].bucket !== 'duplicate', 'the first row is the one kept')
  eq(review.rows[1].bucket, 'duplicate')
  eq(review.rows[1].duplicateOf.otherId, review.rows[0].reviewId)
})

test('two learners with different admission numbers are not called duplicates', () => {
  const review = buildImportReview([
    complete({ fullName: 'Ruth Mwila', admissionNumber: 'ADM-005', gender: 'F' }),
    complete({ fullName: 'Ruth Mwila', admissionNumber: 'ADM-077', gender: 'F' }),
  ])
  eq(review.counts.duplicate, 0)
  eq(review.counts.ready, 2)
})

test('a row with no name blocks and never defaults to being imported', () => {
  const review = buildImportReview([{ fullName: '' }, complete()])
  eq(review.blockingCount, 1)
  eq(review.rows[0].decision, 'skip')
})

test('filters slice the review into the four buckets', () => {
  const review = buildImportReview([
    complete(),
    complete({ fullName: 'Naomi Chipeta', admissionNumber: null, gender: 'F' }),
  ])
  eq(filterReviewRows(review.rows, 'all').length, 2)
  eq(filterReviewRows(review.rows, 'ready').length, 1)
  eq(filterReviewRows(review.rows, 'missing_info').length, 1)
  eq(filterReviewRows(review.rows, 'duplicate').length, 0)
})

test('an empty import produces an empty, valid review', () => {
  const review = buildImportReview([], [])
  eq(review.rows.length, 0)
  eq(review.counts.total, 0)
  eq(buildImportReview(null).rows.length, 0)
})

// ── editing ──────────────────────────────────────────────────────

console.log('\nediting a row')

test('filling in a missing field re-classifies the row as ready', () => {
  const review = buildImportReview([complete({ admissionNumber: null })])
  const edited = applyRowEdit(review.rows, review.rows[0].reviewId, { admissionNumber: 'ADM-014' })
  eq(edited[0].bucket, 'ready')
  eq(edited[0].reasons.length, 0)
})

test('a corrected row is no longer described by the extractor’s confidence', () => {
  const review = buildImportReview([complete({ confidence: 0.3 })])
  eq(review.rows[0].bucket, 'needs_checking')
  const edited = applyRowEdit(review.rows, review.rows[0].reviewId, { fullName: 'Alex Lobela' })
  eq(edited[0].confidence, 1)
  eq(edited[0].bucket, 'ready')
})

test('a teacher’s decision is never overridden by re-classification', () => {
  const review = buildImportReview([
    complete({ fullName: 'Chanda Mulenga', admissionNumber: null }),
    complete({ fullName: 'Chanda M. Mulenga', admissionNumber: null }),
  ])
  const keepBoth = applyRowEdit(review.rows, review.rows[1].reviewId, { decision: 'import' })
  eq(keepBoth[1].decision, 'import')
  eq(keepBoth[1].decisionSetByTeacher, true)
  // A subsequent edit to another field must not revert the choice.
  const later = applyRowEdit(keepBoth, review.rows[1].reviewId, { gender: 'F' })
  eq(later[1].decision, 'import', 'Keep both must survive a later edit')
})

// ── the plan ─────────────────────────────────────────────────────

console.log('\nthe import plan')

test('the plan separates adds, merges and skips', () => {
  const review = buildImportReview([
    complete(),
    complete({ fullName: 'Bright Kapaso', admissionNumber: 'ADM-002' }),
    complete({ fullName: 'Ruth Mwila', admissionNumber: 'ADM-005', gender: 'F' }),
  ], EXISTING)
  const merged = applyRowEdit(review.rows, review.rows[2].reviewId, { decision: 'merge' })
  const plan = planImport(merged, EXISTING)
  eq(plan.summary.added, 2)
  eq(plan.summary.merged, 1)
  eq(plan.summary.skipped, 0)
  eq(plan.toMerge[0].into.id, 'e1')
})

test('rows that will be saved but still carry a question are counted', () => {
  const review = buildImportReview([
    complete(),
    complete({ fullName: 'Naomi Chipeta', admissionNumber: null, gender: 'F' }),
  ])
  const plan = planImport(review.rows)
  eq(plan.summary.added, 2)
  eq(plan.summary.needsReview, 1, 'an incomplete learner is saved flagged, not held back')
})

test('a blocking row is skipped whatever its decision says', () => {
  const review = buildImportReview([{ fullName: '' }])
  const forced = applyRowEdit(review.rows, review.rows[0].reviewId, { decision: 'import' })
  const plan = planImport(forced)
  eq(plan.summary.added, 0)
  eq(plan.skipped[0].reason, 'no_name')
})

test('the confirmation says exactly what will happen', () => {
  const review = buildImportReview([complete(), complete({ fullName: 'Bright Kapaso', admissionNumber: 'ADM-002' })])
  const text = importConfirmationText(planImport(review.rows), 'Grade 4A')
  eq(text, 'This will add 2 learners in Grade 4A.')
})

test('an import that would do nothing says so rather than offering a button', () => {
  const review = buildImportReview([complete()])
  const skipped = applyRowEdit(review.rows, review.rows[0].reviewId, { decision: 'skip' })
  assert(importConfirmationText(planImport(skipped), 'Grade 4A').startsWith('Nothing to import'))
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
