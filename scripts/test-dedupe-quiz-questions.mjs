import assert from 'node:assert/strict'
import {
  fingerprintQuestion,
  planDedupe,
  totalMarksFor,
} from './dedupe-quiz-questions.mjs'

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

// Order is part of the fingerprint: two questions with same text but
// different positions must NEVER be collapsed.
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

// Whitespace-only differences in text don't matter (trim).
{
  const a = { type: 'mcq', text: ' Q1 ', options: [' a '], correctAnswer: 0, order: 1 }
  const b = { type: 'mcq', text: 'Q1',   options: ['a'],   correctAnswer: 0, order: 1 }
  assert.equal(fingerprintQuestion(a), fingerprintQuestion(b), 'whitespace ignored after trim')
}

// Short-answer correctAnswer is a string — preserved as string, trimmed.
{
  const a = { type: 'short_answer', text: 'Spell two', correctAnswer: ' two ', order: 1 }
  const b = { type: 'short_answer', text: 'Spell two', correctAnswer: 'two',   order: 1 }
  assert.equal(fingerprintQuestion(a), fingerprintQuestion(b), 'short-answer trim')
}

// ─── planDedupe ────────────────────────────────────────────────────────────

// 3 distinct questions, each duplicated 4 times → 3 kept, 9 dropped.
{
  const distinct = [
    { type: 'mcq', text: 'Q1', options: ['a'], correctAnswer: 0, order: 1, marks: 1 },
    { type: 'mcq', text: 'Q2', options: ['a'], correctAnswer: 0, order: 2, marks: 2 },
    { type: 'mcq', text: 'Q3', options: ['a'], correctAnswer: 0, order: 3, marks: 1 },
  ]
  const entries = []
  for (let i = 0; i < 4; i++) {
    for (const q of distinct) {
      entries.push({ id: `auto_${String(entries.length).padStart(4, '0')}`, data: { ...q } })
    }
  }
  const { keep, drop, groups } = planDedupe(entries)
  assert.equal(groups, 3, '3 unique fingerprints')
  assert.equal(keep.length, 3, '3 survivors')
  assert.equal(drop.length, 9, '9 dropped (4 copies − 1 kept × 3 distinct)')

  // Survivor in each group is the smallest doc id — Firestore auto-IDs
  // sort by creation time, so this is the earliest write per fingerprint.
  const keptIds = keep.map(k => k.id).sort()
  assert.deepEqual(keptIds, ['auto_0000', 'auto_0001', 'auto_0002'])
}

// Idempotent: re-running dedupe on already-clean entries finds 0 drops.
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

// Empty quiz: 0 entries → 0 kept, 0 dropped.
{
  const { keep, drop, groups } = planDedupe([])
  assert.equal(keep.length, 0)
  assert.equal(drop.length, 0)
  assert.equal(groups, 0)
}

// Single question, single entry: kept, no drop.
{
  const entries = [{ id: 'only', data: { type: 'mcq', text: 'Q', options: ['a'], correctAnswer: 0, order: 1 } }]
  const { keep, drop } = planDedupe(entries)
  assert.equal(keep.length, 1)
  assert.equal(drop.length, 0)
  assert.equal(keep[0].id, 'only')
}

// Two questions with identical content but different orders → NOT
// merged. Guards against eating a legitimate "fill-in two blanks with the
// same word" past-paper item.
{
  const entries = [
    { id: 'a', data: { type: 'mcq', text: 'pick a', options: ['a'], correctAnswer: 0, order: 1 } },
    { id: 'b', data: { type: 'mcq', text: 'pick a', options: ['a'], correctAnswer: 0, order: 2 } },
  ]
  const { keep, drop } = planDedupe(entries)
  assert.equal(keep.length, 2, 'different order keeps both')
  assert.equal(drop.length, 0)
}

// The 2280-question past paper reproduces here: 60 distinct items × 38
// copies → keep 60, drop 2220. Mirrors the actual production case from
// PR #674.
{
  const entries = []
  for (let copy = 0; copy < 38; copy++) {
    for (let order = 1; order <= 60; order++) {
      entries.push({
        id: `auto_${String(entries.length).padStart(5, '0')}`,
        data: {
          type: 'mcq', text: `Q${order}`, options: ['a', 'b', 'c', 'd'],
          correctAnswer: order % 4, order, marks: 1,
        },
      })
    }
  }
  const { keep, drop, groups } = planDedupe(entries)
  assert.equal(entries.length, 2280, '38 × 60 = 2280 docs in the bug-inflated subcollection')
  assert.equal(groups, 60, '60 unique past-paper questions')
  assert.equal(keep.length, 60, 'one survivor per question')
  assert.equal(drop.length, 2220, 'remove 37 of every 38 copies')
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
assert.equal(
  totalMarksFor([{ id: 'a', data: { marks: 'not-a-number' } }]),
  1,
  'NaN marks → fallback 1',
)

console.log('test-dedupe-quiz-questions.mjs OK')
