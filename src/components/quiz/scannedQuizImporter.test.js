/**
 * Unit tests for the scanned-PDF import orchestration's pure helpers.
 * Plain `node` ES-module script — throws on first failed assertion.
 *
 * Run: node src/components/quiz/scannedQuizImporter.test.js
 *
 * The DOM-backed bits (page rendering) are not exercised here; the logic that
 * decides scanned-vs-native, batches pages, merges batch results, and maps
 * vision questions onto editor sections (with blank answers) is what matters
 * for correctness and is fully covered.
 */

import assert from 'node:assert'
import {
  isLikelyScannedPdf,
  chunkPages,
  mergeQuestionBatches,
  visionQuestionsToSections,
  buildScannedSummary,
  SCANNED_BATCH_SIZE,
} from './scannedQuizImporter.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('scannedQuizImporter')

// ── isLikelyScannedPdf ───────────────────────────────────────────────────────

test('isLikelyScannedPdf flags an image-only paper (≈0 text)', () => {
  assert.equal(isLikelyScannedPdf({ sampledChars: 12, sampledPages: 4 }), true)
})

test('isLikelyScannedPdf does NOT flag a native text PDF', () => {
  assert.equal(isLikelyScannedPdf({ sampledChars: 4200, sampledPages: 4 }), false)
})

test('isLikelyScannedPdf is false when nothing was sampled', () => {
  assert.equal(isLikelyScannedPdf({ sampledChars: 0, sampledPages: 0 }), false)
})

// ── chunkPages ───────────────────────────────────────────────────────────────

test('chunkPages splits into batches preserving order', () => {
  const pages = Array.from({ length: 13 }, (_, i) => ({ pageNumber: i + 1 }))
  const batches = chunkPages(pages, SCANNED_BATCH_SIZE)
  assert.equal(batches.length, 3) // 6 + 6 + 1
  assert.equal(batches[0].length, 6)
  assert.equal(batches[2].length, 1)
  assert.equal(batches[2][0].pageNumber, 13)
})

test('chunkPages handles an empty list', () => {
  assert.deepEqual(chunkPages([], 6), [])
})

// ── mergeQuestionBatches ─────────────────────────────────────────────────────

test('mergeQuestionBatches concatenates in order and sums detected counts', () => {
  const { questions, detectedTotal } = mergeQuestionBatches([
    { questions: [{ text: 'Q1', options: ['a', 'b'] }], detectedCount: 5, warnings: [] },
    { questions: [{ text: 'Q2', options: ['c', 'd'] }], detectedCount: 4, warnings: [] },
  ])
  assert.equal(questions.length, 2)
  assert.equal(questions[0].text, 'Q1')
  assert.equal(detectedTotal, 9)
})

test('mergeQuestionBatches drops a duplicate straddling a batch boundary', () => {
  const dup = { text: 'Same stem', options: ['a', 'b', 'c', 'd'] }
  const { questions } = mergeQuestionBatches([
    { questions: [{ text: 'Q1', options: ['a', 'b'] }, dup] },
    { questions: [{ ...dup }, { text: 'Q3', options: ['e', 'f'] }] },
  ])
  assert.equal(questions.length, 3)
  assert.deepEqual(questions.map(q => q.text), ['Q1', 'Same stem', 'Q3'])
})

test('mergeQuestionBatches dedupes warnings', () => {
  const { warnings } = mergeQuestionBatches([
    { questions: [], warnings: ['same warning'] },
    { questions: [], warnings: ['same warning', 'other'] },
  ])
  assert.deepEqual(warnings.sort(), ['other', 'same warning'])
})

// ── visionQuestionsToSections ────────────────────────────────────────────────

// Light fakes so the mapping logic is tested without the editor's real
// (HTML-producing) helpers.
const fakeDeps = {
  toRichHtml: s => `<p>${s}</p>`,
  toOptionHtml: s => `<opt>${s}</opt>`,
  createSection: overrides => ({ kind: 'standalone', question: { ...overrides } }),
}

