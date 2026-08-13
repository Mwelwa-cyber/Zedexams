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
  planDiagramCrops,
  diagramReviewNote,
  countDetectedDiagrams,
  normaliseDiagramHandling,
  DEFAULT_DIAGRAM_HANDLING,
  findMissingQuestionNumbers,
  pagesForMissingNumbers,
  formatMissingList,
  isImageImportFile,
  normalizeImportInput,
  runVisionImport,
  buildReviewPageImages,
  groupSectionsIntoParts,
  reconcileLayoutCoverage,
  mapWithConcurrency,
  SCANNED_BATCH_CONCURRENCY,
  isRetryableImportError,
  readBatchResilient,
  formatPageList,
  isSameQuestionRead,
  mergeQuestionReads,
  findZeroYieldPages,
} from './scannedQuizImporter.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function testAsync(name, fn) {
  await fn()
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

test('buildReviewPageImages mints one review URL per page blob (browser only)', () => {
  // No URL.createObjectURL in plain node → empty map (degrades safely).
  const hadCreate = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
  if (!hadCreate) {
    assert.deepEqual(buildReviewPageImages({ 1: { blob: {} } }), {})
  }
  // Stub createObjectURL to assert the per-page mapping.
  const realURL = globalThis.URL
  let n = 0
  globalThis.URL = { createObjectURL: () => `blob:fake-${++n}` }
  try {
    const map = buildReviewPageImages({ 1: { blob: {} }, 2: { blob: {} }, 3: { /* no blob */ } })
    assert.equal(map['1'], 'blob:fake-1')
    assert.equal(map['2'], 'blob:fake-2')
    assert.equal(map['3'], undefined) // a page with no blob has no preview
  } finally {
    globalThis.URL = realURL
  }
})

test('visionSectionsToLocal maps the backend question type + marks onto the editor', () => {
  const { sections } = visionSectionsToLocal(
    [
      // backend types fold to editor vocabulary: short_answer→short_answer,
      // true_false→tf, fill_blank→fill_blanks.
      { kind: 'standalone', question: { text: 'Explain photosynthesis.', options: [], type: 'short_answer', marks: 4 } },
      { kind: 'standalone', question: { text: 'The sun is a star.', options: ['True', 'False'], type: 'true_false' } },
      { kind: 'standalone', question: { text: 'Water boils at ____.', options: [], type: 'fill_blank' } },
    ],
    {},
    fakeDeps,
  )
  assert.equal(sections[0].question.type, 'short_answer')
  assert.equal(sections[0].question.marks, 4)
  assert.deepEqual(sections[0].question.options, []) // written answer → no options
  assert.equal(sections[1].question.type, 'tf')
  assert.equal(sections[2].question.type, 'fill_blanks')
})

test('visionSectionsToLocal pre-populates matching columns + a word bank', () => {
  const { sections } = visionSectionsToLocal(
    [
      { kind: 'standalone', question: {
        text: 'Match the animal to its home.', options: [], type: 'matching',
        matchingLeft: ['Dog', 'Bird'], matchingRight: ['Kennel', 'Nest'],
      } },
      { kind: 'standalone', question: {
        text: 'The capital is ____.', options: [], type: 'fill_blank',
        wordBank: ['Lusaka', 'Ndola'],
      } },
    ],
    {},
    fakeDeps,
  )
  const match = sections[0].question
  assert.equal(match.type, 'matching')
  assert.deepEqual(match.matchingLeft, ['Dog', 'Bird'])
  assert.deepEqual(match.matchingRight, ['Kennel', 'Nest'])
  assert.deepEqual(match.matchingAnswer, [-1, -1]) // one blank slot per left item
  assert.deepEqual(sections[1].question.wordBank, ['Lusaka', 'Ndola'])
})

test('visionSectionsToLocal carries answer lines + section heading', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: {
      text: 'Describe the water cycle.', options: [], type: 'short_answer',
      answerLines: 6, sectionTitle: 'Section B',
    } }],
    {},
    fakeDeps,
  )
  const q = sections[0].question
  assert.equal(q.answerLines, 6)
  assert.equal(q.answerFormat, 'lines')
  assert.equal(q.sectionTitle, 'Section B')
})

test('groupSectionsIntoParts builds part groups from section headings', () => {
  const sections = [
    { kind: 'standalone', question: { text: 'Q1', sectionTitle: 'Section A' } },
    { kind: 'standalone', question: { text: 'Q2', sectionTitle: 'Section A' } },
    { kind: 'passage', passage: { title: 'Story', questions: [{ text: 'Q3' }] } }, // inherits A
    { kind: 'standalone', question: { text: 'Q4', sectionTitle: 'Section B' } },
  ]
  const { parts } = groupSectionsIntoParts(sections, {
    createPart: ({ title, order }) => ({ id: `part-${order}`, title }),
  })
  assert.deepEqual(parts.map(p => p.title), ['Section A', 'Section B'])
  // Q1, Q2 + the passage all sit in Section A; Q4 in Section B.
  assert.equal(sections[0].question.partId, 'part-0')
  assert.equal(sections[1].question.partId, 'part-0')
  assert.equal(sections[2].partId, 'part-0')
  assert.equal(sections[3].question.partId, 'part-1')
})

test('groupSectionsIntoParts makes no parts when the paper prints no headings', () => {
  const sections = [
    { kind: 'standalone', question: { text: 'Q1' } },
    { kind: 'standalone', question: { text: 'Q2' } },
  ]
  const { parts } = groupSectionsIntoParts(sections)
  assert.deepEqual(parts, [])
  assert.equal(sections[0].question.partId, undefined)
})

test('visionSectionsToLocal maps a diagram_label question to the identify diagram editor', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: {
      text: 'Label the parts of the plant.', options: [], type: 'diagram_label',
      diagramLabels: ['stem', 'roots', 'leaves'], hasDiagram: true, sourcePage: 1,
    } }],
    { pageAssetByNumber: { 1: { id: 'pg1', imageUrl: 'blob:p1', objectUrl: 'blob:p1', sourcePage: 1 } } },
    fakeDeps,
  )
  const q = sections[0].question
  // Stored as the editor's `diagram` type in identify mode (that's what
  // surfaces the label-layer editor), not the raw 'diagram_label' string.
  assert.equal(q.type, 'diagram')
  assert.equal(q.diagramMode, 'identify')
  assert.equal(q.diagramLabels.length, 3)
  assert.deepEqual(q.diagramLabels.map(l => l.text), ['stem', 'roots', 'leaves'])
  // Each label has 0..1 placement ratios so it renders as a leader line.
  q.diagramLabels.forEach(l => {
    assert.ok(l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1)
  })
  assert.deepEqual(q.options, []) // not a choice question
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

