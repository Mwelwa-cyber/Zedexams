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
  stripTagsPreservingBreaks,
  encodeToRichHtml,
  importHasQuestions,
  autoApprovedPageKeys,
  describeImportScale,
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

test('extras attached as images[] count as handled, not missing', () => {
  // 3 figures detected, all attached (primary + 2 in images[]) → 0 unhandled.
  const s = getItemSignals({
    type: 'mcq', correctAnswer: 1, imageUrl: 'blob:primary',
    detectedDiagrams: [{ box: {} }, { box: {} }, { box: {} }],
    images: [{ url: 'blob:extra-1' }, { url: 'blob:extra-2' }],
  })
  assert.strictEqual(s.extraDiagrams, 0)
})

test('status is ready when nothing is flagged, review when an issue exists', () => {
  const ready = getItemSignals({ type: 'mcq', correctAnswer: 2, options: ['a', 'b'] })
  assert.strictEqual(ready.status, 'ready')
  const review = getItemSignals({ type: 'mcq', correctAnswer: '', options: ['a', 'b'] })
  assert.strictEqual(review.status, 'review')
})

test('surfaces figure detection confidence, null for text-only items', () => {
  const withFig = getItemSignals({ type: 'mcq', correctAnswer: 1, imageUrl: 'blob:x', diagramMeta: { confidence: 0.82 } })
  assert.strictEqual(withFig.confidence, 0.82)
  const fromDetected = getItemSignals({ type: 'mcq', correctAnswer: 1, imageUrl: 'blob:x', detectedDiagrams: [{ confidence: 0.6 }] })
  assert.strictEqual(fromDetected.confidence, 0.6)
  const textOnly = getItemSignals({ type: 'mcq', correctAnswer: 1 })
  assert.strictEqual(textOnly.confidence, null)
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

// ─── confidence bands + auto-approve ─────────────────────────────────────────
test('flags a maths question for a render check and blocks auto-approve', () => {
  const s = getItemSignals({
    type: 'short_answer',
    hasMath: true,
    ocrConfidence: 0.99,
    requiresReview: false,
  })
  assert.strictEqual(s.checkMath, true)
  assert.ok(s.issues.includes('Check maths'))
  assert.strictEqual(s.autoApprove, false) // maths always gets a human glance
})

test('high OCR confidence with no issues is auto-approvable (band auto)', () => {
  const s = getItemSignals({
    type: 'short_answer',
    ocrConfidence: 0.98,
    requiresReview: false,
  })
  assert.strictEqual(s.band, 'auto')
  assert.strictEqual(s.autoApprove, true)
  assert.strictEqual(s.status, 'ready')
})

test('mid confidence lands in the review band and forces review status', () => {
  const s = getItemSignals({
    type: 'short_answer',
    ocrConfidence: 0.85,
    requiresReview: false,
  })
  assert.strictEqual(s.band, 'review')
  assert.strictEqual(s.autoApprove, false)
  assert.strictEqual(s.status, 'review')
})

test('low confidence requires approval and is never auto-approved', () => {
  const s = getItemSignals({
    type: 'short_answer',
    ocrConfidence: 0.5,
    requiresReview: false,
  })
  assert.strictEqual(s.band, 'approve')
  assert.strictEqual(s.autoApprove, false)
  assert.strictEqual(s.status, 'review')
})

test('unknown confidence is never auto-approved but keeps legacy readiness', () => {
  const s = getItemSignals({ type: 'short_answer', requiresReview: false })
  assert.strictEqual(s.band, null)
  assert.strictEqual(s.autoApprove, false)
  assert.strictEqual(s.status, 'ready') // no known low score, no issues
})

test('an MCQ without an answer is never auto-approved even at high confidence', () => {
  const s = getItemSignals({
    type: 'mcq',
    options: ['a', 'b'],
    correctAnswer: '',
    ocrConfidence: 0.99,
  })
  assert.strictEqual(s.autoApprove, false) // "No answer" issue blocks it
})

test('autoApprovedPageKeys seeds only fully-confident pages', () => {
  const model = buildReviewModel([
    { kind: 'standalone', question: { type: 'short_answer', text: 'a', ocrConfidence: 0.98, requiresReview: false, sourcePage: 1 } },
    { kind: 'standalone', question: { type: 'short_answer', text: 'b', ocrConfidence: 0.99, requiresReview: false, sourcePage: 1 } },
    { kind: 'standalone', question: { type: 'short_answer', text: 'c', ocrConfidence: 0.6, requiresReview: false, sourcePage: 2 } },
  ])
  const keys = autoApprovedPageKeys(model)
  assert.strictEqual(keys.has(pageKey(1)), true) // both items high-confidence
  assert.strictEqual(keys.has(pageKey(2)), false) // a low-confidence item blocks it
})

test('summary counts auto-approvable questions', () => {
  const model = buildReviewModel([
    { kind: 'standalone', question: { type: 'short_answer', text: 'a', ocrConfidence: 0.98, requiresReview: false, sourcePage: 1 } },
    { kind: 'standalone', question: { type: 'short_answer', text: 'b', ocrConfidence: 0.5, requiresReview: false, sourcePage: 1 } },
  ])
  assert.strictEqual(model.summary.autoApprovable, 1)
})

// ── describeImportScale ──────────────────────────────────────────────────────
test('describeImportScale summarises pages + figures and flags opt-in generation', () => {
  const line = describeImportScale({ pageCount: 3, withDiagrams: 2 })
  assert.ok(/3 pages read/.test(line))
  assert.ok(/2 figures detected/.test(line))
  assert.ok(/only when you choose it/i.test(line))
})

test('describeImportScale omits the figure clause when there are none', () => {
  const line = describeImportScale({ pageCount: 1, withDiagrams: 0 })
  assert.ok(/1 page read/.test(line))
  assert.ok(!/figure/.test(line))
  assert.ok(!/choose it/i.test(line))
})

test('describeImportScale is empty when there is nothing to describe', () => {
  assert.strictEqual(describeImportScale({}), '')
  assert.strictEqual(describeImportScale({ pageCount: 0, withDiagrams: 0 }), '')
})

// ── stripTagsPreservingBreaks ────────────────────────────────────────────────
test('stripTagsPreservingBreaks converts </p> to a blank line', () => {
  assert.strictEqual(
    stripTagsPreservingBreaks('<p>Para 1</p><p>Para 2</p>'),
    'Para 1\n\nPara 2',
  )
})

test('stripTagsPreservingBreaks converts <br> to a single newline', () => {
  assert.strictEqual(
    stripTagsPreservingBreaks('<p>Line 1<br>Line 2</p>'),
    'Line 1\nLine 2',
  )
})

test('stripTagsPreservingBreaks decodes common HTML entities', () => {
  assert.strictEqual(
    stripTagsPreservingBreaks('<p>a &amp; b &lt; c &gt; d</p>'),
    'a & b < c > d',
  )
})

// ── buildReviewModel editableText (Bug [0] regressions) ─────────────────────
test('editableText preserves text beyond 280 chars without truncation', () => {
  const longText = 'A'.repeat(400)
  const model = buildReviewModel([
    {
      kind: 'standalone',
      question: { text: `<p>${longText}</p>`, type: 'mcq', correctAnswer: 0, sourcePage: 1 },
    },
  ])
  const item = model.pages[0].items[0]
  assert.ok(item.editableText.length > 280, 'editableText must exceed 280 chars')
  assert.strictEqual(item.editableText, longText)
})

test('editableText preserves paragraph breaks from a multi-paragraph passage', () => {
  const model = buildReviewModel([
    {
      kind: 'passage',
      passage: {
        title: 'Test',
        passageText: '<p>First paragraph.</p><p>Second paragraph.</p>',
        sourcePage: 1,
        questions: [],
      },
    },
  ])
  const passageItem = model.pages[0].items[0]
  assert.ok(passageItem.editableText.includes('\n'), 'editableText must contain newline')
  assert.strictEqual(passageItem.editableText, 'First paragraph.\n\nSecond paragraph.')
})

test('preview is still sliced at 280 chars (display-only; editableText is the seed)', () => {
  const longText = 'B'.repeat(400)
  const model = buildReviewModel([
    {
      kind: 'standalone',
      question: { text: `<p>${longText}</p>`, type: 'short_answer', sourcePage: 1 },
    },
  ])
  const item = model.pages[0].items[0]
  assert.strictEqual(item.preview.length, 280)
  assert.ok(item.editableText.length > 280)
})

// ── encodeToRichHtml ─────────────────────────────────────────────────────────
test('encodeToRichHtml wraps a plain string in a <p>', () => {
  assert.strictEqual(encodeToRichHtml('Hello World'), '<p>Hello World</p>')
})

test('encodeToRichHtml converts a blank-line separator into separate <p> tags', () => {
  assert.strictEqual(
    encodeToRichHtml('Para 1\n\nPara 2'),
    '<p>Para 1</p><p>Para 2</p>',
  )
})

test('encodeToRichHtml converts a single newline into <br>', () => {
  assert.strictEqual(
    encodeToRichHtml('Line 1\nLine 2'),
    '<p>Line 1<br>Line 2</p>',
  )
})

test('encodeToRichHtml HTML-escapes < > &', () => {
  assert.strictEqual(encodeToRichHtml('a < b & c > d'), '<p>a &lt; b &amp; c &gt; d</p>')
})

test('encodeToRichHtml returns empty string for blank input', () => {
  assert.strictEqual(encodeToRichHtml(''), '')
  assert.strictEqual(encodeToRichHtml('   '), '')
})

test('stripTagsPreservingBreaks / encodeToRichHtml round-trip is stable', () => {
  const original = '<p>Para 1</p><p>Line A<br>Line B</p>'
  const plain = stripTagsPreservingBreaks(original)
  const reencoded = encodeToRichHtml(plain)
  assert.strictEqual(reencoded, original)
})

// ── importHasQuestions (Bug [1] regression) ──────────────────────────────────
test('importHasQuestions is true when sections are present', () => {
  assert.strictEqual(importHasQuestions({ sections: [{}], questions: [] }), true)
})

test('importHasQuestions is true when questions are present', () => {
  assert.strictEqual(importHasQuestions({ sections: [], questions: [{}] }), true)
})

test('importHasQuestions is false for a zero-extraction result', () => {
  assert.strictEqual(importHasQuestions({ sections: [], questions: [] }), false)
})

test('importHasQuestions is false when properties are absent', () => {
  assert.strictEqual(importHasQuestions({}), false)
  assert.strictEqual(importHasQuestions(null), false)
  assert.strictEqual(importHasQuestions(undefined), false)
})

console.log(`\nimportReviewModel: ${passed} passed\n`)
