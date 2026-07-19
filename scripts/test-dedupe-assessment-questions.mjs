import assert from 'node:assert/strict'
import {
  fingerprintQuestion,
  planDedupe,
  totalMarksFor,
  flagIdenticalContentDifferentOrder,
} from './dedupe-assessment-questions.mjs'

// ─── fingerprintQuestion ───────────────────────────────────────────────────

assert.equal(fingerprintQuestion(null), '', 'null → empty fingerprint')
assert.equal(fingerprintQuestion(undefined), '', 'undefined → empty fingerprint')
assert.equal(fingerprintQuestion('not-an-object'), '', 'non-object → empty fingerprint')

// Same content, same fingerprint — even when bug-created copies have
// different doc ids / timestamps (those aren't part of the fingerprint).
{
  const a = { type: 'mcq', text: 'Q1', options: ['a', 'b'], correctAnswer: 0, order: 1, marks: 1 }
  const b = { type: 'mcq', text: 'Q1', options: ['a', 'b'], correctAnswer: 0, order: 1, marks: 1 }
  assert.equal(fingerprintQuestion(a), fingerprintQuestion(b), 'identical content → identical fp')
}

// Order is part of the fingerprint: two questions with same text but different
// positions must NEVER be collapsed.
{
  const a = { type: 'mcq', text: 'Pick A', options: ['a'], correctAnswer: 0, order: 1 }
  const b = { type: 'mcq', text: 'Pick A', options: ['a'], correctAnswer: 0, order: 2 }
  assert.notEqual(fingerprintQuestion(a), fingerprintQuestion(b), 'different order → different fp')
}

// Different correct answer → different fingerprint (real edit, not a dupe).
{
  const a = { type: 'mcq', text: 'Q', options: ['a', 'b'], correctAnswer: 0, order: 1 }
  const b = { type: 'mcq', text: 'Q', options: ['a', 'b'], correctAnswer: 1, order: 1 }
  assert.notEqual(fingerprintQuestion(a), fingerprintQuestion(b), 'different answer → different fp')
}

// ─── planDedupe: the exact reported case (30 questions × 3 copies = 90) ──────

{
  const distinct = Array.from({ length: 30 }, (_, i) => ({
    type: 'mcq', text: `<p>Question ${i + 1}</p>`, options: ['A', 'B', 'C', 'D'],
    correctAnswer: i % 4, order: i + 1, marks: 1,
  }))
  const entries = []
  for (let copy = 0; copy < 3; copy++) {
    for (const q of distinct) {
      entries.push({ id: `auto_${String(entries.length).padStart(4, '0')}`, data: { ...q } })
    }
  }
  assert.equal(entries.length, 90, 'the bug-inflated subcollection holds 90 docs')
  const { keep, drop, groups } = planDedupe(entries)
  assert.equal(groups, 30, '30 unique questions')
  assert.equal(keep.length, 30, 'exactly 30 survivors — the original paper')
  assert.equal(drop.length, 60, 'drop the 2 extra copies of each of the 30')

  // Survivor per group is the smallest (earliest-written) doc id.
  const keptIds = keep.map(k => k.id).sort()
  assert.equal(keptIds[0], 'auto_0000', 'earliest copy survives')
  assert.equal(totalMarksFor(keep), 30, 'post-dedupe totalMarks matches 30 × 1')
}

// Idempotent: re-running on already-clean entries finds 0 drops.
{
  const entries = [
    { id: 'a', data: { type: 'mcq', text: 'Q1', options: ['a'], correctAnswer: 0, order: 1 } },
    { id: 'b', data: { type: 'mcq', text: 'Q2', options: ['a'], correctAnswer: 0, order: 2 } },
  ]
  const { keep, drop, groups } = planDedupe(entries)
  assert.equal(keep.length, 2, 'all entries survive')
  assert.equal(drop.length, 0, 'no duplicates to drop')
  assert.equal(groups, 2)
}

// Empty / single.
{
  assert.deepEqual(planDedupe([]), { keep: [], drop: [], groups: 0 })
  const one = planDedupe([{ id: 'only', data: { type: 'mcq', text: 'Q', options: ['a'], correctAnswer: 0, order: 1 } }])
  assert.equal(one.keep.length, 1)
  assert.equal(one.drop.length, 0)
}

// Two distinct questions that merely share wording but sit at different
// positions → NOT merged (guards a real paper's repeated stem).
{
  const entries = [
    { id: 'a', data: { type: 'mcq', text: 'State one', options: ['a'], correctAnswer: 0, order: 5 } },
    { id: 'b', data: { type: 'mcq', text: 'State one', options: ['a'], correctAnswer: 0, order: 9 } },
  ]
  const { keep, drop } = planDedupe(entries)
  assert.equal(keep.length, 2, 'different order keeps both')
  assert.equal(drop.length, 0)
}

// ─── flagIdenticalContentDifferentOrder ─────────────────────────────────────

// A paper re-saved after a reload: its triplicates were renumbered to distinct
// orders. planDedupe leaves them (different fp); this flags them for a human.
{
  const entries = [
    { id: 'a', data: { type: 'mcq', text: 'Q1', options: ['a'], correctAnswer: 0, order: 1 } },
    { id: 'b', data: { type: 'mcq', text: 'Q1', options: ['a'], correctAnswer: 0, order: 2 } },
    { id: 'c', data: { type: 'mcq', text: 'Q1', options: ['a'], correctAnswer: 0, order: 3 } },
  ]
  // Not auto-merged:
  assert.equal(planDedupe(entries).drop.length, 0, 'renumbered copies are never auto-deleted')
  // But flagged:
  const flagged = flagIdenticalContentDifferentOrder(entries)
  assert.equal(flagged.length, 1, 'one identical-content/different-order group flagged')
  assert.deepEqual(flagged[0].ids.sort(), ['a', 'b', 'c'], 'all three ids reported for review')
  assert.deepEqual(flagged[0].orders, [1, 2, 3], 'their distinct orders reported')
}

// Genuinely distinct questions → nothing flagged.
{
  const entries = [
    { id: 'a', data: { type: 'mcq', text: 'Q1', options: ['a'], correctAnswer: 0, order: 1 } },
    { id: 'b', data: { type: 'mcq', text: 'Q2', options: ['a'], correctAnswer: 0, order: 2 } },
  ]
  assert.equal(flagIdenticalContentDifferentOrder(entries).length, 0, 'distinct content → no flags')
}

// ─── totalMarksFor ─────────────────────────────────────────────────────────

assert.equal(totalMarksFor([]), 0, 'empty array → 0 marks')
assert.equal(
  totalMarksFor([
    { id: 'a', data: { marks: 2 } },
    { id: 'b', data: { marks: 3 } },
    { id: 'c', data: {} }, // no marks → 1
  ]),
  6,
  'sums marks; missing marks defaults to 1',
)

console.log('test-dedupe-assessment-questions.mjs OK')