// ── Diagram handling (detection → crop plan → placement) ─────────────────────

const diagram = (over = {}) => ({ box: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, kind: 'shape', classification: 'recreate', confidence: 0.8, caption: '', ...over })

test('normaliseDiagramHandling defaults to keep and rejects junk', () => {
  assert.equal(DEFAULT_DIAGRAM_HANDLING, 'keep')
  assert.equal(normaliseDiagramHandling('clean'), 'clean')
  assert.equal(normaliseDiagramHandling('text'), 'text')
  assert.equal(normaliseDiagramHandling('ask'), 'ask')
  assert.equal(normaliseDiagramHandling('nonsense'), 'keep')
  assert.equal(normaliseDiagramHandling(undefined), 'keep')
})

test('planDiagramCrops plans one crop per boxed diagram, largest first', () => {
  const plan = planDiagramCrops(
    { diagrams: [
      diagram({ box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, kind: 'shape' }),
      diagram({ box: { x: 0.1, y: 0.4, w: 0.6, h: 0.6 }, kind: 'map', classification: 'preserve' }),
    ] },
    pageAsset,
  )
  assert.equal(plan.length, 2)
  assert.equal(plan[0].kind, 'map') // bigger box leads
  assert.equal(plan[0].classification, 'preserve')
})

test('planDiagramCrops returns [] without a page asset or boxes', () => {
  assert.deepEqual(planDiagramCrops({ diagrams: [diagram()] }, null), [])
  assert.deepEqual(planDiagramCrops({ diagrams: [{ kind: 'map' }] }, pageAsset), [])
  assert.deepEqual(planDiagramCrops({}, pageAsset), [])
})

test('diagramReviewNote describes each classification + the cleaned case', () => {
  assert.match(diagramReviewNote('preserve'), /image/i)
  assert.match(diagramReviewNote('recreate'), /recreate/i)
  assert.match(diagramReviewNote('review'), /review/i)
  assert.match(diagramReviewNote('clean'), /clean|replace/i)
  assert.match(diagramReviewNote('preserve', { cleaned: true }), /cleaned/i)
})

test('countDetectedDiagrams totals figures across questions + shared maps', () => {
  const n = countDetectedDiagrams([
    { kind: 'standalone', question: { diagrams: [diagram(), diagram()] } },
    { kind: 'passage', diagrams: [diagram()], questions: [{ diagrams: [diagram()] }, { diagrams: [] }] },
  ])
  assert.equal(n, 4)
})

test('visionSectionsToLocal (keep) carries detected diagrams onto the question', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: mcq({ text: 'Name part A', hasDiagram: true, sourcePage: 3, diagrams: [diagram({ kind: 'labelled_science', classification: 'preserve' })] }) }],
    { diagramHandling: 'keep', pageAssetByNumber: {} },
    fakeDeps,
  )
  assert.equal(sections[0].question.detectedDiagrams.length, 1)
  // A croppable box is present, so we do NOT pre-attach the whole page —
  // attachQuestionDiagrams (DOM) crops the precise figure instead.
  assert.ok(!sections[0].question.imageAssetId)
})

test('visionSectionsToLocal (text) drops diagrams entirely', () => {
  const asset = { id: 'page-3', imageUrl: 'blob:p3', objectUrl: 'blob:p3' }
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: mcq({ text: 'Name part A', hasDiagram: true, sourcePage: 3, diagrams: [diagram()] }) }],
    { diagramHandling: 'text', pageAssetByNumber: { 3: asset } },
    fakeDeps,
  )
  assert.equal(sections[0].question.detectedDiagrams, undefined)
  assert.ok(!sections[0].question.imageAssetId)
  assert.ok(!sections[0].question.imageUrl)
})

test('visionSectionsToLocal falls back to the whole page when a flagged figure has no box', () => {
  const asset = { id: 'page-5', imageUrl: 'blob:fig', objectUrl: 'blob:fig' }
  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: mcq({ text: 'Study the figure', hasDiagram: true, sourcePage: 5, diagrams: [] }) }],
    { diagramHandling: 'keep', pageAssetByNumber: { 5: asset } },
    fakeDeps,
  )
  assert.equal(sections[0].question.imageAssetId, 'page-5')
})

