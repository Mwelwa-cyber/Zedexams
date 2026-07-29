/**
 * importReviewCore — the compulsory review a teacher does before any imported
 * learner reaches a class list.
 *
 * Pure module (no React / Firebase / DOM); node suite covers it directly.
 *
 * NOTHING IS SAVED WITHOUT CONFIRMATION (§6). Extraction — whether from a
 * photograph, an Excel file or a pasted block of names — produces PROPOSALS.
 * This module classifies them, so a teacher's attention goes to the six rows
 * that need it rather than to all eighty-six, and so the twelve that are fine
 * are not re-typed.
 *
 * Confidence is treated as a review aid and never as a verdict. A row with a
 * high confidence score is still a proposal; a low score only moves a row up
 * the queue. There is no threshold above which this module stops asking.
 */

import { compareLearners, findDuplicatePairs } from './learnerDuplicates.js'
import { normalizeLearnerStatus } from './learnerStatus.js'

export const REVIEW_BUCKETS = ['ready', 'needs_checking', 'duplicate', 'missing_info']

export const REVIEW_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'needs_checking', label: 'Needs checking' },
  { value: 'duplicate', label: 'Duplicates' },
  { value: 'missing_info', label: 'Missing information' },
]

/**
 * Below this, a row is queued for a look regardless of how complete it is.
 * Deliberately generous: the cost of asking about a name that was read
 * correctly is two seconds, and the cost of not asking is a child mis-named on
 * every register for a year.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.85

/**
 * Classify one proposed row.
 *
 * `duplicateOf` is supplied by the caller (from the pass over the whole
 * import) rather than recomputed here, because a duplicate is a fact about a
 * PAIR and this function only sees one side.
 */
export function classifyReviewRow(row, { duplicateOf = null } = {}) {
  const reasons = []
  const name = String(row?.fullName ?? '').trim()

  if (!name) reasons.push('missing_name')
  if (!row?.admissionNumber) reasons.push('missing_admission_number')
  if (!row?.gender) reasons.push('missing_gender')
  if (typeof row?.confidence === 'number' && row.confidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.push('low_confidence')
  }
  if (duplicateOf) reasons.push('possible_duplicate')

  // Order matters: a row that is BOTH a duplicate and incomplete is shown as a
  // duplicate, because merging it answers the incompleteness too.
  let bucket = 'ready'
  if (duplicateOf) bucket = 'duplicate'
  else if (!name || reasons.includes('low_confidence')) bucket = 'needs_checking'
  else if (reasons.length) bucket = 'missing_info'

  return {
    bucket,
    reasons,
    // A row cannot be saved at all without a name; everything else is a
    // question, not a blocker.
    blocking: !name,
  }
}

/**
 * Build the review model for a whole import.
 *
 * @param {Array} proposed  rows from a capture session, a file or a paste
 * @param {Array} existing  the learners already on this class list
 * @returns {{ rows, counts, duplicatePairs, blockingCount }}
 *
 * Duplicates are looked for in BOTH directions — within the import (the same
 * child written on two pages) and against the class list already saved (a
 * teacher importing the same file twice). Missing the second is how a class of
 * 86 becomes a class of 172.
 */
export function buildImportReview(proposed, existing = []) {
  const rows = (Array.isArray(proposed) ? proposed : []).map((row, i) => ({
    ...row,
    reviewId: row?.reviewId || `row-${i}`,
    decision: row?.decision || 'import',
  }))
  const saved = Array.isArray(existing) ? existing : []

  // Within the import.
  const internalPairs = findDuplicatePairs(rows)
  const duplicateOf = new Map()
  for (const pair of internalPairs) {
    // The EARLIER row is the one kept by default — it is the one nearer the
    // top of the teacher's own list.
    const later = rows[pair.bIndex]
    if (!duplicateOf.has(later.reviewId)) {
      duplicateOf.set(later.reviewId, {
        kind: 'within_import',
        otherId: rows[pair.aIndex].reviewId,
        other: rows[pair.aIndex],
        confidence: pair.confidence,
        conflicts: pair.conflicts,
        agreements: pair.agreements,
      })
    }
  }

  // Against the class list already saved.
  for (const row of rows) {
    if (duplicateOf.has(row.reviewId)) continue
    let best = null
    for (const learner of saved) {
      const result = compareLearners(row, learner)
      if (!result.duplicate) continue
      if (!best || result.nameSimilarity > best.result.nameSimilarity) best = { learner, result }
      if (result.canLinkWithoutAsking) { best = { learner, result }; break }
    }
    if (best) {
      duplicateOf.set(row.reviewId, {
        kind: 'already_on_list',
        otherId: best.learner?.id ?? null,
        other: best.learner,
        confidence: best.result.confidence,
        conflicts: best.result.conflicts,
        agreements: best.result.agreements,
      })
    }
  }

  const classified = rows.map((row) => {
    const dup = duplicateOf.get(row.reviewId) || null
    const info = classifyReviewRow(row, { duplicateOf: dup })
    return {
      ...row,
      status: normalizeLearnerStatus(row.status),
      duplicateOf: dup,
      ...info,
      // A row already on the list defaults to being SKIPPED rather than
      // imported — re-importing a file must not silently double a class.
      decision: row.decisionSetByTeacher
        ? row.decision
        : (dup?.kind === 'already_on_list' ? 'skip' : (info.blocking ? 'skip' : 'import')),
    }
  })

  const counts = { total: classified.length, ready: 0, needs_checking: 0, duplicate: 0, missing_info: 0 }
  for (const row of classified) counts[row.bucket] += 1

  return {
    rows: classified,
    counts,
    duplicatePairs: internalPairs,
    blockingCount: classified.filter((r) => r.blocking).length,
  }
}

