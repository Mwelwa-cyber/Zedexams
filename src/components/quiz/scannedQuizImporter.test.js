/**
 * Unit tests for the scanned-PDF import orchestration's pure helpers.
 * Plain `node` ES-module script — throws on first failed assertion.
 *
 * Run: node src/components/quiz/scannedQuizImporter.test.js
 *
 * The DOM-backed bits (page rendering) are not exercised here; the logic that
 * decides scanned-vs-native, batches pages, merges batch sections (passages +
 * standalones), and maps them onto editor sections (blank answers, attached
 * page images) is what matters for correctness and is fully covered.
 */

import assert from 'node:assert'
import {
  isLikelyScannedPdf,
  chunkPages,
  mergeSectionBatches,
  visionSectionsToLocal,
  countLocalQuestions,
  buildScannedSummary,
} from './scannedQuizImporter.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const mcq = (over = {}) => ({ text: 'Q', options: ['a', 'b', 'c', 'd'], ...over })

// Light fakes so mapping logic is tested without the editor's HTML helpers.
const fakeDeps = {
  toRichHtml: s => `<p>${s}</p>`,
  toOptionHtml: s => `<opt>${s}</opt>`,
  createSection: overrides => ({ kind: 'standalone', question: { ...overrides } }),
  createPassage: overrides => ({
    kind: 'passage',
    passage: { ...overrides, questions: overrides.questions },
  }),
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

// ── chunkPages (with overlap) ────────────────────────────────────────────────

test('chunkPages overlaps batches by one page so boundaries are covered', () => {
  const pages = Array.from({ length: 13 }, (_, i) => ({ pageNumber: i + 1 }))
  const batches = chunkPages(pages, 5, 1) // step 4: [1-5] [5-9] [9-13]
  assert.equal(batches.length, 3)
  assert.equal(batches[0].at(-1).pageNumber, 5)
  assert.equal(batches[1][0].pageNumber, 5, 'overlap: batch 2 starts on the last page of batch 1')
  assert.equal(batches[2].at(-1).pageNumber, 13)
})

test('chunkPages handles a single short batch and an empty list', () => {
  assert.equal(chunkPages([{ pageNumber: 1 }], 5, 1).length, 1)
  assert.deepEqual(chunkPages([], 5, 1), [])
})

// ── mergeSectionBatches ──────────────────────────────────────────────────────

test('mergeSectionBatches concatenates standalone + passage sections in order', () => {
  const { sections, detectedTotal } = mergeSectionBatches([
    {
      detectedCount: 3,
      sections: [
        { kind: 'standalone', question: mcq({ text: 'Q1' }) },
        { kind: 'passage', passageKind: 'comprehension', title: 'Story', passageText: 'abc', questions: [mcq({ text: 'Q2' })] },
      ],
    },
  ])
  assert.equal(sections.length, 2)
  assert.equal(sections[0].kind, 'standalone')
  assert.equal(sections[1].kind, 'passage')
  assert.equal(detectedTotal, 3)
})

test('mergeSectionBatches merges a passage that straddles the batch overlap', () => {
  const passageA = { kind: 'passage', passageKind: 'comprehension', title: 'Story', passageText: 'short', questions: [mcq({ text: 'Q1' }), mcq({ text: 'Q2' })] }
  const passageB = { kind: 'passage', passageKind: 'comprehension', title: 'Story', passageText: 'a longer version of the text', questions: [mcq({ text: 'Q2' }), mcq({ text: 'Q3' })] }
  const { sections } = mergeSectionBatches([
    { sections: [passageA] },
    { sections: [passageB] },
  ])
  assert.equal(sections.length, 1, 'same passage merged, not duplicated')
  assert.deepEqual(sections[0].questions.map(q => q.text), ['Q1', 'Q2', 'Q3'])
  assert.equal(sections[0].passageText, 'a longer version of the text', 'keeps the richer text')
})

test('mergeSectionBatches drops a duplicate standalone from the overlap', () => {
  const dup = mcq({ text: 'Same' })
  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'standalone', question: dup }] },
    { sections: [{ kind: 'standalone', question: { ...dup } }, { kind: 'standalone', question: mcq({ text: 'New' }) }] },
  ])
  assert.deepEqual(sections.map(s => s.question.text), ['Same', 'New'])
})

test('mergeSectionBatches keeps two different maps on different pages apart', () => {
  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'passage', passageKind: 'map', title: '', passageText: '', sourcePage: 2, questions: [mcq({ text: 'Q1' })] }] },
    { sections: [{ kind: 'passage', passageKind: 'map', title: '', passageText: '', sourcePage: 7, questions: [mcq({ text: 'Q9' })] }] },
  ])
  assert.equal(sections.length, 2)
})

// ── visionSectionsToLocal ────────────────────────────────────────────────────