test('visionSectionsToLocal (keep) carries a shared map diagram onto the passage', () => {
  const { sections } = visionSectionsToLocal(
    [{ kind: 'passage', passageKind: 'map', title: 'Map', hasImage: true, sourcePage: 2, diagrams: [diagram({ kind: 'map', classification: 'preserve' })], questions: [mcq()] }],
    { diagramHandling: 'keep', pageAssetByNumber: {} },
    fakeDeps,
  )
  assert.equal(sections[0].passage.detectedDiagrams.length, 1)
  assert.equal(sections[0].passage.sourcePage, 2)
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

// ── findMissingQuestionNumbers / formatMissingList ──────────────────────────

const rawStandalone = (n) => ({ kind: 'standalone', question: { sourceQuestionNumber: n } })
const rawPassage = (...ns) => ({ kind: 'passage', questions: ns.map(n => ({ sourceQuestionNumber: n })) })

test('findMissingQuestionNumbers reports gaps in the printed sequence', () => {
  // 1..10 present except 4 and 7.
  const present = [1, 2, 3, 5, 6, 8, 9, 10]
  const missing = findMissingQuestionNumbers(present.map(rawStandalone))
  assert.deepEqual(missing, [4, 7])
})

test('findMissingQuestionNumbers spans standalone + passage questions', () => {
  const sections = [
    rawStandalone(1),
    rawPassage(2, 3, 5), // 4 missing
    rawStandalone(6),
  ]
  assert.deepEqual(findMissingQuestionNumbers(sections), [4])
})

test('findMissingQuestionNumbers returns [] for a complete 1..N run', () => {
  const sections = Array.from({ length: 12 }, (_, i) => rawStandalone(i + 1))
  assert.deepEqual(findMissingQuestionNumbers(sections), [])
})

test('findMissingQuestionNumbers stays quiet when too few numbers to trust', () => {
  assert.deepEqual(findMissingQuestionNumbers([rawStandalone(40)]), [])
  assert.deepEqual(findMissingQuestionNumbers([]), [])
})

test('findMissingQuestionNumbers ignores questions with no printed number', () => {
  const sections = [rawStandalone(1), rawStandalone(2), rawStandalone(3), { kind: 'standalone', question: {} }]
  assert.deepEqual(findMissingQuestionNumbers(sections), [])
})

// ── pagesForMissingNumbers (cross-batch gap recovery targeting) ─────────────

const rawStandaloneOn = (n, page) => ({ kind: 'standalone', question: { sourceQuestionNumber: n, sourcePage: page } })

test('pagesForMissingNumbers maps a missing block to the pages between its neighbours', () => {
  // Captured: Q1-3 on page 1, Q4-6 on page 2, then a jump to Q10 on page 4.
  // Q7,8,9 are missing — they live between page 2 (Q6) and page 4 (Q10).
  const sections = [
    rawStandaloneOn(1, 1), rawStandaloneOn(2, 1), rawStandaloneOn(3, 1),
    rawStandaloneOn(4, 2), rawStandaloneOn(5, 2), rawStandaloneOn(6, 2),
    rawStandaloneOn(10, 4), rawStandaloneOn(11, 4),
  ]
  assert.deepEqual(pagesForMissingNumbers(sections, [7, 8, 9]), [2, 3, 4])
})

test('pagesForMissingNumbers covers the user-reported contiguous tail block', () => {
  // 60-question paper, ~6 per page. Q1-42 captured (pages 1-7), Q56-60 captured
  // (pages 10). Q43-55 (the missing block) sit between page 7 and page 10.
  const sections = []
  for (let n = 1; n <= 42; n += 1) sections.push(rawStandaloneOn(n, Math.ceil(n / 6)))
  for (let n = 56; n <= 60; n += 1) sections.push(rawStandaloneOn(n, 10))
  const missing = []
  for (let n = 43; n <= 55; n += 1) missing.push(n)
  const pages = pagesForMissingNumbers(sections, missing)
  // The gap spans page 7 (last seen, Q42) through page 10 (first seen, Q56).
  assert.deepEqual(pages, [7, 8, 9, 10])
})

test('pagesForMissingNumbers extends to the last page for a missing number above all anchors', () => {
  const sections = [rawStandaloneOn(1, 1), rawStandaloneOn(2, 1), rawStandaloneOn(3, 2)]
  // Q5 is above the highest captured number (3 on page 2) → re-scan up to the last page.
  assert.deepEqual(pagesForMissingNumbers(sections, [5]), [2])
})

test('pagesForMissingNumbers returns [] with no usable anchors', () => {
  assert.deepEqual(pagesForMissingNumbers([], [3]), [])
  // Anchors with no sourcePage can't be located → nothing to re-scan.
  assert.deepEqual(pagesForMissingNumbers([{ kind: 'standalone', question: { sourceQuestionNumber: 1 } }], [2]), [])
})

test('formatMissingList truncates a long list with a count', () => {
  assert.equal(formatMissingList([4, 7]), '4, 7')
  assert.equal(formatMissingList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8), '1, 2, 3, 4, 5, 6, 7, 8 and 2 more')
  assert.equal(formatMissingList([]), '')
})

// ── isImageImportFile / normalizeImportInput (picture import routing) ────────

test('isImageImportFile detects pictures by MIME and by extension', () => {
  assert.equal(isImageImportFile({ type: 'image/jpeg', name: 'q.jpg' }), true)
  assert.equal(isImageImportFile({ type: 'image/png', name: 'q.png' }), true)
  assert.equal(isImageImportFile({ type: 'image/webp', name: 'q.webp' }), true)
  // Phone photos sometimes arrive with no MIME — fall back to the extension.
  assert.equal(isImageImportFile({ type: '', name: 'IMG_0042.JPG' }), true)
  // Documents and unsupported pictures are not image imports.
  assert.equal(isImageImportFile({ type: 'application/pdf', name: 'paper.pdf' }), false)
  assert.equal(isImageImportFile({ type: '', name: 'paper.docx' }), false)
  assert.equal(isImageImportFile({ type: '', name: 'photo.heic' }), false)
  assert.equal(isImageImportFile(null), false)
})

test('normalizeImportInput wraps a single file, filters falsy, passes arrays', () => {
  const f = { name: 'a.jpg' }
  assert.deepEqual(normalizeImportInput(f), [f])
  assert.deepEqual(normalizeImportInput([f, null, undefined]), [f])
  assert.deepEqual(normalizeImportInput(null), [])
  assert.deepEqual(normalizeImportInput([]), [])
})

// ── runVisionImport (shared scanned-PDF + picture pipeline) ─────────────────

await testAsync('runVisionImport batches, blanks answers, and flags for review', async () => {
  const calls = []
  const callVision = async (payload) => {
    calls.push(payload)
    return {
      detectedCount: 2,
      sections: [
        { kind: 'standalone', question: mcq({ text: 'What is 2+2?', sourceQuestionNumber: 1, correctAnswer: 2 }) },
        { kind: 'standalone', question: mcq({ text: 'Capital of Zambia?', sourceQuestionNumber: 2, correctAnswer: 0 }) },
      ],
    }
  }

  const progress = []
  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'photo.jpg' },
    callVision,
    onProgress: e => progress.push(e),
    sourceNoun: 'image',
  })

  // One page → one batch → one vision call carrying the page + file name.
  assert.equal(calls.length, 1)
  assert.equal(calls[0].fileName, 'photo.jpg')
  assert.equal(calls[0].pages.length, 1)

  assert.equal(out.sections.length, 2)
  // Answers are always blanked regardless of what the model returned.
  assert.equal(out.sections[0].question.correctAnswer, '')
  assert.equal(out.sections[0].question.requiresReview, true)
  assert.equal(out.pageCount, 1)
  assert.equal(out.summary.scanned, true)
  assert.equal(out.summary.questions, 2)
  assert.ok(out.warnings.some(w => /Answers were left blank/i.test(w)))
  assert.ok(progress.some(e => e.phase === 'reading'))
})

