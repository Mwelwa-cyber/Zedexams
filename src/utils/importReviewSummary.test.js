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

console.log('importReviewSummary.test.js — OK')
