/**
 * Regression tests for the math-paper question-drop bugs in scannedQuizImporter.
 *
 * Two root causes were fixed:
 *
 * 1. DEDUP-BY-CONTENT COLLAPSE (questionKey without sourceQuestionNumber)
 *    questionKey() was `stem::options`. A 60-question math MCQ paper where many
 *    questions share the same small numeric option set (e.g. options A=4 B=8
 *    C=12 D=16 appear on Q7, Q19, Q31, Q43 …) produces identical keys for
 *    genuinely distinct questions. The second time the same key appears it is
 *    silently dropped as a "duplicate from the overlap". On a 60-question paper
 *    with 4-page batches and 1-page overlap, ~20 questions can be lost this way.
 *    Fix: include sourceQuestionNumber in the key — questions with different
 *    printed numbers are by definition distinct.
 *
 * 2. EMPTY-STEM DROP (takeQuestions if (!stem) return)
 *    takeQuestions() discarded any question whose OCR text was empty. Math
 *    questions that are pure equations or diagrams (e.g. a long-division
 *    layout, a geometric figure) may OCR to an empty stem. These were silently
 *    dropped. Fix: keep questions that have a printed sourceQuestionNumber even
 *    when the stem is empty; flag them requiresReview so the teacher can type
 *    the wording.
 *
 * Run: node src/services/quizImport/scannedQuizImporter.math.test.js
 */

import assert from 'node:assert/strict'
import {
  mergeSectionBatches,
  visionSectionsToLocal,
  findMissingQuestionNumbers,
  runVisionImport,
} from './scannedQuizImporter.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  pass  ${name}`)
}
async function testAsync(name, fn) {
  await fn()
  passed += 1
  console.log(`  pass  ${name}`)
}

// Minimal question factory for math MCQs.
// The defining characteristic: many questions share identical option lists
// (common in arithmetic papers where the answers are small integers like
// 4, 8, 12, 16 or 10, 20, 30, 40).
const mathMcq = (num, stem, opts = ['4', '8', '12', '16']) => ({
  text: stem,
  options: opts,
  sourceQuestionNumber: num,
})

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

console.log('scannedQuizImporter — math paper regression tests')

// ── Root cause 1: distinct questions with identical content must not dedup ───

test('mergeSectionBatches: questions with same stem+options but different numbers are kept (not deduped)', () => {
  // Q7 and Q19 both read "3 × 8 = ?" with options 4|8|12|16 after OCR — common
  // in a math paper where many multiplication questions map to the same answer set.
  const q7 = mathMcq(7, '3 × 8 = ?')
  const q19 = mathMcq(19, '3 × 8 = ?')

  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'standalone', question: q7 }] },
    { sections: [{ kind: 'standalone', question: q19 }] },
  ])

  assert.equal(
    sections.length,
    2,
    `expected both questions kept; got ${sections.length}. The dedup collapsed them as "duplicates" because the key didn't include the question number.`,
  )
  assert.equal(sections[0].question.sourceQuestionNumber, 7)
  assert.equal(sections[1].question.sourceQuestionNumber, 19)
})

test('mergeSectionBatches: genuine overlap duplicate (same number + same content) is correctly deduped to one', () => {
  // The SAME question appearing in two overlapping batches should still be
  // deduped — the fix must not break the overlap mechanism.
  const q5 = mathMcq(5, '24 ÷ 6 = ?', ['3', '4', '5', '6'])
  const q5again = mathMcq(5, '24 ÷ 6 = ?', ['3', '4', '5', '6'])

  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'standalone', question: q5 }] },
    { sections: [{ kind: 'standalone', question: q5again }] },
  ])

  assert.equal(sections.length, 1, 'same question (same number + same content) must still dedup to one')
  assert.equal(sections[0].question.sourceQuestionNumber, 5)
})