await testAsync('runVisionImport reconciles against declared Part ranges: drops the phantom, fills a stem-less item, groups Parts', async () => {
  // A tiny 3-question paper the model over-read as 4, with a declared parts
  // array: Part 1 (Q1-2, meaning questions with real stems) + Part 2 (Q3,
  // spelling item with NO stem — the four choices are the question).
  const callVision = async () => ({
    detectedCount: 4,
    parts: [
      { label: 'Part 1', sectionTitle: 'Section A', firstNumber: 1, lastNumber: 2, instruction: 'Choose the word that completes the sentence.' },
      { label: 'Part 2', sectionTitle: 'Section A', firstNumber: 3, lastNumber: 3, instruction: 'Choose the correctly spelled word.' },
    ],
    sections: [
      { kind: 'standalone', question: mcq({ text: 'The girl can sing … she cannot dance.', sourceQuestionNumber: 1, sectionTitle: 'Section A' }) },
      { kind: 'standalone', question: mcq({ text: 'A … of girls was found.', sourceQuestionNumber: 2, sectionTitle: 'Section A' }) },
      // Q3: no stem — spelling choices are the options; carries the shared instruction.
      { kind: 'standalone', question: { text: '', options: ['tributaly', 'tributary', 'tributely', 'tributery'], sourceQuestionNumber: 3, sectionTitle: 'Section A', sharedInstruction: 'Choose the correctly spelled word.' } },
      // Phantom: a number outside every declared range → must be dropped.
      { kind: 'standalone', question: mcq({ text: 'Hallucinated extra', sourceQuestionNumber: 44, sectionTitle: 'Section A' }) },
    ],
  })

  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'psle-english.jpg' },
    callVision,
    sourceNoun: 'image',
  })

  // The phantom (#44, outside declared 1-3) is dropped → 3 questions remain.
  assert.equal(out.sections.length, 3, 'phantom question removed via declared-range reconciliation')
  assert.ok(out.warnings.some(w => /Removed 1 extra question/i.test(w)), 'over-count removal is surfaced honestly')

  // The stem-less spelling item now reads as a real question. Tags are
  // stripped to a fixpoint so removals can't reassemble a tag ("<p<x>>").
  const stripTags = (v) => {
    let out = String(v)
    let prev
    do {
      prev = out
      out = out.replace(/<[^>]*>/g, '')
    } while (out !== prev)
    return out
  }
  const spelling = out.sections.find(s => (s.question?.options || []).some(o => /tributary/.test(stripTags(o))))
  assert.ok(spelling, 'spelling item survived')
  const stem = stripTags(spelling.question.text).trim()
  assert.equal(stem, 'Choose the correctly spelled word.', 'the Part instruction became the question stem')
  assert.ok(out.warnings.some(w => /instruction was used as the question/i.test(w)), 'stem-fill surfaced to the teacher')

  // Parts were rebuilt from the reconciled labels, carrying their instruction.
  assert.ok(out.parts.length >= 1, 'Part groups were created')
  assert.ok(out.parts.some(p => /Questions 3–3/.test(p.title) || /Questions 1–2/.test(p.title)), 'Parts labelled with their printed ranges')
  assert.ok(out.parts.some(p => /correctly spelled|completes the sentence/i.test(String(p.instructions || ''))), 'Part instruction carried onto the group')
})

await testAsync('runVisionImport reports the source noun when nothing is read', async () => {
  const callVision = async () => ({ detectedCount: 0, sections: [] })
  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'blank.png' },
    callVision,
    sourceNoun: 'image',
  })
  assert.equal(out.sections.length, 0)
  assert.ok(out.warnings.some(w => /No questions could be read from this image/i.test(w)))
})

await testAsync('runVisionImport recovers a dropped block by re-scanning its pages', async () => {
  // Simulate the user-reported failure: the FIRST full pass drops the
  // contiguous block Q3-Q4 (a batch "summarised" a page), leaving 1,2,5,6.
  // The recovery pass re-scans the pages around the gap and returns Q3, Q4.
  const page = (pageNumber) => ({ pageNumber, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })

  let call = 0
  const seenPages = []
  const callVision = async ({ pages }) => {
    call += 1
    seenPages.push(pages.map(p => p.pageNumber))
    if (call === 1) {
      // First pass over all pages — drops Q3 and Q4.
      return { detectedCount: 6, sections: [q(1, 1), q(2, 1), q(5, 2), q(6, 2)] }
    }
    // Recovery pass — re-scans the gap pages and finds the missing block.
    return { detectedCount: 2, sections: [q(3, 1), q(4, 2)] }
  }

  const out = await runVisionImport({
    pageImages: [page(1), page(2)],
    assetByPage: {},
    file: { name: 'social.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })

  assert.ok(call >= 2, 'a recovery pass must run when numbers are missing')
  const numbers = out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b)
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6], 'the dropped block must be recovered')
  // No "missing questions" warning survives once the gap is closed.
  assert.ok(!out.warnings.some(w => /appear to be missing/i.test(w)), 'no missing-number warning after recovery')
})

await testAsync('runVisionImport stops recovering when a pass finds nothing new', async () => {
  // The gap can't be read no matter how many times we re-scan — the loop must
  // bound itself rather than burn the AI meter forever.
  const page = (pageNumber) => ({ pageNumber, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  let call = 0
  const callVision = async () => {
    call += 1
    // Always returns the same incomplete set (Q4 never comes back).
    return { detectedCount: 5, sections: [q(1, 1), q(2, 1), q(3, 2), q(5, 2)] }
  }
  const out = await runVisionImport({
    pageImages: [page(1), page(2)],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  // 1 first pass + exactly 1 recovery pass (which recovered nothing) → stop.
  assert.equal(call, 2, 'recovery must stop after a fruitless pass, not loop')
  assert.ok(out.warnings.some(w => /appear to be missing/i.test(w)), 'still warns about the genuinely unreadable gap')
})

await testAsync('runVisionImport surfaces the server engine version (deploy is observable)', async () => {
  const callVision = async () => ({
    detectedCount: 1,
    engineVersion: '2026.06.30-numrecovery',
    sections: [{ kind: 'standalone', question: mcq({ text: 'Q1', sourceQuestionNumber: 1 }) }],
  })
  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'p.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  assert.equal(out.engineVersion, '2026.06.30-numrecovery')
  assert.equal(out.summary.engineVersion, '2026.06.30-numrecovery')
  // The client importer always stamps its own version too.
  assert.ok(out.summary.importerVersion, 'importer version is always present')
})

await testAsync('runVisionImport reports an EMPTY engine version when the function is stale', async () => {
  // A deployed function running OLD code returns no engineVersion field — the
  // editor must surface that as "stale", never silently treat it as current.
  const callVision = async () => ({
    detectedCount: 1,
    sections: [{ kind: 'standalone', question: mcq({ text: 'Q1', sourceQuestionNumber: 1 }) }],
  })
  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'p.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  assert.equal(out.engineVersion, '', 'no version from an old function → empty, surfaced as stale')
  assert.equal(out.summary.engineVersion, '')
})

await testAsync('runVisionImport throws when there are no page images', async () => {
  await assert.rejects(
    () => runVisionImport({ pageImages: [], callVision: async () => ({ sections: [] }), sourceNoun: 'image' }),
    /image pages could be read/i,
  )
})

// ── layout-first pass (Phase 1) ──────────────────────────────────────────────
test('reconcileLayoutCoverage warns when the layout saw more tables than captured', () => {
  const sections = [{ kind: 'standalone', question: { diagrams: [] } }]
  const warning = reconcileLayoutCoverage(sections, { tables: 3, diagrams: 0 })
  assert.ok(warning && /may have been missed/i.test(warning))
})

test('reconcileLayoutCoverage is silent within the slack', () => {
  const sections = [{ kind: 'standalone', question: { diagrams: [{ box: {} }] } }]
  // Saw 2, captured 1 → within the 1-object slack.
  assert.equal(reconcileLayoutCoverage(sections, { tables: 2 }), null)
})

test('reconcileLayoutCoverage returns null with no layout summary', () => {
  assert.equal(reconcileLayoutCoverage([], null), null)
})

await testAsync('mapWithConcurrency preserves order and caps in-flight work', async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10)
  assert.deepEqual(out, [10, 20, 30, 40, 50])
})

await testAsync('runVisionImport runs the optional layout pass and reconciles coverage', async () => {
  const layoutCalls = []
  const callVision = async () => ({
    detectedCount: 1,
    sections: [{ kind: 'standalone', question: mcq({ text: 'Q1', sourceQuestionNumber: 1 }) }],
  })
  const callLayout = async (dataUrl) => {
    layoutCalls.push(dataUrl)
    return { summary: { tables: 3, diagrams: 0, questions: 1 } }
  }
  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'p.jpg' },
    callVision,
    callLayout,
    sourceNoun: 'image',
  })
  assert.equal(layoutCalls.length, 1) // layout ran once per page
  assert.ok(out.warnings.some(w => /may have been missed/i.test(w)))
})

