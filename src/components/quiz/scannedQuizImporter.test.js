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
  planOptionImageCrops,
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

// ── English ECZ paper: comprehension passage spanning the batch overlap ──────
// Regression for the English import bug: a long comprehension passage whose
// questions straddle the batch boundary must produce the full question count
// with zero duplicates and zero dropped questions.

test('mergeSectionBatches: English comprehension spanning overlap — no questions dropped, no duplicates', () => {
  // Simulate a 16-page English paper split into batches [1-5],[5-9],[9-13],[13-16].
  // The main comprehension passage (Section A) has 20 questions across pages 3-6.
  // Batch 1 sees Q1-Q15 under the passage.
  // Batch 2 (overlap on page 5) sees the same passage title + Q13-Q20.
  // Q13-Q15 are the overlap duplicates; Q16-Q20 are new in batch 2.
  const makeQ = (n) => mcq({ text: `What does paragraph ${n} show?`, options: [`Opt${n}A`, `Opt${n}B`, `Opt${n}C`, `Opt${n}D`] })
  const allQ = Array.from({ length: 20 }, (_, i) => makeQ(i + 1))

  const passageBase = {
    kind: 'passage',
    passageKind: 'comprehension',
    title: 'The Generous Farmer',
    passageText: 'A long story about a generous farmer in Zambia who shared his harvest with neighbours...',
  }

  const batch1 = {
    sections: [
      { ...passageBase, questions: allQ.slice(0, 15) },                 // Q1-Q15
      { kind: 'standalone', question: mcq({ text: 'Standalone S1' }) }, // unrelated Q
    ],
  }
  const batch2 = {
    sections: [
      { ...passageBase, questions: allQ.slice(12, 20) },                // Q13-Q20 (overlap Q13-Q15 + new Q16-Q20)
      { kind: 'standalone', question: mcq({ text: 'Standalone S2' }) }, // next section standalone
    ],
  }

  const { sections } = mergeSectionBatches([batch1, batch2])

  const passageSections = sections.filter(s => s.kind === 'passage')
  const standaloneSections = sections.filter(s => s.kind === 'standalone')

  // The comprehension passage must appear exactly once.
  assert.equal(passageSections.length, 1, 'passage must not be duplicated')

  // All 20 questions must be present (Q1-Q15 from batch1 + Q16-Q20 new from batch2).
  const questionTexts = passageSections[0].questions.map(q => q.text)
  assert.equal(
    questionTexts.length,
    20,
    `expected 20 passage questions, got ${questionTexts.length}: ${JSON.stringify(questionTexts)}`,
  )

  // No duplicates: each question text appears exactly once.
  const unique = new Set(questionTexts)
  assert.equal(unique.size, 20, 'no duplicate comprehension questions')

  // The overlap standalones should both be present (different stems).
  assert.equal(standaloneSections.length, 2)
  assert.deepEqual(
    standaloneSections.map(s => s.question.text),
    ['Standalone S1', 'Standalone S2'],
  )
})

test('mergeSectionBatches: English paper with two separate comprehension passages — both kept intact', () => {
  // English papers sometimes have two comprehension passages (Section A + C).
  // Both must survive the merge without losing questions.
  const makeQ = (label) => mcq({ text: `Question about ${label}`, options: ['A', 'B', 'C', 'D'] })

  const passageA = {
    kind: 'passage', passageKind: 'comprehension', title: 'Section A: The Harvest',
    passageText: 'Story about the harvest...',
    questions: Array.from({ length: 10 }, (_, i) => makeQ(`harvest-${i + 1}`)),
  }
  const passageB = {
    kind: 'passage', passageKind: 'comprehension', title: 'Section C: The Market',
    passageText: 'Story about the market...',
    questions: Array.from({ length: 8 }, (_, i) => makeQ(`market-${i + 1}`)),
  }

  const batch1 = { sections: [passageA] }
  const batch2 = { sections: [passageB] } // different passage, no overlap

  const { sections } = mergeSectionBatches([batch1, batch2])

  assert.equal(sections.length, 2, 'both passages must be kept')
  assert.equal(sections[0].questions.length, 10, 'passage A question count')
  assert.equal(sections[1].questions.length, 8, 'passage B question count')
})

test('mergeSectionBatches: overlap does not produce extra standalone duplicates', () => {
  // Batch overlap page can cause the same standalone question to appear in two
  // consecutive batches with slightly different OCR whitespace. Both must
  // deduplicate to exactly one after merge.
  const q = mcq({ text: 'In the sentence "The dog barked loudly", what type of adverb is "loudly"?', options: ['Manner', 'Place', 'Time', 'Degree'] })
  const qTrimVariant = { ...q, text: q.text.replace('  ', ' ') } // same after trim

  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'standalone', question: q }] },
    { sections: [{ kind: 'standalone', question: qTrimVariant }] },
  ])
  assert.equal(sections.length, 1, 'duplicate standalone from overlap must be deduped to one')
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

// ── planOptionImageCrops (pictorial options) ─────────────────────────────────

const pageAsset = { id: 'page-4', objectUrl: 'blob:p4', imageUrl: 'blob:p4', sourcePage: 4 }

test('planOptionImageCrops plans a crop per boxed option', () => {
  const plan = planOptionImageCrops(
    {
      optionsAreImages: true,
      optionImageBoxes: [
        { x: 0.1, y: 0.5, w: 0.15, h: 0.15 },
        { x: 0.3, y: 0.5, w: 0.15, h: 0.15 },
        null,
        { x: 0.7, y: 0.5, w: 0.15, h: 0.15 },
      ],
    },
    pageAsset,
  )
  assert.equal(plan.length, 3)
  assert.deepEqual(plan.map(p => p.index), [0, 1, 3])
  assert.equal(plan[0].label, 'A')
  assert.equal(plan[2].label, 'D')
})

test('planOptionImageCrops returns [] without a page asset', () => {
  assert.deepEqual(planOptionImageCrops({ optionsAreImages: true, optionImageBoxes: [{ x: 0, y: 0, w: 0.3, h: 0.3 }] }, null), [])
})

test('planOptionImageCrops returns [] for a text-option question', () => {
  assert.deepEqual(planOptionImageCrops({ optionsAreImages: false, optionImageBoxes: null }, pageAsset), [])
})

test('buildScannedSummary counts per-option images', () => {
  const summary = buildScannedSummary({
    sections: [
      { kind: 'standalone', question: { optionMedia: [{ imageAssetId: 'a' }, { imageAssetId: 'b' }, null, null] } },
    ],
    fileName: 'maths.pdf',
    pageCount: 12,
  })
  assert.equal(summary.images, 2)
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