test('visionQuestionsToSections forces blank answers + review flags', () => {
  const { sections } = visionQuestionsToSections(
    [
      { text: 'What is 2+2?', options: ['3', '4', '5', '6'], sourceQuestionNumber: 1, correctAnswer: 1 },
    ],
    {},
    fakeDeps,
  )
  assert.equal(sections.length, 1)
  const q = sections[0].question
  assert.equal(q.correctAnswer, '', 'answer must be blank regardless of model output')
  assert.equal(q.requiresReview, true)
  assert.equal(q.type, 'mcq')
  assert.equal(q.sourceQuestionNumber, 1)
  assert.equal(q.options.length, 4)
  assert.ok(q.reviewNotes.length >= 1)
})

test('visionQuestionsToSections attaches the page image for diagram questions', () => {
  const asset = { id: 'page-3', imageUrl: 'blob:abc', objectUrl: 'blob:abc' }
  const { sections, usedAssetIds } = visionQuestionsToSections(
    [
      { text: 'Study the figure.', options: ['a', 'b', 'c', 'd'], hasDiagram: true, sourcePage: 3 },
      { text: 'Plain text Q.', options: ['a', 'b', 'c', 'd'], hasDiagram: false, sourcePage: 3 },
    ],
    { pageAssetByNumber: { 3: asset } },
    fakeDeps,
  )
  assert.equal(sections[0].question.imageAssetId, 'page-3')
  assert.equal(sections[0].question.imageUrl, 'blob:abc')
  assert.ok(/page 3/i.test(sections[0].question.diagramText))
  assert.equal(sections[1].question.imageUrl, undefined, 'plain question gets no image')
  assert.deepEqual([...usedAssetIds], ['page-3'])
})

test('visionQuestionsToSections does not attach an image when the page asset is missing', () => {
  const { sections, usedAssetIds } = visionQuestionsToSections(
    [{ text: 'Study the figure.', options: ['a', 'b'], hasDiagram: true, sourcePage: 9 }],
    { pageAssetByNumber: {} },
    fakeDeps,
  )
  assert.equal(sections[0].question.imageAssetId, undefined)
  assert.equal(usedAssetIds.size, 0)
})

test('visionQuestionsToSections numbers sequentially when source numbers are missing', () => {
  const { sections } = visionQuestionsToSections(
    [
      { text: 'A', options: ['a', 'b'] },
      { text: 'B', options: ['a', 'b'] },
    ],
    {},
    fakeDeps,
  )
  assert.equal(sections[0].question.sourceQuestionNumber, 1)
  assert.equal(sections[1].question.sourceQuestionNumber, 2)
  assert.equal(sections[0].question.order, 0)
  assert.equal(sections[1].question.order, 1)
})

test('visionQuestionsToSections maps option text through the option formatter', () => {
  const { sections } = visionQuestionsToSections(
    [{ text: 'Q', options: ['one', 'two'] }],
    {},
    fakeDeps,
  )
  assert.deepEqual(sections[0].question.options, ['<opt>one</opt>', '<opt>two</opt>'])
})

// Confirm the default (real-helper) path doesn't throw on a plain question.
test('visionQuestionsToSections runs with the real editor helpers', () => {
  const { sections } = visionQuestionsToSections([
    { text: 'Plain question', options: ['a', 'b', 'c', 'd'], sourceQuestionNumber: 7 },
  ])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].kind, 'standalone')
  assert.equal(sections[0].question.correctAnswer, '')
  assert.equal(sections[0].question.requiresReview, true)
})

// ── buildScannedSummary ──────────────────────────────────────────────────────

test('buildScannedSummary reports counts + needs-review state', () => {
  const summary = buildScannedSummary({
    questions: [{ imageAssetId: 'x' }, {}, {}],
    fileName: 'math.pdf',
    pageCount: 12,
    warnings: ['w'],
  })
  assert.equal(summary.questions, 3)
  assert.equal(summary.images, 1)
  assert.equal(summary.needsReview, 3)
  assert.equal(summary.scanned, true)
  assert.equal(summary.importStatus, 'needs_review')
  assert.equal(summary.pageCount, 12)
})

console.log(`\nscannedQuizImporter: ${passed} passed`)