await testAsync('runVisionImport ignores a failing layout pass (advisory)', async () => {
  const callVision = async () => ({
    detectedCount: 1,
    sections: [{ kind: 'standalone', question: mcq({ text: 'Q1', sourceQuestionNumber: 1 }) }],
  })
  const callLayout = async () => { throw new Error('layout down') }
  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'p.jpg' },
    callVision,
    callLayout,
    sourceNoun: 'image',
  })
  // Import still succeeds; no layout reconciliation warning.
  assert.equal(out.sections.length, 1)
  assert.ok(!out.warnings.some(w => /may have been missed/i.test(w)))
})

// ── Per-batch resilience + metering (the "upload cuts off on its own" fix) ──

await testAsync('runVisionImport keeps successful batches when one reading batch fails', async () => {
  // 7 pages → 2 reading batches. The 2nd batch fails (timeout / rate-limit /
  // daily-cap / App Check). The questions read by the 1st batch MUST survive
  // rather than the whole import being discarded (the reported "cut off").
  const page = (pageNumber) => ({ pageNumber, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: 1 }) })
  let call = 0
  const callVision = async () => {
    call += 1
    if (call === 1) return { detectedCount: 3, sections: [q(1), q(2), q(3)] }
    throw new Error('Reading the scanned pages is taking too long.')
  }

  const out = await runVisionImport({
    pageImages: [page(1), page(2), page(3), page(4), page(5), page(6), page(7)],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })

  // The first batch's questions survive the second batch's failure.
  assert.deepEqual(
    out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b),
    [1, 2, 3],
    'questions from the batch that read fine are kept',
  )
  // A clear partial-import warning naming the failure reason is surfaced.
  assert.ok(
    out.warnings.some(w => /could not be read/i.test(w) && /taking too long/i.test(w)),
    'partial-failure warning surfaced with the real reason',
  )
})

await testAsync('runVisionImport throws the real reason when every batch fails', async () => {
  // When nothing reads, surface WHY (daily limit, App Check, permission) so a
  // config/quota problem is visible instead of a silent blank cutoff.
  const callVision = async () => { throw new Error('Daily AI limit reached. Please try again tomorrow.') }
  await assert.rejects(
    () => runVisionImport({
      pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
      assetByPage: {},
      file: { name: 'paper.pdf' },
      callVision,
      sourceNoun: 'scanned paper',
    }),
    /Daily AI limit reached/i,
    'the underlying failure reason is bubbled up',
  )
})

// ── Batch concurrency (the "import takes forever" perf fix) ──────────────────

await testAsync('runVisionImport reads batches concurrently, bounded by SCANNED_BATCH_CONCURRENCY', async () => {
  // 10 pages → chunkPages(10,4,1) = 4 batches. The old importer read them one at
  // a time; now a small window runs at once so a long paper doesn't wait on
  // every vision call back-to-back. Assert we DO overlap (max in-flight > 1) but
  // never exceed the cap.
  const pages = Array.from({ length: 10 }, (_, i) => ({ pageNumber: i + 1, dataUrl: 'data:image/jpeg;base64,AAAA' }))
  let inFlight = 0
  let maxInFlight = 0
  const callVision = async ({ pages: batchPages }) => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    // Yield across a macrotask so overlapping calls actually pile up.
    await new Promise(resolve => setTimeout(resolve, 5))
    inFlight -= 1
    const first = batchPages[0].pageNumber
    return {
      detectedCount: batchPages.length,
      sections: batchPages.map(p => ({
        kind: 'standalone',
        question: mcq({ text: `Question ${p.pageNumber}`, sourceQuestionNumber: p.pageNumber, sourcePage: p.pageNumber }),
      })),
      // keep the batch id observable for debugging on failure
      _firstPage: first,
    }
  }
  const out = await runVisionImport({
    pageImages: pages,
    assetByPage: {},
    file: { name: 'long.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  assert.ok(maxInFlight > 1, `batches should overlap (saw max ${maxInFlight} in flight)`)
  assert.ok(maxInFlight <= SCANNED_BATCH_CONCURRENCY, `never exceed the cap (saw ${maxInFlight} > ${SCANNED_BATCH_CONCURRENCY})`)
  // Every printed question still lands, regardless of read order.
  const nums = out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b)
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'all questions survive concurrent reads')
})

// ── Per-page retry ladder (the "one group of pages could not be read" fix) ──

test('isRetryableImportError: timeouts/deadlines retry, hard failures do not', () => {
  assert.equal(isRetryableImportError(Object.assign(new Error('slow'), { code: 'timeout' })), true)
  assert.equal(isRetryableImportError(Object.assign(new Error('x'), { code: 'functions/deadline-exceeded' })), true)
  assert.equal(isRetryableImportError(Object.assign(new Error('x'), { code: 'functions/internal' })), true)
  assert.equal(isRetryableImportError(Object.assign(new Error('x'), { code: 'functions/permission-denied' })), false)
  assert.equal(isRetryableImportError(Object.assign(new Error('x'), { code: 'functions/failed-precondition' })), false)
  // Message-only errors (the friendly-error wrapper strips codes on old paths):
  assert.equal(isRetryableImportError(new Error('Daily AI limit reached. Please try again tomorrow.')), false)
  assert.equal(isRetryableImportError(new Error('Reading the scanned pages is taking too long.')), true)
})

