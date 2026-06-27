/**
 * scannedQuizImporterV2.spec.js — Vitest (jsdom) behavioural tests for
 * the V2 client import wrapper.
 *
 * Verifies that runVisionImportV2 correctly maps vision-detected question
 * types (fill_blanks, true_false, mcq, …) to the editor section shape via
 * the V2 normaliser, without touching any DOM / canvas / Firebase code.
 */

import { test, expect, vi } from 'vitest'
import { runVisionImportV2 } from './scannedQuizImporterV2.js'

// ─── Mocks for DOM-backed helpers that don't exist in jsdom ──────────────────

// attachOptionImages + attachQuestionDiagrams both use canvas — stub them out
// by making assetByPage empty (no crops attempted) and having the vision
// response carry no diagram boxes.

// ─── callVision mock factory ──────────────────────────────────────────────────

/**
 * Build a minimal mock callVision that returns one standalone section.
 * `question` is the raw vision question object the V2 normaliser will receive.
 *
 * Note: mergeSectionBatches filters questions by `q.text || q.sourceQuestionNumber`,
 * so the raw question must include a `text` field (the stem) alongside the V2
 * `prompt` field so the dedup gate passes.
 */
function makeCallVision(question) {
  return async () => ({
    sections: [{ kind: 'standalone', question }],
    warnings: [],
    detectedTotal: 1,
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('runVisionImportV2 maps fill_blanks question into editor section', async () => {
  const callVision = makeCallVision({
    questionType: 'fill_blanks',
    prompt: 'Fill in:',
    // `text` is what mergeSectionBatches uses to dedup; must be non-empty.
    text: 'Fill in:',
    statements: [{ text: 'Water is a _____.', blanks: 1 }],
    wordBank: ['liquid', 'solid'],
    marks: 1,
    confidence: 0.8,
    options: [],
    hasDiagram: false,
    diagrams: [],
    sourcePageIndex: 0,
  })

  const result = await runVisionImportV2({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,abc' }],
    callVision,
    onProgress: () => {},
  })

  expect(result.sections).toHaveLength(1)
  expect(result.sections[0].kind).toBe('standalone')
  expect(result.sections[0].question.type).toBe('fill_blanks')
  expect(result.sections[0].question.statements).toEqual([
    { text: 'Water is a _____.', blanks: 1 },
  ])
  expect(result.sections[0].question.wordBank).toEqual(['liquid', 'solid'])
})

test('runVisionImportV2 maps true_false question to tf editor type', async () => {
  const callVision = makeCallVision({
    questionType: 'true_false',
    prompt: 'Decide:',
    text: 'Decide:',
    tfStatement: 'The sun rises in the west.',
    marks: 1,
    confidence: 0.9,
    options: ['True', 'False'],
    hasDiagram: false,
    diagrams: [],
    sourcePageIndex: 0,
  })

  const result = await runVisionImportV2({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,abc' }],
    callVision,
    onProgress: () => {},
  })

  expect(result.sections).toHaveLength(1)
  expect(result.sections[0].question.type).toBe('tf')
  // V2 normaliser replaces text with tfStatement for true_false
  expect(result.sections[0].question.text).toBe('The sun rises in the west.')
  expect(result.sections[0].question.options).toEqual(['True', 'False'])
})

test('runVisionImportV2 maps mcq question to mcq editor type', async () => {
  const callVision = makeCallVision({
    questionType: 'mcq',
    prompt: 'Which is a fruit?',
    text: 'Which is a fruit?',
    options: ['Apple', 'Carrot', 'Potato', 'Onion'],
    marks: 1,
    confidence: 0.95,
    hasDiagram: false,
    diagrams: [],
    sourcePageIndex: 0,
  })

  const result = await runVisionImportV2({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,abc' }],
    callVision,
    onProgress: () => {},
  })

  expect(result.sections).toHaveLength(1)
  expect(result.sections[0].question.type).toBe('mcq')
})

test('runVisionImportV2 sets requiresReview=true for low-confidence questions', async () => {
  const callVision = makeCallVision({
    questionType: 'fill_blanks',
    prompt: 'Stem?',
    text: 'Stem?',
    statements: [{ text: 'A _____ is hot.', blanks: 1 }],
    wordBank: [],
    marks: 1,
    confidence: 0.4, // below 0.6 threshold
    options: [],
    hasDiagram: false,
    diagrams: [],
    sourcePageIndex: 0,
  })

  const result = await runVisionImportV2({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,abc' }],
    callVision,
    onProgress: () => {},
  })

  expect(result.sections[0].question.requiresReview).toBe(true)
  expect(result.sections[0].question.importWarnings).toEqual(
    expect.arrayContaining([expect.stringContaining('Low confidence')]),
  )
})

test('runVisionImportV2 does not mutate the options passed to it', async () => {
  const callVision = makeCallVision({
    questionType: 'mcq',
    prompt: 'Test?',
    text: 'Test?',
    options: ['A', 'B', 'C', 'D'],
    marks: 1,
    confidence: 0.9,
    hasDiagram: false,
    diagrams: [],
    sourcePageIndex: 0,
  })

  const pageImages = [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,abc' }]
  const original = [...pageImages]
  await runVisionImportV2({ pageImages, callVision, onProgress: () => {} })
  expect(pageImages).toEqual(original)
})