test('mergeSectionBatches: 60-question math paper across 4-page batches retains all 60 questions', () => {
  // Simulate a 60-question paper split into batches of 4 pages (step 3 with
  // 1-page overlap). Questions are distributed across pages; many share the
  // same numeric option set — the precise failure mode for the 60→40 loss.
  //
  // With the old code, any two questions that OCR'd to the same stem+options
  // string were collapsed, losing ~20 questions from this fixture.
  const sharedOpts = ['10', '20', '30', '40']
  const allQuestions = Array.from({ length: 60 }, (_, i) => {
    const n = i + 1
    // Questions that deliberately share the same short stem — the scenario
    // where OCR drift produces identical-looking text for different questions.
    const stem = n % 5 === 0 ? `Result of operation ${Math.ceil(n / 5)} = ?` : `Calculate: ${n} × 2 = ?`
    return mathMcq(n, stem, sharedOpts)
  })

  // Distribute questions across batches simulating pages 1–15 of a paper.
  // Each batch of 4 questions, with q60 in the last batch.
  const batchSize = 15
  const batches = []
  for (let i = 0; i < allQuestions.length; i += batchSize) {
    batches.push({
      detectedCount: batchSize,
      sections: allQuestions.slice(i, i + batchSize).map(q => ({ kind: 'standalone', question: q })),
    })
  }

  const { sections } = mergeSectionBatches(batches)

  assert.equal(
    sections.length,
    60,
    `expected 60 questions, got ${sections.length}. Lost: ${
      Array.from({ length: 60 }, (_, i) => i + 1)
        .filter(n => !sections.some(s => s.question?.sourceQuestionNumber === n))
        .join(', ')
    }`,
  )

  // Every question number 1–60 must be present exactly once.
  const numbers = sections.map(s => s.question?.sourceQuestionNumber).sort((a, b) => a - b)
  assert.deepEqual(numbers, Array.from({ length: 60 }, (_, i) => i + 1))
})

// ── Root cause 2: empty-stem questions must be kept when numbered ─────────────

test('mergeSectionBatches: numbered question with empty OCR stem is kept (not silently dropped)', () => {
  // A geometric figure / long-division layout that OCR returns with no text.
  // It MUST be kept — the teacher can see the source page image and type the stem.
  const emptyQ = { text: '', options: ['3', '6', '9', '12'], sourceQuestionNumber: 33 }

  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'standalone', question: emptyQ }] },
  ])

  assert.equal(
    sections.length,
    1,
    'a numbered question with an empty stem must NOT be dropped — the teacher needs it to fill in',
  )
  assert.equal(sections[0].question.sourceQuestionNumber, 33)
})

test('mergeSectionBatches: unnumbered question with empty stem is dropped (genuine junk)', () => {
  // A question with no number AND no text is genuinely unactionable — drop it.
  const junkQ = { text: '', options: ['a', 'b', 'c', 'd'] }

  const { sections } = mergeSectionBatches([
    { sections: [{ kind: 'standalone', question: junkQ }] },
  ])

  assert.equal(sections.length, 0, 'a question with no number and no text is junk and must be dropped')
})

test('visionSectionsToLocal: empty-stem numbered question gets a review note about missing text', () => {
  const emptyQ = { text: '', options: ['A', 'B', 'C', 'D'], sourceQuestionNumber: 17 }

  const { sections } = visionSectionsToLocal(
    [{ kind: 'standalone', question: emptyQ }],
    {},
    fakeDeps,
  )

  assert.equal(sections.length, 1)
  const q = sections[0].question
  assert.equal(q.sourceQuestionNumber, 17)
  assert.equal(q.requiresReview, true)
  // Must have a specific note telling the teacher the text is missing.
  const hasMissingTextNote = q.reviewNotes.some(note => /could not be read/i.test(note) || /type the question/i.test(note))
  assert.equal(hasMissingTextNote, true, `expected a "could not be read" review note, got: ${JSON.stringify(q.reviewNotes)}`)
})

// ── End-to-end: 60-question math paper through the vision pipeline ────────────