// B3/OBS-005 regression fix: a scanned import fires ~40 structureScannedQuiz
// calls, so a resource-exhausted BURST throttle must be RETRYABLE (paced +
// retried, never dropped) — but a DAILY-quota / MONTHLY-budget exhaustion must
// stay terminal. The two are distinguished by the backend's structured reason.
test('isRetryableImportError: burst throttle retries, daily/budget quota does not', () => {
  const err = (details) => Object.assign(new Error('x'), { code: 'functions/resource-exhausted', details })
  // Explicit burst throttle → retryable.
  assert.equal(isRetryableImportError(err({ reason: 'burst_rate_limit', retryAfterSec: 30 })), true)
  // Bare resource-exhausted (older backend / no details) → treated as burst → retryable.
  assert.equal(isRetryableImportError(Object.assign(new Error('x'), { code: 'functions/resource-exhausted' })), true)
  // Daily quota exhaustion → terminal, NOT retried.
  assert.equal(isRetryableImportError(err({ reason: 'daily_quota_exhausted' })), false)
  // Monthly budget exhaustion → terminal.
  assert.equal(isRetryableImportError(err({ reason: 'monthly_budget_exhausted' })), false)
})

await testAsync('readBatchResilient splits a timed-out batch into per-page reads', async () => {
  // The exact production failure: the 4-page batch always times out (too much
  // work for one call) but each page reads fine on its own.
  const pages = [1, 2, 3, 4].map(pageNumber => ({ pageNumber, dataUrl: 'd' }))
  const calls = []
  const readPages = async (batch) => {
    calls.push(batch.map(p => p.pageNumber))
    if (batch.length > 1) throw Object.assign(new Error('too slow'), { code: 'functions/deadline-exceeded' })
    return { sections: [{ kind: 'standalone', question: mcq({ text: `P${batch[0].pageNumber}`, sourceQuestionNumber: batch[0].pageNumber }) }] }
  }
  const { results, failedPages } = await readBatchResilient(pages, readPages)
  assert.deepEqual(calls[0], [1, 2, 3, 4], 'full batch tried first')
  assert.equal(results.length, 4, 'every page recovered individually')
  assert.deepEqual(failedPages, [], 'no page left unread')
})

await testAsync('readBatchResilient retries a flaky single page once, then reports it', async () => {
  const pages = [{ pageNumber: 1, dataUrl: 'd' }, { pageNumber: 2, dataUrl: 'd' }]
  let page2Attempts = 0
  const readPages = async (batch) => {
    if (batch.length > 1) throw Object.assign(new Error('slow'), { code: 'timeout' })
    if (batch[0].pageNumber === 2) {
      page2Attempts += 1
      throw Object.assign(new Error('slow'), { code: 'timeout' })
    }
    return { sections: [] }
  }
  const { results, failedPages } = await readBatchResilient(pages, readPages)
  assert.equal(results.length, 1, 'page 1 read fine')
  assert.equal(page2Attempts, 2, 'the failing page gets exactly one extra attempt')
  assert.deepEqual(failedPages, [2], 'the genuinely unreadable page is reported')
})

await testAsync('readBatchResilient does NOT split on a hard failure (daily limit)', async () => {
  const pages = [1, 2, 3].map(pageNumber => ({ pageNumber, dataUrl: 'd' }))
  let calls = 0
  const readPages = async () => {
    calls += 1
    // Daily-quota exhaustion carries the structured reason → genuinely terminal
    // (a bare burst throttle, by contrast, is now retryable and DOES split).
    throw Object.assign(new Error('Daily AI limit reached.'),
      { code: 'functions/resource-exhausted', details: { reason: 'daily_quota_exhausted' } })
  }
  const { results, failedPages, errors } = await readBatchResilient(pages, readPages)
  assert.equal(calls, 1, 'a non-retryable failure must not trigger per-page retries')
  assert.equal(results.length, 0)
  assert.deepEqual(failedPages, [1, 2, 3])
  assert.match(errors[0].message, /Daily AI limit/)
})

await testAsync('accounting invariant: every submitted page is either read or failed, never both/neither', async () => {
  // The guard against the "import silently drops pages" class of bug: after the
  // resilient reader runs, the submitted pages must PARTITION exactly into
  // processed (produced a result) + failed (surfaced in failedPages). No page
  // may vanish (counted as neither) and none may be double-counted (both).
  const submitted = [1, 2, 3, 4, 5]
  const pages = submitted.map(pageNumber => ({ pageNumber, dataUrl: 'd' }))
  // Whole batch always times out → splits to per-page. Pages 3 and 5 never
  // recover (terminal after the one retry); the rest read fine.
  const readPages = async (batch) => {
    if (batch.length > 1) throw Object.assign(new Error('slow'), { code: 'timeout' })
    const n = batch[0].pageNumber
    if (n === 3 || n === 5) throw Object.assign(new Error('slow'), { code: 'timeout' })
    // Tag the result with the page it covers so we can reconstruct coverage.
    return { _pages: [n], sections: [] }
  }
  const { results, failedPages } = await readBatchResilient(pages, readPages)

  const readPageNumbers = results.flatMap(r => r._pages || [])
  const readSet = new Set(readPageNumbers)
  const failedSet = new Set(failedPages)

  // Disjoint: no page is both read and failed.
  for (const n of readSet) assert.ok(!failedSet.has(n), `page ${n} counted as both read and failed`)
  // Complete: union covers every submitted page (submitted = processed + failed).
  const union = new Set([...readSet, ...failedSet])
  assert.equal(union.size, submitted.length, 'a submitted page is unaccounted for')
  for (const n of submitted) assert.ok(union.has(n), `page ${n} vanished from the accounting`)
  assert.deepEqual([...failedSet].sort(), [3, 5], 'only the genuinely unreadable pages are pending/failed')
})

test('formatPageList reads naturally', () => {
  assert.equal(formatPageList([]), '')
  assert.equal(formatPageList([5]), 'page 5')
  assert.equal(formatPageList([7, 5, 5, 6]), 'pages 5, 6 and 7')
})

