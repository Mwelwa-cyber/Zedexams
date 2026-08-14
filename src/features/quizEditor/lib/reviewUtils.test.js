/**
 * Tests for the review-panel utilities. Plain `node` ES-module script —
 * throws on first failed assertion.
 *
 * Run: node src/features/quizEditor/lib/reviewUtils.test.js
 */

import assert from 'node:assert'
import { collectReviewItems, summariseReviewIssues } from './reviewUtils.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const standalone = (q) => ({ kind: 'standalone', question: q })
const passage = (questions) => ({ kind: 'passage', passage: { questions } })
const mcq = (over = {}) => ({ localId: 'q', type: 'mcq', options: ['a', 'b', 'c', 'd'], correctAnswer: 0, requiresReview: false, ...over })

console.log('reviewUtils')

test('flags an MCQ with no answer set', () => {
  const { items, total } = collectReviewItems([standalone(mcq({ localId: 'a', correctAnswer: '' }))])
  assert.equal(total, 1)
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].issues, ['No answer'])
  assert.equal(items[0].localId, 'a')
})

test('does NOT flag an MCQ that has an answer and is not flagged', () => {
  const { items } = collectReviewItems([standalone(mcq({ localId: 'a', correctAnswer: 2 }))])
  assert.equal(items.length, 0)
})

test('does NOT flag an MCQ whose answer index is a numeric string', () => {
  // Legacy/imported quizzes can store the index as "2"; it is still answered.
  const { items } = collectReviewItems([standalone(mcq({ localId: 'a', correctAnswer: '2' }))])
  assert.equal(items.length, 0)
})

test('flags a requiresReview question even when answered', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: 1, requiresReview: true }))])
  assert.deepEqual(items[0].issues, ['Flagged'])
})

test('surfaces the reviewNotes so the panel can explain WHY a question is flagged', () => {
  const { items } = collectReviewItems([standalone(mcq({
    correctAnswer: 1,
    requiresReview: true,
    reviewNotes: ['Correct option was not clear.', '  ', 'Question may have come from a flattened table.'],
  }))])
  assert.deepEqual(items[0].notes, ['Correct option was not clear.', 'Question may have come from a flattened table.'])
})

test('falls back to importWarnings when reviewNotes is empty', () => {
  const { items } = collectReviewItems([standalone(mcq({
    correctAnswer: '',
    reviewNotes: [],
    importWarnings: ['Question text was not clear.'],
  }))])
  assert.deepEqual(items[0].notes, ['Question text was not clear.'])
})

test('notes is an empty array when there is no reason text', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: '' }))])
  assert.deepEqual(items[0].notes, [])
})

test('flags a picture option missing alt text', () => {
  const q = mcq({
    correctAnswer: 0,
    optionMedia: [{ imageAssetId: 'x', alt: '' }, { imageUrl: 'u', alt: 'ok' }, null, null],
  })
  const { items } = collectReviewItems([standalone(q)])
  assert.deepEqual(items[0].issues, ['Missing alt text'])
})

test('combines multiple issues on one question', () => {
  const q = mcq({ correctAnswer: '', requiresReview: true, optionMedia: [{ imageAssetId: 'x', alt: '' }] })
  const { items } = collectReviewItems([standalone(q)])
  assert.deepEqual(items[0].issues, ['No answer', 'Flagged', 'Missing alt text'])
})

test('walks passage children and marks them inPassage', () => {
  const { items, total } = collectReviewItems([
    standalone(mcq({ localId: 'a', correctAnswer: 0 })),
    passage([mcq({ localId: 'b', correctAnswer: '' }), mcq({ localId: 'c', correctAnswer: 1 })]),
  ])
  assert.equal(total, 3)
  assert.equal(items.length, 1)
  assert.equal(items[0].localId, 'b')
  assert.equal(items[0].inPassage, true)
})

test('uses sourceQuestionNumber for the row number when present', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: '', sourceQuestionNumber: 42 }))])
  assert.equal(items[0].number, 42)
})

test('does not flag non-answerable types for a missing answer', () => {
  const { items } = collectReviewItems([standalone(mcq({ type: 'short_answer', correctAnswer: '' }))])
  assert.equal(items.length, 0)
})

test('summariseReviewIssues rolls up per-issue counts', () => {
  const counts = summariseReviewIssues([
    { issues: ['No answer'] },
    { issues: ['No answer', 'Flagged'] },
    { issues: ['Missing alt text'] },
  ])
  assert.deepEqual(counts, {
    'No answer': 2, Flagged: 1, 'Missing alt text': 1, 'Low confidence': 0, 'Missing image': 0,
  })
})

// ── Phase 12: Low confidence + Missing image filters ────────────────────────
test('flags a low-confidence AI-imported question (< 0.8)', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: 0, aiConfidence: 0.62 }))])
  assert.deepEqual(items[0].issues, ['Low confidence'])
})

test('does NOT flag a high-confidence question', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: 0, aiConfidence: 0.97 }))])
  assert.equal(items.length, 0)
})

test('does NOT flag a question with no aiConfidence at all (not scored, not "low")', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: 0 }))])
  assert.equal(items.length, 0)
})

test('flags every question under a map passage the importer located but never got an image', () => {
  const p = { passageKind: 'map', imageUrl: '', figureMeta: { sourcePage: 3, box: null } }
  const { items } = collectReviewItems([
    { kind: 'passage', passage: { ...p, questions: [mcq({ localId: 'x', correctAnswer: 0 }), mcq({ localId: 'y', correctAnswer: 1 })] } },
  ])
  assert.equal(items.length, 2)
  assert.ok(items.every(i => i.issues.includes('Missing image')))
})

test('does NOT flag a map passage that already has an image attached', () => {
  const p = { passageKind: 'map', imageUrl: 'https://cdn/x.jpg', figureMeta: { sourcePage: 3, box: null } }
  const { items } = collectReviewItems([
    { kind: 'passage', passage: { ...p, questions: [mcq({ correctAnswer: 0 })] } },
  ])
  assert.equal(items.length, 0)
})

test('does NOT flag a comprehension (non-map) passage for a missing image', () => {
  const p = { passageKind: 'comprehension', imageUrl: '', figureMeta: null }
  const { items } = collectReviewItems([
    { kind: 'passage', passage: { ...p, questions: [mcq({ correctAnswer: 0 })] } },
  ])
  assert.equal(items.length, 0)
})

console.log(`\nreviewUtils: ${passed} passed`)