/** Rows matching one of REVIEW_FILTERS. */
export function filterReviewRows(rows, filter = 'all') {
  const list = Array.isArray(rows) ? rows : []
  if (filter === 'all' || !filter) return list
  return list.filter((r) => r.bucket === filter)
}

/**
 * Apply a teacher's edit to one row, re-running the checks that the edit could
 * have changed.
 *
 * `decisionSetByTeacher` is stamped as soon as a decision is chosen by hand,
 * so a later re-classification never overrides a person's choice — the exact
 * failure that would make "Keep both" silently revert to "Skip".
 */
export function applyRowEdit(rows, reviewId, patch) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (row.reviewId !== reviewId) return row
    const next = { ...row, ...patch }
    if ('decision' in patch) next.decisionSetByTeacher = true
    if ('fullName' in patch || 'admissionNumber' in patch || 'gender' in patch) {
      // The row was corrected by a person, so the extractor's confidence in
      // its own reading no longer describes it.
      next.confidence = 1
      const info = classifyReviewRow(next, { duplicateOf: next.duplicateOf })
      Object.assign(next, info)
    }
    return next
  })
}

export const ROW_DECISIONS = ['import', 'skip', 'merge']

/**
 * What pressing "Add N learners" will do.
 *
 * Returns the rows in each outcome rather than counts alone, so the summary
 * shown afterwards is built from the same objects that were written — a
 * summary computed separately from the write is a summary that can be wrong.
 */
export function planImport(reviewRows, existing = []) {
  const rows = Array.isArray(reviewRows) ? reviewRows : []
  const toAdd = []
  const toMerge = []
  const skipped = []
  const needsReviewAfter = []

  for (const row of rows) {
    if (row.blocking || row.decision === 'skip') {
      skipped.push({ row, reason: row.blocking ? 'no_name' : 'teacher_skipped' })
      continue
    }
    if (row.decision === 'merge' && row.duplicateOf) {
      toMerge.push({ row, into: row.duplicateOf.other, kind: row.duplicateOf.kind })
      continue
    }
    toAdd.push(row)
    if (row.bucket !== 'ready') needsReviewAfter.push(row)
  }

  return {
    toAdd,
    toMerge,
    skipped,
    summary: {
      added: toAdd.length,
      merged: toMerge.length,
      skipped: skipped.length,
      // Learners that WILL be saved but still carry an open question. They go
      // onto the class list flagged, not held back — a teacher needs the
      // register to work tomorrow morning, and an admission number can be
      // filled in later.
      needsReview: needsReviewAfter.length,
      existingBefore: (Array.isArray(existing) ? existing : []).length,
    },
  }
}

/**
 * The confirmation sentence. Written here rather than in the component so the
 * words a teacher agrees to and the write that follows come from one object.
 */
export function importConfirmationText(plan, className) {
  const { added, merged, skipped } = plan.summary
  // Skipping is not an action a teacher is agreeing to — it is what happens to
  // the rows they are NOT importing. An import that would only skip things has
  // no outcome to confirm, and the button offering it should be disabled
  // rather than saying "This will skip 3", which reads like a change.
  if (added === 0 && merged === 0) {
    return 'Nothing to import — every row is set to be skipped.'
  }
  const parts = []
  if (added) parts.push(`add ${added} learner${added === 1 ? '' : 's'}`)
  if (merged) parts.push(`merge ${merged} record${merged === 1 ? '' : 's'}`)
  const list = parts.length > 1 ? `${parts[0]} and ${parts[1]}` : parts[0]
  const tail = skipped ? `, and skip ${skipped}` : ''
  return `This will ${list} in ${className || 'this class'}${tail}.`
}
