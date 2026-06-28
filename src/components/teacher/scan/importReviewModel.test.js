/**
 * Tests for importReviewModel — the pure model behind the photo-import review
 * screen. Plain `node` ES-module script; throws on first failed assertion.
 *
 * Run: node src/components/teacher/scan/importReviewModel.test.js
 */

import assert from 'node:assert'
import {
  getItemSignals,
  flattenReviewItems,
  groupReviewItemsByPage,
  buildReviewModel,
  summarizeReviewModel,
  isReviewComplete,
  pageKey,
  stripTags,
} from './importReviewModel.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('importReviewModel')

// ─── signals ────────────────────────────────────────────────────────────────
test('flags an MCQ with no answer set', () => {
  const s = getItemSignals({ type: 'mcq', correctAnswer: '', options: ['a', 'b'] })
  assert.strictEqual(s.noAnswer, true)
  assert.ok(s.issues.includes('No answer'))
})

test('does not flag noAnswer once an answer is set', () => {
  const s = getItemSignals({ type: 'mcq', correctAnswer: 2 })
  assert.strictEqual(s.noAnswer, false)
})

test('detects low confidence from OCR review notes', () => {
  const s = getItemSignals({
    type: 'short_answer',
    reviewNotes: ["OCR couldn't read part of the stem."],
  })
  assert.strictEqual(s.lowConfidence, true)
  assert.ok(s.issues.includes('Low confidence'))
})

test('flags a detected figure with no attached image as missing', () => {
  const s = getItemSignals({ type: 'mcq', correctAnswer: 1, hasDiagram: true })
  assert.strictEqual(s.missingDiagram, true)
  assert.strictEqual(s.hasDiagram, true)
  assert.ok(s.issues.includes('Missing diagram'))
})

test('an attached figure is present, not missing', () => {
  const s = getItemSignals({ type: 'mcq', correctAnswer: 1, detectedDiagrams: [{ box: {} }], imageUrl: 'blob:x' })
  assert.strictEqual(s.hasDiagram, true)
  assert.strictEqual(s.missingDiagram, false)
  assert.strictEqual(s.extraDiagrams, 0) // single detected figure → no extras
})

test('counts extra detected figures from diagramMeta.extraCount', () => {
  const s = getItemSignals({
    type: 'mcq', correctAnswer: 1, imageUrl: 'blob:x',
    detectedDiagrams: [{ box: {} }, { box: {} }, { box: {} }],
    diagramMeta: { extraCount: 2 },
  })
  assert.strictEqual(s.extraDiagrams, 2)
})

test('falls back to detectedDiagrams length when no extraCount is recorded', () => {
  const s = getItemSignals({
    type: 'mcq', correctAnswer: 1, imageUrl: 'blob:x',
    detectedDiagrams: [{ box: {} }, { box: {} }],
  })
  assert.strictEqual(s.extraDiagrams, 1) // 2 detected, 1 shown → 1 extra
})

test('flags a label-the-diagram question with no labels', () => {
  const missing = getItemSignals({ type: 'diagram', diagramMode: 'identify', diagramLabels: [] })
  assert.strictEqual(missing.missingLabels, true)
  assert.ok(missing.issues.includes('Missing labels'))
  // With labels, not flagged.
  const ok = getItemSignals({ type: 'diagram', diagramMode: 'identify', diagramLabels: [{ text: 'stem' }] })
  assert.strictEqual(ok.missingLabels, false)
  // A normal diagram (labeled mode) is never flagged for missing labels.
  const labeled = getItemSignals({ type: 'diagram', diagramMode: 'labeled', diagramLabels: [] })
  assert.strictEqual(labeled.missingLabels, false)
})

test('flags pictorial options missing alt text', () => {
  const s = getItemSignals({
    type: 'mcq', correctAnswer: 0,
    optionMedia: [{ imageUrl: 'blob:a', alt: '' }, null],
  })
  assert.strictEqual(s.missingAlt, true)
})

// ─── flatten + group ─────────────────────────────────────────────────────────
const sections = [
  { kind: 'standalone', question: { text: '<p>What is 2+2?</p>', type: 'mcq', correctAnswer: '', sourceQuestionNumber: 1, sourcePage: 1, requiresReview: true } },
  { kind: 'passage', passage: {
    title: 'The Market', passageText: '<p>Once upon a time...</p>', sourcePage: 2,
    questions: [
      { text: 'Who went to market?', type: 'mcq', correctAnswer: 2, sourceQuestionNumber: 2, sourcePage: 2 },
      { text: 'What did they buy?', type: 'short_answer', sourceQuestionNumber: 3, sourcePage: 2, requiresReview: true },
    ],
  } },
  { kind: 'standalone', question: { text: 'Study the figure', type: 'mcq', correctAnswer: '', sourceQuestionNumber: 4, sourcePage: 1, hasDiagram: true } },
]

test('flattenReviewItems emits passage + sub-questions + standalones in order', () => {
  const items = flattenReviewItems(sections)
  assert.deepStrictEqual(items.map((i) => i.kind), [
    'standalone', 'passage', 'passage-question', 'passage-question', 'standalone',
  ])
  assert.strictEqual(items[1].label, 'The Market')
  assert.strictEqual(items[2].label, 'Q2')
  // Indices wire back to updateSection.
  assert.strictEqual(items[2].sectionIndex, 1)
  assert.strictEqual(items[2].questionIndex, 0)
})

test('groupReviewItemsByPage orders pages ascending', () => {
  const groups = groupReviewItemsByPage(flattenReviewItems(sections))
  assert.deepStrictEqual(groups.map((g) => g.page), [1, 2])
  // Page 1 holds the two standalone items.
  assert.strictEqual(groups[0].items.length, 2)
})

test('null-page items sort to the end', () => {
  const groups = groupReviewItemsByPage([
    { sourcePage: null }, { sourcePage: 3 }, { sourcePage: 1 },
  ])
  assert.deepStrictEqual(groups.map((g) => g.page), [1, 3, null])
})

// ─── model + summary ─────────────────────────────────────────────────────────
test('buildReviewModel wires page image urls + per-item signals', () => {
  const model = buildReviewModel(sections, { 1: 'blob:p1', 2: 'blob:p2' })
  assert.strictEqual(model.pages.length, 2)
  assert.strictEqual(model.pages[0].originalUrl, 'blob:p1')
  assert.strictEqual(model.summary.totalItems, 4) // 3 questions + 1 standalone-with-figure
  assert.strictEqual(model.summary.noAnswer, 2)   // Q1 + Q4
  assert.strictEqual(model.summary.missingDiagrams, 1) // Q4 figure not attached
  assert.strictEqual(model.summary.needsReview, 2) // Q1 + Q3
})

test('summarizeReviewModel ignores passage rows in question counts', () => {
  const model = buildReviewModel(sections)
  const recomputed = summarizeReviewModel(model)
  assert.strictEqual(recomputed.totalItems, 4)
})

// ─── approval gate ───────────────────────────────────────────────────────────
test('isReviewComplete only true once every page is approved', () => {
  const model = buildReviewModel(sections)
  assert.strictEqual(isReviewComplete(model, new Set()), false)
  assert.strictEqual(isReviewComplete(model, new Set([pageKey(1)])), false)
  assert.strictEqual(isReviewComplete(model, new Set([pageKey(1), pageKey(2)])), true)
})

test('stripTags removes markup and collapses whitespace', () => {
  assert.strictEqual(stripTags('<p>Hello&nbsp; <b>world</b></p>'), 'Hello world')
})

console.log(`\nimportReviewModel: ${passed} passed\n`)
