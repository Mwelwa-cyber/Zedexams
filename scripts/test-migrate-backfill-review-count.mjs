import assert from 'node:assert/strict'
import {
  countQuestionsNeedingReview,
  decideBackfill,
} from './migrate-backfill-review-count.mjs'

// ─── countQuestionsNeedingReview ───────────────────────────────────────────

assert.equal(countQuestionsNeedingReview([]), 0, 'empty array → 0')
assert.equal(countQuestionsNeedingReview(), 0, 'undefined → 0')
assert.equal(countQuestionsNeedingReview(null), 0, 'null → 0')
assert.equal(countQuestionsNeedingReview('not-array'), 0, 'non-array → 0')
assert.equal(
  countQuestionsNeedingReview([{}, { requiresReview: true }, {}]),
  1,
  'one flagged out of three',
)
assert.equal(
  countQuestionsNeedingReview([
    { requiresReview: true },
    null,
    { requiresReview: 'truthy-string-is-not-true' }, // strict ===
    { requiresReview: true },
  ]),
  2,
  'strict ===true only; nulls and truthy-non-true skipped',
)

// ─── decideBackfill ────────────────────────────────────────────────────────

// Parent with no reviewCount + questions with flags → write
{
  const v = decideBackfill({ title: 'Q' }, [
    { requiresReview: true }, { requiresReview: true }, {},
  ])
  assert.equal(v.reviewCount, 2)
  assert.equal(v.shouldWrite, true, 'missing reviewCount + non-zero count → write')
}

// Parent already at the right count → no write
{
  const v = decideBackfill({ reviewCount: 2 }, [
    { requiresReview: true }, { requiresReview: true }, {},
  ])
  assert.equal(v.reviewCount, 2)
  assert.equal(v.shouldWrite, false, 'idempotent on already-correct docs')
}

// Parent with stale count (questions fixed since last save) → write 0
{
  const v = decideBackfill({ reviewCount: 4 }, [{}, {}, { requiresReview: false }])
  assert.equal(v.reviewCount, 0)
  assert.equal(v.shouldWrite, true, 'fewer flagged than persisted → write down')
}

// Parent with zero questions → write 0 if not already
{
  const v = decideBackfill({ reviewCount: 1 }, [])
  assert.equal(v.reviewCount, 0)
  assert.equal(v.shouldWrite, true)
}

// Parent with no reviewCount AND zero flagged → still write 0 once so the
// field exists (otherwise the badge code can't tell "I checked and there's
// nothing" from "I haven't been backfilled yet").
{
  const v = decideBackfill({}, [{}, {}, {}])
  assert.equal(v.reviewCount, 0)
  assert.equal(v.shouldWrite, true, 'first-time backfill writes the field even at 0')
}

// Garbage reviewCount in the doc → treated as null, write happens.
{
  const v = decideBackfill({ reviewCount: 'banana' }, [{ requiresReview: true }])
  assert.equal(v.reviewCount, 1)
  assert.equal(v.shouldWrite, true)
}

// Null parent doesn't crash.
{
  const v = decideBackfill(null, [{ requiresReview: true }])
  assert.equal(v.reviewCount, 1)
  assert.equal(v.shouldWrite, true)
}

console.log('test-migrate-backfill-review-count.mjs — OK')