test('visionSectionsToLocal forces blank answers + review on every question', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: mcq({ text: '2+2?', sourceQuestionNumber: 1, correctAnswer: 1 }) }],
    {},
    fakeDeps,
  )
  const q = sections[0].question
  assert.equal(q.correctAnswer, '', 'answer must be blank regardless of model output')
  assert.equal(q.requiresReview, true)
  assert.equal(q.type, 'mcq')
  assert.equal(q.sourceQuestionNumber, 1)
})

test('visionSectionsToLocal builds a comprehension passage with grouped questions', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'passage', passageKind: 'comprehension', title: 'The Lion', passageText: 'Once...', questions: [mcq({ text: 'Who?' }), mcq({ text: 'Where?' })] }],
    {},
    fakeDeps,
  )
  assert.equal(sections[0].kind, 'passage')
  assert.equal(sections[0].passage.passageKind, 'comprehension')
  assert.equal(sections[0].passage.passageText, '<p>Once...</p>')
  assert.equal(sections[0].passage.questions.length, 2)
  assert.equal(sections[0].passage.questions[0].correctAnswer, '')
})

test('visionSectionsToLocal attaches the source page image to a map passage', () => {
  const asset = { id: 'page-2', imageUrl: 'blob:map', objectUrl: 'blob:map' }
  const { sections, usedAssetIds } = visionSectionsToLocal(
    [{ kind: 'passage', passageKind: 'map', title: 'Map', hasImage: true, sourcePage: 2, questions: [mcq()] }],
    { pageAssetByNumber: { 2: asset } },
    fakeDeps,
  )
  assert.equal(sections[0].passage.imageAssetId, 'page-2')
  assert.equal(sections[0].passage.imageUrl, 'blob:map')
  assert.deepEqual([...usedAssetIds], ['page-2'])
})

test('visionSectionsToLocal attaches the page image to a diagram question', () => {
  const asset = { id: 'page-5', imageUrl: 'blob:fig', objectUrl: 'blob:fig' }
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: mcq({ text: 'Study the figure', hasDiagram: true, sourcePage: 5 }) }],
    { pageAssetByNumber: { 5: asset } },
    fakeDeps,
  )
  assert.equal(sections[0].question.imageAssetId, 'page-5')
  assert.ok(/page 5/i.test(sections[0].question.diagramText))
})

test('visionSectionsToLocal numbers order globally across sections', () => {
  const { sections } = visionSectionsToLocal(
    [
      { kind: 'standalone', question: mcq({ text: 'A' }) },
      { kind: 'passage', passageKind: 'comprehension', title: 'P', passageText: 't', questions: [mcq({ text: 'B' }), mcq({ text: 'C' })] },
      { kind: 'standalone', question: mcq({ text: 'D' }) },
    ],
    {},
    fakeDeps,
  )
  assert.equal(sections[0].question.order, 0)
  assert.equal(sections[1].passage.questions[0].order, 1)
  assert.equal(sections[1].passage.questions[1].order, 2)
  assert.equal(sections[2].question.order, 3)
})

test('visionSectionsToLocal maps options through the option formatter', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: mcq({ options: ['one', 'two'] }) }],
    {},
    fakeDeps,
  )
  assert.deepEqual(sections[0].question.options, ['<opt>one</opt>', '<opt>two</opt>'])
})

// Default (real-helper) path must not throw on a passage + standalone mix.
test('visionSectionsToLocal runs with the real editor helpers', () => {
  const { sections } = visionSectionsToLocal([
    { kind: 'standalone', question: mcq({ text: 'Plain', sourceQuestionNumber: 7 }) },
    { kind: 'passage', passageKind: 'comprehension', title: 'P', passageText: 'Once upon a time', questions: [mcq({ text: 'Who?' })] },
  ])
  assert.equal(sections.length, 2)
  assert.equal(sections[0].kind, 'standalone')
  assert.equal(sections[0].question.correctAnswer, '')
  assert.equal(sections[1].kind, 'passage')
  assert.equal(sections[1].passage.questions.length, 1)
})

// ── countLocalQuestions / buildScannedSummary ────────────────────────────────

test('countLocalQuestions totals passage children + standalones', () => {
  const total = countLocalQuestions([
    { kind: 'passage', passage: { questions: [{}, {}] } },
    { kind: 'standalone', question: {} },
  ])
  assert.equal(total, 3)
})

test('buildScannedSummary reports counts, passages, images + review state', () => {
  const summary = buildScannedSummary({
    sections: [
      { kind: 'passage', passage: { imageAssetId: 'm', questions: [{ imageAssetId: 'x' }, {}] } },
      { kind: 'standalone', question: {} },
    ],
    fileName: 'social.pdf',
    pageCount: 11,
    warnings: ['w'],
  })
  assert.equal(summary.questions, 3)
  assert.equal(summary.passages, 1)
  assert.equal(summary.images, 2) // map image + one diagram question
  assert.equal(summary.needsReview, 3)
  assert.equal(summary.scanned, true)
  assert.equal(summary.importStatus, 'needs_review')
  assert.equal(summary.pageCount, 11)
})

console.log(`\nscannedQuizImporter: ${passed} passed`)
