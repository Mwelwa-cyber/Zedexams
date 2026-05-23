import assert from 'node:assert/strict'
import {
  consolidateOptionImageRuns,
  detectParagraphOptionLetter,
  looksLikeQuestionStem,
} from './documentQuizParagraphRuns.js'

// ─── detectParagraphOptionLetter ───────────────────────────────────────────

assert.equal(detectParagraphOptionLetter('A.'), 'A')
assert.equal(detectParagraphOptionLetter('A)'), 'A')
assert.equal(detectParagraphOptionLetter('(A)'), 'A')
assert.equal(detectParagraphOptionLetter('A:'), 'A')
assert.equal(detectParagraphOptionLetter('A'), 'A')
assert.equal(detectParagraphOptionLetter('a.'), 'A', 'lowercase letters normalise to uppercase')
assert.equal(detectParagraphOptionLetter(' B. '), 'B', 'leading/trailing whitespace tolerated')
assert.equal(detectParagraphOptionLetter('A. Apple'), '', 'non-bare label does not match')
assert.equal(detectParagraphOptionLetter('1.'), '', 'numbers are not option letters')
assert.equal(detectParagraphOptionLetter(''), '')

// ─── looksLikeQuestionStem ─────────────────────────────────────────────────

assert.equal(looksLikeQuestionStem('1. What is X?'), true)
assert.equal(looksLikeQuestionStem('12) Pick one'), true)
assert.equal(looksLikeQuestionStem('Question 3.'), true)
assert.equal(looksLikeQuestionStem('Q4.'), true)
assert.equal(looksLikeQuestionStem('A. Apple'), false, 'options must not look like stems')
assert.equal(looksLikeQuestionStem('Read the passage:'), false)

// ─── consolidator: inline-image pattern ────────────────────────────────────

// Teacher pattern: each option letter sits in its own paragraph with an
// inline image attached. The consolidator should fold them into the
// preceding question stem's block.
const inlineRunBlocks = [
  { text: '1. Which is the elephant?', assets: [], source: 'docx' },
  { text: 'A.', assets: [{ id: 'a-1' }], source: 'docx' },
  { text: 'B.', assets: [{ id: 'b-1' }], source: 'docx' },
  { text: 'C.', assets: [{ id: 'c-1' }], source: 'docx' },
  { text: 'D.', assets: [{ id: 'd-1' }], source: 'docx' },
]
const inlineResult = consolidateOptionImageRuns(inlineRunBlocks)
assert.equal(inlineResult.length, 1, 'four option blocks fold into the question block')
assert.match(inlineResult[0].text, /A\. \(image\)/)
assert.match(inlineResult[0].text, /D\. \(image\)/)
assert.equal(inlineResult[0].optionAssetsByLetter.A.id, 'a-1')
assert.equal(inlineResult[0].optionAssetsByLetter.B.id, 'b-1')
assert.equal(inlineResult[0].optionAssetsByLetter.C.id, 'c-1')
assert.equal(inlineResult[0].optionAssetsByLetter.D.id, 'd-1')

// ─── consolidator: successor-paragraph image pattern ───────────────────────

// Teacher pattern: each option letter is followed by an image-only paragraph
// (Word's default when you paste an image after pressing Enter on "A.").
const successorRunBlocks = [
  { text: '2. Which fruit?', assets: [], source: 'docx' },
  { text: 'A.', assets: [], source: 'docx' },
  { text: '', assets: [{ id: 'a-2' }], source: 'docx' },
  { text: 'B.', assets: [], source: 'docx' },
  { text: '', assets: [{ id: 'b-2' }], source: 'docx' },
  { text: 'C.', assets: [], source: 'docx' },
  { text: '', assets: [{ id: 'c-2' }], source: 'docx' },
  { text: 'D.', assets: [], source: 'docx' },
  { text: '', assets: [{ id: 'd-2' }], source: 'docx' },
]
const successorResult = consolidateOptionImageRuns(successorRunBlocks)
assert.equal(successorResult.length, 1,
  'all eight option-letter + image-only blocks fold into the question block')
assert.equal(successorResult[0].optionAssetsByLetter.A.id, 'a-2')
assert.equal(successorResult[0].optionAssetsByLetter.D.id, 'd-2')

// ─── consolidator: question with its own stem image ───────────────────────

