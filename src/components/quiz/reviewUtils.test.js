/**
 * Tests for the review-panel utilities. Plain `node` ES-module script —
 * throws on first failed assertion.
 *
 * Run: node src/components/quiz/reviewUtils.test.js
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

test('flags a requiresReview question even when answered', () => {
  const { items } = collectReviewItems([standalone(mcq({ correctAnswer: 1, requiresReview: true }))])
  assert.deepEqual(items[0].issues, ['Flagged'])
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
  assert.deepEqual(counts, { 'No answer': 2, Flagged: 1, 'Missing alt text': 1 })
})

console.log(`\nreviewUtils: ${passed} passed`)