await testAsync('runVisionImport recovers a whole timed-out batch page by page (nothing missing)', async () => {
  // Regression for the production report: pages 5-7's batch times out on every
  // re-import, leaving a contiguous block of questions missing. The retry
  // ladder must degrade that batch to single-page reads and import EVERYTHING.
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  const callVision = async ({ pages }) => {
    const nums = pages.map(p => p.pageNumber)
    // The second batch (pages 4-7) always dies as a group…
    if (nums.length > 1 && nums[0] >= 4) {
      throw Object.assign(new Error('The request is taking longer than usual.'), { code: 'functions/deadline-exceeded' })
    }
    // …but any single page (and the first batch) reads fine: 1 question per page.
    return { detectedCount: nums.length, sections: nums.map(n => q(n, n)) }
  }
  const out = await runVisionImport({
    pageImages: [1, 2, 3, 4, 5, 6, 7].map(page),
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  assert.deepEqual(
    out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7],
    'every page\'s questions survive the batch timeout',
  )
  assert.ok(!out.warnings.some(w => /could not be read/i.test(w)), 'no unread-pages warning once the retry recovered them')
  assert.ok(!out.warnings.some(w => /appear to be missing/i.test(w)), 'no missing-number warning either')
})

await testAsync('runVisionImport names the exact pages that stayed unreadable', async () => {
  // Pages 5-7 fail as a batch AND individually — the warning must name them
  // (not a vague "one group of pages") so the teacher knows what to fix.
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  const callVision = async ({ pages }) => {
    const nums = pages.map(p => p.pageNumber)
    if (nums.some(n => n >= 5)) {
      throw Object.assign(new Error('The request is taking longer than usual.'), { code: 'functions/deadline-exceeded' })
    }
    return { detectedCount: nums.length, sections: nums.map(n => q(n, n)) }
  }
  const out = await runVisionImport({
    pageImages: [1, 2, 3, 4, 5, 6, 7].map(page),
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  assert.deepEqual(
    out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b),
    [1, 2, 3, 4],
    'readable pages still import',
  )
  const unreadWarning = out.warnings.find(w => /could not be read/i.test(w))
  assert.ok(unreadWarning, 'unreadable pages are surfaced')
  assert.match(unreadWarning, /pages 5, 6 and 7/i, 'the warning names the exact pages')
})

// ── Duplicate OCR reads of the same printed question (the "Duplicate numbers:
// 42, 43…" + "Q42 has only 2 options" report) ────────────────────────────────

test('isSameQuestionRead matches drifted reads and rejects distinct questions', () => {
  const a = { sourceQuestionNumber: 42, sourcePage: 3, text: 'The diagram shows a simple circuit', options: ['cell', 'bulb'] }
  const b = { sourceQuestionNumber: 42, sourcePage: 3, text: 'The diagram below shows a simple circuit with a switch', options: ['cell', 'bulb', 'switch', 'wire'] }
  assert.equal(isSameQuestionRead(a, b), true, 'same number, same page, similar stem → same question')
  // Same number but pages far apart (a paper that restarts numbering per section).
  const c = { ...b, sourcePage: 9, text: 'A completely different question about rainfall', options: ['w', 'x', 'y', 'z'] }
  assert.equal(isSameQuestionRead(a, c), false, 'same number far apart in the paper → different questions')
  // Different numbers never match.
  assert.equal(isSameQuestionRead(a, { ...b, sourceQuestionNumber: 43 }), false)
  // An unreadable stem on the same page IS the same printed question.
  assert.equal(isSameQuestionRead(a, { sourceQuestionNumber: 42, sourcePage: 3, text: '', options: [] }), true)
})

test('mergeSectionBatches merges partial re-reads of the same question (no duplicate numbers)', () => {
  // Q42 read three times across the overlap + recovery: 2 options, then 3,
  // then all 4. The old merge kept all three (duplicate number 42, each
  // incomplete); now they collapse into ONE question with the fullest read.
  const read = (opts, extra = '') => ({
    kind: 'standalone',
    question: {
      text: `Which of these is a conductor${extra}?`,
      options: opts,
      sourceQuestionNumber: 42,
      sourcePage: 6,
    },
  })
  const { sections } = mergeSectionBatches([
    { sections: [read(['copper', 'wood'])] },
    { sections: [read(['copper', 'wood', 'glass'], ' of electricity')] },
    { sections: [read(['copper', 'wood', 'glass', 'rubber'])] },
  ])
  assert.equal(sections.length, 1, 'the three reads collapse into one question')
  assert.equal(sections[0].question.sourceQuestionNumber, 42)
  assert.deepEqual(
    sections[0].question.options,
    ['copper', 'wood', 'glass', 'rubber'],
    'the fullest option list wins',
  )
})

test('mergeSectionBatches back-fills an empty-stem read from the richer duplicate', () => {
  const blank = { kind: 'standalone', question: { text: '', options: [], sourceQuestionNumber: 7, sourcePage: 2 } }
  const full = { kind: 'standalone', question: { text: 'Name the shape drawn below.', options: ['circle', 'square', 'kite', 'oval'], sourceQuestionNumber: 7, sourcePage: 2 } }
  const { sections } = mergeSectionBatches([
    { sections: [blank] },
    { sections: [full] },
  ])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].question.text, 'Name the shape drawn below.')
  assert.equal(sections[0].question.options.length, 4)
})

test('mergeSectionBatches keeps same-number questions from far-apart pages (section restart)', () => {
  const secA = { kind: 'standalone', question: { text: 'Add 2 + 3', options: ['4', '5'], sourceQuestionNumber: 1, sourcePage: 1 } }
  const secB = { kind: 'standalone', question: { text: 'Write a composition about your school.', options: [], sourceQuestionNumber: 1, sourcePage: 8 } }
  const { sections } = mergeSectionBatches([
    { sections: [secA] },
    { sections: [secB] },
  ])
  assert.equal(sections.length, 2, 'numbering that restarts per section is preserved')
})

test('mergeQuestionReads ORs diagram/pictorial-option sightings across reads', () => {
  // The fuller read (4 options) missed the figure; the partial read saw it.
  // The merged question must keep BOTH the options and the diagram sighting.
  const kept = {
    text: 'Which container holds the most water?', options: ['jug', 'cup'],
    sourceQuestionNumber: 12, sourcePage: 4,
    hasDiagram: true, diagrams: [{ box: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 } }],
    optionsAreImages: true,
  }
  const incoming = {
    text: 'Which container holds the most water?', options: ['jug', 'cup', 'bucket', 'spoon'],
    sourceQuestionNumber: 12, sourcePage: 4,
    hasDiagram: false, diagrams: [],
    optionsAreImages: false,
  }
  mergeQuestionReads(kept, incoming)
  assert.equal(kept.options.length, 4, 'the fuller option list wins')
  assert.equal(kept.hasDiagram, true, 'the diagram sighting survives the merge')
  assert.equal(kept.diagrams.length, 1, 'the croppable diagram box survives')
  assert.equal(kept.optionsAreImages, true, 'the pictorial-options flag survives')
})

// ── Zero-yield page recovery (dropped block at the END of the paper) ─────────

test('findZeroYieldPages flags read-but-empty pages, honouring layout counts', () => {
  const sections = [
    { kind: 'standalone', question: { text: 'Q1', sourceQuestionNumber: 1, sourcePage: 2 } },
    { kind: 'passage', sourcePage: 3, questions: [{ text: 'Q2', sourceQuestionNumber: 2, sourcePage: 3 }] },
  ]
  // No layout: page 1 is assumed to be the cover; pages 4-5 are suspect.
  assert.deepEqual(findZeroYieldPages(sections, [1, 2, 3, 4, 5]), [4, 5])
  // Layout says page 4 has no questions (instructions page) → only page 5.
  const layout = new Map([[4, 0], [5, 6]])
  assert.deepEqual(findZeroYieldPages(sections, [1, 2, 3, 4, 5], { layoutQuestionsByPage: layout }), [5])
  // Pages already reported unreadable are excluded.
  assert.deepEqual(findZeroYieldPages(sections, [1, 2, 3, 4, 5], { excludePages: [4, 5] }), [])
  // No page attribution anywhere → no signal, no re-scan.
  assert.deepEqual(findZeroYieldPages([{ kind: 'standalone', question: { text: 'Q' } }], [1, 2, 3]), [])
})