// The question stem has its own image (paragraph immediately after the
// stem). The consolidator should NOT swallow that image into options; it
// should still find the question block as the run's target by walking
// backwards over the image-only block.
const stemImageBlocks = [
  { text: '3. Identify the animal shown below:', assets: [], source: 'docx' },
  { text: '', assets: [{ id: 'stem-img-3' }], source: 'docx' },
  { text: 'A.', assets: [{ id: 'a-3' }], source: 'docx' },
  { text: 'B.', assets: [{ id: 'b-3' }], source: 'docx' },
  { text: 'C.', assets: [{ id: 'c-3' }], source: 'docx' },
  { text: 'D.', assets: [{ id: 'd-3' }], source: 'docx' },
]
const stemImageResult = consolidateOptionImageRuns(stemImageBlocks)
// Two blocks survive: the augmented question (with optionAssets) + the stem
// image block. The four A./B./C./D. blocks fold into the question.
assert.equal(stemImageResult.length, 2,
  'stem image block survives between the question and the option run')
const augmentedStem = stemImageResult[0]
assert.equal(augmentedStem.optionAssetsByLetter.A.id, 'a-3')
const stemImageBlock = stemImageResult[1]
assert.equal(stemImageBlock.assets[0].id, 'stem-img-3',
  'the stem-image block is preserved and still carries its own asset')

// ─── consolidator: single option line is NOT a run ─────────────────────────

// A single "A. <img>" line could be anything (a label, a section heading) —
// require at least two letters before triggering the rewrite.
const lonelyBlocks = [
  { text: '4. Question text.', assets: [], source: 'docx' },
  { text: 'A.', assets: [{ id: 'a-4' }], source: 'docx' },
  { text: 'Some explanatory text.', assets: [], source: 'docx' },
]
const lonelyResult = consolidateOptionImageRuns(lonelyBlocks)
assert.equal(lonelyResult.length, 3, 'lonely A. block is left alone')
assert.equal(lonelyResult[0].optionAssetsByLetter, undefined,
  'no augmentation when the run is too short')

// ─── consolidator: no false positives on text options ──────────────────────

// "A. Apple" / "B. Banana" / etc. should NOT trigger — they have text after
// the letter and go through the normal OPTION_RE path.
const textOptionBlocks = [
  { text: '5. Pick a fruit.', assets: [], source: 'docx' },
  { text: 'A. Apple', assets: [], source: 'docx' },
  { text: 'B. Banana', assets: [], source: 'docx' },
  { text: 'C. Cherry', assets: [], source: 'docx' },
  { text: 'D. Date', assets: [], source: 'docx' },
]
const textOptionResult = consolidateOptionImageRuns(textOptionBlocks)
assert.equal(textOptionResult.length, 5, 'text options are not consolidated')
assert.equal(textOptionResult[0].optionAssetsByLetter, undefined,
  'no optionAssetsByLetter when options carry text')

// ─── consolidator: idempotent on already-clean input ───────────────────────

const cleanBlocks = [
  { text: '6. A clean question.', assets: [], source: 'docx' },
  { text: 'Some answer text.', assets: [], source: 'docx' },
]
assert.deepEqual(consolidateOptionImageRuns(cleanBlocks), cleanBlocks,
  'unchanged input passes through unchanged')

// ─── Phase 5: PDF-shape blocks ─────────────────────────────────────────────

// extractPdf produces one block per text line. When a line is "A." and the
// nearest figure (by Y) was attached via pickFigureForLineY, the consolidator
// folds it into the preceding question stem — identical behaviour to DOCX.
// The source field changes; the behaviour shouldn't.
const pdfBlocks = [
  { text: '7. Which letter is the vowel?', assets: [], pageAsset: null, pageNumber: 1, source: 'pdf' },
  { text: 'A.', assets: [{ id: 'pdf-fig-a' }], pageAsset: null, pageNumber: 1, source: 'pdf' },
  { text: 'B.', assets: [{ id: 'pdf-fig-b' }], pageAsset: null, pageNumber: 1, source: 'pdf' },
  { text: 'C.', assets: [{ id: 'pdf-fig-c' }], pageAsset: null, pageNumber: 1, source: 'pdf' },
  { text: 'D.', assets: [{ id: 'pdf-fig-d' }], pageAsset: null, pageNumber: 1, source: 'pdf' },
]
const pdfResult = consolidateOptionImageRuns(pdfBlocks)
assert.equal(pdfResult.length, 1,
  'four PDF option-letter lines fold into the question block')
assert.equal(pdfResult[0].source, 'pdf', 'PDF source field survives the rewrite')
assert.equal(pdfResult[0].optionAssetsByLetter.A.id, 'pdf-fig-a')
assert.equal(pdfResult[0].optionAssetsByLetter.D.id, 'pdf-fig-d')

console.log('documentQuizParagraphRuns.test.js — OK')
