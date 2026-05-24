import assert from 'node:assert/strict'
import { summarizeImportReview } from './importReviewSummary.js'

// Non-imported record → returns the empty shape so callers can branch on
// isImported and render nothing. Helps ManageContent / AssessmentList
// avoid an empty-pill artifact for hand-authored quizzes.
{
  const out = summarizeImportReview({ mode: 'manual', title: 'Hand-typed quiz' })
  assert.equal(out.isImported, false)
  assert.equal(out.needsReview, false)
  assert.equal(out.warningCount, 0)
  assert.deepEqual(out.sampleWarnings, [])
}

// Imported, clean status → green pill territory.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'success',
    importWarnings: [],
    sourceFileName: 'g5-maths-week3.docx',
  })
  assert.equal(out.isImported, true)
  assert.equal(out.needsReview, false)
  assert.equal(out.warningCount, 0)
  assert.equal(out.sourceFileName, 'g5-maths-week3.docx')
}

// Imported with declared needs_review status — needsReview is true even
// if the warnings array is somehow empty (defensive).
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: [],
  })
  assert.equal(out.isImported, true)
  assert.equal(out.needsReview, true)
  assert.equal(out.warningCount, 0)
}

// Imported with warnings but no declared status — still flagged as
// needsReview so the badge prompts the teacher to take a look.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importWarnings: ['A passage image could not be resolved.'],
  })
  assert.equal(out.needsReview, true)
  assert.equal(out.warningCount, 1)
  assert.deepEqual(out.sampleWarnings, ['A passage image could not be resolved.'])
}

// More than MAX_SAMPLE_WARNINGS warnings → sample is clamped to 3 to keep
// the tooltip readable. Total count survives.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: ['one', 'two', 'three', 'four', 'five'],
  })
  assert.equal(out.warningCount, 5)
  assert.equal(out.sampleWarnings.length, 3)
  assert.deepEqual(out.sampleWarnings, ['one', 'two', 'three'])
}

// Duplicate warnings de-dupe so a noisy importer doesn't spam the tooltip.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: ['same', 'same', 'same', 'different'],
  })
  assert.deepEqual(out.sampleWarnings, ['same', 'different'])
}

// Very long warning text gets clamped to keep tooltip layout sane.
{
  const longText = 'x'.repeat(500)
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: [longText],
  })
  assert.ok(out.sampleWarnings[0].endsWith('…'),
    'long warnings get an ellipsis to signal truncation')
  assert.ok(out.sampleWarnings[0].length < longText.length,
    'clamped text is shorter than the original')
}

// Null / non-array warnings field doesn't blow up the summarizer.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: null,
  })
  assert.equal(out.warningCount, 0)
  assert.deepEqual(out.sampleWarnings, [])
}

// Missing / null record returns the empty shape rather than throwing.
{
  const out = summarizeImportReview(null)
  assert.equal(out.isImported, false)
}

// ─── Phase 10: reviewCount field ───────────────────────────────────────────

// reviewCount > 0 → needsReview is true and overrides any older signal.
// Even if importStatus claims 'success', a non-zero count still warns.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'success',
    importWarnings: [],
    reviewCount: 3,
  })
  assert.equal(out.needsReview, true,
    'persisted reviewCount overrides importStatus when > 0')
  assert.equal(out.reviewCount, 3)
}

// reviewCount === 0 → needsReview false even if importStatus is still
// 'needs_review' (teacher fixed every flagged question; the next save
// recomputed the count to zero but didn't necessarily flip the status).
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: ['some old warning'],
    reviewCount: 0,
  })
  assert.equal(out.needsReview, false,
    'persisted reviewCount=0 trumps the legacy status + warning signals')
  assert.equal(out.reviewCount, 0)
}

// Pre-Phase-10 doc (no reviewCount field) falls back to the legacy signal.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    importWarnings: ['parse error on page 4'],
  })
  assert.equal(out.needsReview, true)
  assert.equal(out.reviewCount, null,
    'unset reviewCount surfaces as null so renderers can branch')
}

// Numeric string is accepted (Firestore exports / loose data sources).
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'success',
    reviewCount: '2',
  })
  assert.equal(out.reviewCount, 2)
  assert.equal(out.needsReview, true)
}

// Garbage in the field doesn't crash — falls back to null and the legacy
// signal kicks in.
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'needs_review',
    reviewCount: 'banana',
  })
  assert.equal(out.reviewCount, null)
  assert.equal(out.needsReview, true, 'still flagged via the legacy status')
}

// Negative numbers are treated as garbage (defensive).
{
  const out = summarizeImportReview({
    mode: 'imported_document',
    importStatus: 'success',
    reviewCount: -1,
  })
  assert.equal(out.reviewCount, null)
}

console.log('importReviewSummary.test.js — OK')