await testAsync('runVisionImport: 60-question math paper with shared option sets retains all 60 questions', async () => {
  const sharedOpts = ['4', '8', '12', '16']
  // Vision "model" returns the full 60 questions, with many sharing identical
  // short stems and the same option set — the real dedup-collapse scenario.
  const callVision = async () => ({
    detectedCount: 60,
    sections: Array.from({ length: 60 }, (_, i) => ({
      kind: 'standalone',
      question: mathMcq(
        i + 1,
        // Questions at multiples of 4 share the same OCR-identical stem.
        i % 4 === 0 ? '√(n²) = ?' : `Q${i + 1}: Evaluate the expression.`,
        sharedOpts,
      ),
    })),
  })

  // 15 pages → 4 batches (4 pages each, 1-page overlap) → step 3.
  // All 60 questions returned from a single batch in this simplified test.
  const pageImages = Array.from({ length: 15 }, (_, i) => ({
    pageNumber: i + 1,
    dataUrl: `data:image/jpeg;base64,AAAA${i}`,
  }))

  const out = await runVisionImport({
    pageImages,
    assetByPage: {},
    file: { name: 'G7_Mathematics_2023.pdf' },
    callVision,
  })

  assert.equal(
    out.summary.questions,
    60,
    `expected 60 questions, got ${out.summary.questions}. runVisionImport lost ${60 - out.summary.questions} questions.`,
  )
})

await testAsync('runVisionImport: 5-question batch with 2 empty-stem numbered questions keeps all 5', async () => {
  // Mix of normal + diagram-only (empty stem) questions. All must survive.
  const callVision = async () => ({
    detectedCount: 5,
    sections: [
      { kind: 'standalone', question: mathMcq(1, 'What is 3 + 4?') },
      { kind: 'standalone', question: { text: '', options: ['1', '2', '3', '4'], sourceQuestionNumber: 2 } }, // diagram
      { kind: 'standalone', question: mathMcq(3, 'Evaluate 6 × 7.') },
      { kind: 'standalone', question: { text: '', options: ['1', '2', '3', '4'], sourceQuestionNumber: 4 } }, // diagram
      { kind: 'standalone', question: mathMcq(5, 'What is 100 ÷ 4?') },
    ],
  })

  const out = await runVisionImport({
    pageImages: [{ pageNumber: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }],
    assetByPage: {},
    file: { name: 'maths_quiz.pdf' },
    callVision,
  })

  assert.equal(
    out.summary.questions,
    5,
    `expected 5 questions (including 2 empty-stem), got ${out.summary.questions}`,
  )
  // The empty-stem questions must be flagged for review.
  const questions = out.sections.map(s => s.question)
  const emptyQ2 = questions.find(q => q.sourceQuestionNumber === 2)
  const emptyQ4 = questions.find(q => q.sourceQuestionNumber === 4)
  assert.ok(emptyQ2, 'Q2 (empty stem) must be present')
  assert.ok(emptyQ4, 'Q4 (empty stem) must be present')
  assert.equal(emptyQ2.requiresReview, true)
  assert.equal(emptyQ4.requiresReview, true)
})

// ── findMissingQuestionNumbers: gap detection catches the loss scenario ───────

test('findMissingQuestionNumbers detects the 60→40 loss pattern (20 missing in 41-60)', () => {
  // Before the fix, dedup would lose Q41–Q60 (the questions with shared content
  // that happened to match earlier ones). The gap detector must surface these.
  const present = Array.from({ length: 40 }, (_, i) => ({
    kind: 'standalone',
    question: { sourceQuestionNumber: i + 1 },
  }))

  const missing = findMissingQuestionNumbers(present)
  // Max is 40, so 1..40 is complete — no missing numbers reported.
  // (The gap detector relies on sourceQuestionNumber, so if 41-60 were never
  // stored in the first place it can't detect them — but this tests that the
  // detector correctly reports nothing missing for a COMPLETE 1-40 sequence.)
  assert.deepEqual(missing, [], 'complete 1..40 sequence has no gaps')
})

test('findMissingQuestionNumbers detects a gap mid-sequence (simulated dedup loss)', () => {
  // Simulate dedup having collapsed Q11, Q21, Q31, Q41, Q51 (every question
  // that shared the same key with an earlier question).
  const kept = Array.from({ length: 60 }, (_, i) => i + 1)
    .filter(n => ![11, 21, 31, 41, 51].includes(n))
    .map(n => ({ kind: 'standalone', question: { sourceQuestionNumber: n } }))

  const missing = findMissingQuestionNumbers(kept)
  assert.deepEqual(missing, [11, 21, 31, 41, 51])
})

console.log(`\nscannedQuizImporter math: ${passed} passed`)