await testAsync('runVisionImport recovers a block dropped at the END of the paper (no number gap)', async () => {
  // Questions 1-4 captured on pages 1-2; page 3 (holding Q5-Q6) yielded
  // nothing. There is NO gap between captured numbers, so the number-based
  // recovery never fires — the zero-yield pass must re-scan page 3.
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  const scannedPages = []
  const callVision = async ({ pages }) => {
    scannedPages.push(pages.map(p => p.pageNumber))
    const nums = pages.map(p => p.pageNumber)
    if (nums.length > 1) {
      // Full first pass: page 3's questions are silently dropped.
      return { detectedCount: 4, sections: [q(1, 1), q(2, 1), q(3, 2), q(4, 2)] }
    }
    // Focused single/small re-scan of page 3 finds its questions.
    return nums[0] === 3
      ? { detectedCount: 2, sections: [q(5, 3), q(6, 3)] }
      : { detectedCount: 0, sections: [] }
  }
  const out = await runVisionImport({
    pageImages: [page(1), page(2), page(3)],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    sourceNoun: 'scanned paper',
  })
  assert.deepEqual(
    out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6],
    'the tail block is recovered even though no printed number was "missing"',
  )
  assert.ok(scannedPages.some(nums => nums.length === 1 && nums[0] === 3), 'page 3 got a focused re-scan')
  assert.ok(!out.warnings.some(w => /No questions were found on/i.test(w)), 'no zero-yield warning once recovered')
})

await testAsync('runVisionImport warns about a page that still yields nothing after its re-scan', async () => {
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  const callVision = async ({ pages }) => {
    const nums = pages.map(p => p.pageNumber)
    if (nums.length > 1) return { detectedCount: 4, sections: [q(1, 1), q(2, 1), q(3, 2), q(4, 2)] }
    return { detectedCount: 0, sections: [] } // page 3 reads but yields nothing, twice
  }
  // Layout saw questions on page 3, so it is NOT dismissed as a cover page.
  const callLayout = async () => ({ summary: { tables: 0, diagrams: 0, questions: 2 } })
  const out = await runVisionImport({
    pageImages: [page(1), page(2), page(3)],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    callLayout,
    sourceNoun: 'scanned paper',
  })
  const warning = out.warnings.find(w => /No questions were found on page 3/i.test(w))
  assert.ok(warning, 'the still-empty page is named so the teacher can check it')
})

await testAsync('runVisionImport does not re-scan a cover page the layout says has no questions', async () => {
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  let visionCalls = 0
  const callVision = async () => {
    visionCalls += 1
    return { detectedCount: 2, sections: [q(1, 2), q(2, 2)] }
  }
  // Layout: page 1 is a cover (0 questions), page 2 has the questions.
  const callLayout = async (dataUrl) => ({
    summary: { tables: 0, diagrams: 0, questions: dataUrl.endsWith('COVER') ? 0 : 2 },
  })
  const out = await runVisionImport({
    pageImages: [
      { pageNumber: 1, dataUrl: 'data:image/jpeg;base64,COVER' },
      { pageNumber: 2, dataUrl: 'data:image/jpeg;base64,AAAA' },
    ],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    callLayout,
    sourceNoun: 'scanned paper',
  })
  assert.equal(visionCalls, 1, 'the cover page is not re-scanned')
  assert.equal(out.sections.length, 2)
  assert.ok(!out.warnings.some(w => /No questions were found on/i.test(w)))
})

await testAsync('a DEGRADED layout result does not suppress the zero-yield re-scan', async () => {
  // analyzePaperLayout returns { summary: { total: 0 }, degraded: true } on a
  // timeout — no `questions` field. That must NOT be recorded as "0 questions"
  // (which would wrongly mark the page confirmed-empty and skip its re-scan).
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  const scanned = []
  const callVision = async ({ pages }) => {
    const nums = pages.map(p => p.pageNumber)
    scanned.push(nums)
    if (nums.length > 1) return { detectedCount: 2, sections: [q(1, 1), q(2, 1)] } // page 2 dropped
    return nums[0] === 2 ? { detectedCount: 1, sections: [q(3, 2)] } : { detectedCount: 0, sections: [] }
  }
  // Layout times out on every page → degraded, no questions count.
  const callLayout = async () => ({ objects: [], summary: { total: 0 }, degraded: true })
  const out = await runVisionImport({
    pageImages: [page(1), page(2)],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    callLayout,
    sourceNoun: 'scanned paper',
  })
  assert.ok(scanned.some(nums => nums.length === 1 && nums[0] === 2), 'page 2 got a focused re-scan despite the degraded layout')
  assert.ok(out.sections.some(s => s.question.sourceQuestionNumber === 3), 'its question was recovered')
})

await testAsync('recovers pages when the FIRST pass returns nothing but layout saw questions', async () => {
  // Small paper: the single first-pass call comes back empty, but the layout
  // pass saw questions on page 1. Without all-empty recovery this falls through
  // to "no questions could be read"; with it, page 1 gets a focused re-scan.
  const page = (n) => ({ pageNumber: n, dataUrl: 'data:image/jpeg;base64,AAAA' })
  const q = (n, p) => ({ kind: 'standalone', question: mcq({ text: `Question ${n}`, sourceQuestionNumber: n, sourcePage: p }) })
  let call = 0
  const callVision = async ({ pages }) => {
    call += 1
    // First (whole-paper) pass returns nothing; the focused single-page re-scan finds them.
    if (call === 1) return { detectedCount: 0, sections: [] }
    return { detectedCount: 2, sections: [q(1, 1), q(2, 1)] }
  }
  const callLayout = async () => ({ summary: { tables: 0, diagrams: 0, questions: 2 } })
  const out = await runVisionImport({
    pageImages: [page(1)],
    assetByPage: {},
    file: { name: 'paper.pdf' },
    callVision,
    callLayout,
    sourceNoun: 'scanned paper',
  })
  assert.ok(call >= 2, 'an all-empty first pass still triggers a recovery re-scan')
  assert.deepEqual(
    out.sections.map(s => s.question.sourceQuestionNumber).sort((a, b) => a - b),
    [1, 2],
    'the questions the first pass missed are recovered',
  )
})

console.log(`\nscannedQuizImporter: ${passed} passed`)
