/**
 * Tests for the assessment paper layout helpers:
 *   - computeSmartWarnings flags duplicate MCQ options and image options
 *     that are missing alt text (mirrors the save-time validator early).
 *   - buildPaperLayout threads imageAlt onto question + passage blocks so
 *     the PDF / DOCX / preview renderers can emit it.
 *
 * Run: node src/utils/assessmentPaperLayout.test.js
 */

import { computeSmartWarnings, buildPaperLayout } from './assessmentPaperLayout.js'
import { latexToReadableText } from './quizRichText.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const baseAssessment = { schoolName: 'Test School', subject: 'Integrated Science', grade: '4' }
const keys = (ws) => ws.map(w => w.key)

console.log('computeSmartWarnings — duplicate options')
{
  const ws = computeSmartWarnings(baseAssessment, [
    { type: 'mcq', marks: 1, options: ['Lungs', 'Heart', 'Lungs', 'Liver'], correctAnswer: 0 },
  ])
  assert(keys(ws).includes('dup-options'), 'flags a question with duplicate options')
}
{
  const ws = computeSmartWarnings(baseAssessment, [
    { type: 'mcq', marks: 1, options: ['Lungs', 'Heart', 'Liver', 'Kidney'], correctAnswer: 0 },
  ])
  assert(!keys(ws).includes('dup-options'), 'does not flag distinct options')
}
{
  // Empty options should never count as duplicates of each other.
  const ws = computeSmartWarnings(baseAssessment, [
    { type: 'mcq', marks: 1, options: ['Lungs', '', '', ''], correctAnswer: 0 },
  ])
  assert(!keys(ws).includes('dup-options'), 'empty option slots are not duplicates')
}

console.log('\ncomputeSmartWarnings — option image missing alt')
{
  const ws = computeSmartWarnings(baseAssessment, [
    {
      type: 'mcq', marks: 1, options: ['', '', '', ''], correctAnswer: 0,
      optionMedia: [{ imageUrl: 'https://x/a.png', alt: '' }, null, null, null],
    },
  ])
  assert(keys(ws).includes('option-alt'), 'flags an image option with no alt text')
}
{
  const ws = computeSmartWarnings(baseAssessment, [
    {
      type: 'mcq', marks: 1, options: ['', '', '', ''], correctAnswer: 0,
      optionMedia: [{ imageUrl: 'https://x/a.png', alt: 'A red apple' }, null, null, null],
    },
  ])
  assert(!keys(ws).includes('option-alt'), 'does not flag an image option that has alt text')
}

console.log('\ncomputeSmartWarnings — timing budget')
{
  // Five 6-mark essays in a 20-minute slot is far too long.
  const longPaper = Array.from({ length: 5 }, (_, i) => ({ type: 'essay', marks: 6, text: `Essay ${i}` }))
  const ws = computeSmartWarnings({ ...baseAssessment, duration: 20 }, longPaper)
  assert(keys(ws).includes('timing-over'), 'flags a paper that overruns its duration')
  assert(!keys(ws).includes('timing-under'), 'does not also flag under')
}
{
  // One short MCQ in a 60-minute slot leaves lots of spare time.
  const ws = computeSmartWarnings({ ...baseAssessment, duration: 60 }, [{ type: 'mcq', marks: 1, options: ['A', 'B', 'C', 'D'], correctAnswer: 0 }])
  assert(keys(ws).includes('timing-under'), 'flags a paper well under its duration')
}
{
  // No duration set → no timing warning either way.
  const ws = computeSmartWarnings(baseAssessment, [{ type: 'essay', marks: 6, text: 'x' }])
  assert(!keys(ws).some(k => k.startsWith('timing-')), 'no duration → no timing warning')
}

console.log('\nbuildPaperLayout — imageAlt threads onto blocks')
{
  const blocks = buildPaperLayout(
    { ...baseAssessment, passages: [{ id: 'p1', order: 1, imageUrl: 'https://x/map.png', imageAlt: 'Map of Zambia', passageText: 'Read this.' }] },
    [
      { localId: 'q1', order: 1, type: 'short_answer', marks: 2, text: 'Name the capital.', imageUrl: 'https://x/q.png', imageAlt: 'A diagram of a city' },
      { localId: 'q2', order: 2, passageId: 'p1', type: 'mcq', marks: 1, text: 'Where?', options: ['A', 'B', 'C', 'D'], correctAnswer: 0 },
    ],
  )
  const q = blocks.find(b => b.kind === 'question' && b.imageUrl)
  assert(q && q.imageAlt === 'A diagram of a city', 'question block carries imageAlt')
  const passage = blocks.find(b => b.kind === 'passage')
  assert(passage && passage.imageAlt === 'Map of Zambia', 'passage block carries imageAlt')
}
{
  // Falls back to the passage title when no explicit alt is set.
  const blocks = buildPaperLayout(
    { ...baseAssessment, passages: [{ id: 'p1', order: 1, title: 'Forest food web', imageUrl: 'https://x/web.png', passageText: 'x' }] },
    [{ localId: 'q1', order: 1, passageId: 'p1', type: 'mcq', marks: 1, text: 'Q', options: ['A', 'B'], correctAnswer: 0 }],
  )
  const passage = blocks.find(b => b.kind === 'passage')
  assert(passage && passage.imageAlt === 'Forest food web', 'passage imageAlt falls back to the title')
}

console.log('\nbuildPaperLayout — strips baked-in option letter prefixes')
{
  // The generator/author sometimes stores "A. Foo" at index 0; every renderer
  // also prepends its own A/B/C/D, so the paper showed "A. A. Foo".
  const blocks = buildPaperLayout(baseAssessment, [
    {
      localId: 'q1', order: 1, type: 'mcq', marks: 1, correctAnswer: 2,
      text: 'The system that helps us breathe is the …',
      options: ['A. digestive system', 'B) circulatory system', 'C: respiratory system', 'D - nervous system'],
    },
  ])
  const q = blocks.find(b => b.kind === 'question')
  assert(q.options[0] === 'digestive system', 'strips "A. " prefix')
  assert(q.options[1] === 'circulatory system', 'strips "B) " prefix')
  assert(q.options[2] === 'respiratory system', 'strips "C: " prefix')
  assert(q.options[3] === 'nervous system', 'strips "D - " prefix')
  assert(q.optionsPlain[0] === 'digestive system', 'optionsPlain mirror is also stripped')
}
{
  // Never strip real content that merely starts with a capital letter.
  const blocks = buildPaperLayout(baseAssessment, [
    {
      localId: 'q1', order: 1, type: 'mcq', marks: 1, correctAnswer: 0,
      text: 'Pick one', options: ['Arteries', 'A car is faster', 'Bring it', 'D'],
    },
  ])
  const q = blocks.find(b => b.kind === 'question')
  assert(q.options[0] === 'Arteries', 'leaves "Arteries" untouched')
  assert(q.options[1] === 'A car is faster', 'leaves "A car is faster" untouched (no delimiter)')
  assert(q.options[3] === 'D', 'leaves a bare letter option untouched')
}

console.log('\nbuildPaperLayout — strips duplicate SECTION label from part title')
{
  const blocks = buildPaperLayout(
    {
      ...baseAssessment,
      parts: [{ id: 'pA', title: 'SECTION A: Multiple Choice' }, { id: 'pB', title: 'Sections of a plant' }],
    },
    [
      { localId: 'q1', order: 1, partId: 'pA', type: 'mcq', marks: 1, text: 'Q1', options: ['x', 'y'], correctAnswer: 0 },
      { localId: 'q2', order: 2, partId: 'pB', type: 'short_answer', marks: 2, text: 'Q2' },
    ],
  )
  const heads = blocks.filter(b => b.kind === 'sectionHeader')
  assert(heads[0].title === 'Multiple Choice', 'drops "SECTION A:" leaving "Multiple Choice"')
  assert(heads[1].title === 'Sections of a plant', 'keeps a real title that merely starts with "Sections"')
}

console.log('\nbuildPaperLayout — drops duplicated name/date header from instructions')
{
  const blocks = buildPaperLayout(
    { ...baseAssessment, coverInstructions: 'NAME: ______ DATE: ______ TOTAL MARKS: ______ INSTRUCTIONS: Answer ALL the questions.' },
    [{ localId: 'q1', order: 1, type: 'mcq', marks: 1, text: 'Q', options: ['x', 'y'], correctAnswer: 0 }],
  )
  const instr = blocks.find(b => b.kind === 'instructions')
  assert(instr.text === 'Answer ALL the questions.', 'keeps only the real instruction prose')
}
{
  const blocks = buildPaperLayout(
    { ...baseAssessment, coverInstructions: 'Answer ALL questions. Show your working.' },
    [{ localId: 'q1', order: 1, type: 'mcq', marks: 1, text: 'Q', options: ['x', 'y'], correctAnswer: 0 }],
  )
  const instr = blocks.find(b => b.kind === 'instructions')
  assert(instr.text === 'Answer ALL questions. Show your working.', 'leaves normal instructions unchanged')
}

console.log('\nbuildPaperLayout — answer-space format threads onto question blocks')
{
  const blocks = buildPaperLayout(baseAssessment, [
    {
      localId: 'q1', order: 1, type: 'short_answer', marks: 3,
      text: 'Name the parts labelled P, Q and R.',
      answerFormat: 'labelled_blanks', blankLabels: ['P', 'Q', 'R'],
    },
    {
      localId: 'q2', order: 2, type: 'short_answer', marks: 1,
      text: 'State the function.', answerFormat: 'none',
    },
  ])
  const q1 = blocks.find(b => b.kind === 'question' && b.number === 1)
  assert(q1.answerFormat === 'labelled_blanks', 'labelled_blanks format threads onto the block')
  assert(Array.isArray(q1.blankLabels) && q1.blankLabels.join(',') === 'P,Q,R', 'blankLabels thread onto the block')
  const q2 = blocks.find(b => b.kind === 'question' && b.number === 2)
  assert(q2.answerFormat === 'none', "answerFormat 'none' threads onto the block")
}

console.log('\nbuildPaperLayout — stimulus passage emits a total-marks footer')
{
  const blocks = buildPaperLayout(
    { ...baseAssessment, passages: [{ id: 'p1', order: 1, title: 'Study the diagram below.', passageKind: 'diagram', imageUrl: 'https://x/lungs.png' }] },
    [
      { localId: 'a', order: 1, passageId: 'p1', type: 'short_answer', marks: 3, text: 'Name P, Q, R.' },
      { localId: 'b', order: 2, passageId: 'p1', type: 'short_answer', marks: 1, text: 'Function of R.' },
      { localId: 'c', order: 3, passageId: 'p1', type: 'short_answer', marks: 1, text: 'Gas breathed out.' },
    ],
  )
  // Order must be: passage (instruction + image) → its questions → total footer.
  const passageIdx = blocks.findIndex(b => b.kind === 'passage')
  const footerIdx = blocks.findIndex(b => b.kind === 'passageTotal')
  assert(passageIdx >= 0 && footerIdx > passageIdx, 'passage comes before its total footer')
  const footer = blocks[footerIdx]
  assert(footer && footer.totalMarks === 5, 'auto-sums sub-question marks to 5')
  // The instruction (title) and image sit on the passage block, before the questions.
  const passage = blocks[passageIdx]
  assert(passage.title === 'Study the diagram below.' && passage.imageUrl === 'https://x/lungs.png', 'instruction + diagram render before the questions')
}

console.log('\nbuildPaperLayout — comprehension passage has no total footer')
{
  const blocks = buildPaperLayout(
    { ...baseAssessment, passages: [{ id: 'p1', order: 1, title: 'A story', passageKind: 'comprehension', passageText: 'Once upon a time.' }] },
    [{ localId: 'a', order: 1, passageId: 'p1', type: 'mcq', marks: 1, text: 'Q', options: ['x', 'y'], correctAnswer: 0 }],
  )
  assert(!blocks.some(b => b.kind === 'passageTotal'), 'comprehension passages keep their historical no-total layout')
}

console.log('\nbuildPaperLayout — pinned manual total overrides the auto-sum')
{
  const blocks = buildPaperLayout(
    { ...baseAssessment, passages: [{ id: 'p1', order: 1, title: 'Diagram', passageKind: 'diagram', manualMarks: 10 }] },
    [{ localId: 'a', order: 1, passageId: 'p1', type: 'short_answer', marks: 3, text: 'Q' }],
  )
  const footer = blocks.find(b => b.kind === 'passageTotal')
  assert(footer && footer.totalMarks === 10, 'manualMarks overrides the auto-sum')
}

console.log('\nbuildPaperLayout — identify-mode keeps blank-text hotspots, labeled mode drops them')
{
  // A teacher drops 3 numbered hotspots on a diagram but only types the
  // expected answer for the middle one. In identify mode the marker is the
  // NUMBER, so all 3 must survive (and keep their order) — dropping the two
  // blank ones would delete markers and renumber the rest on the paper.
  const identifyBlocks = buildPaperLayout(baseAssessment, [
    {
      localId: 'q1', order: 1, type: 'diagram', marks: 3, text: 'Identify the labelled parts.',
      imageUrl: 'https://x/heart.png', diagramMode: 'identify',
      diagramLabels: [
        { x: 0.2, y: 0.3, text: '' },
        { x: 0.5, y: 0.5, text: 'Aorta' },
        { x: 0.8, y: 0.7, text: '' },
      ],
    },
  ])
  const qi = identifyBlocks.find(b => b.kind === 'question')
  assert(qi.diagramLabels.length === 3, 'identify mode keeps all 3 hotspots even when 2 have blank text')
  assert(qi.diagramLabels[1].text === 'Aorta', 'identify hotspot order is preserved (Aorta stays 2nd)')
}
{
  // Labeled mode renders the text as a visible pill, so an empty pill is just
  // noise and is still dropped (unchanged behaviour).
  const labeledBlocks = buildPaperLayout(baseAssessment, [
    {
      localId: 'q1', order: 1, type: 'diagram', marks: 3, text: 'Study the diagram.',
      imageUrl: 'https://x/heart.png', diagramMode: 'labeled',
      diagramLabels: [
        { x: 0.2, y: 0.3, text: '' },
        { x: 0.5, y: 0.5, text: 'Aorta' },
        { x: 0.8, y: 0.7, text: '' },
      ],
    },
  ])
  const ql = labeledBlocks.find(b => b.kind === 'question')
  assert(ql.diagramLabels.length === 1, 'labeled mode still drops the 2 blank-text pills')
  assert(ql.diagramLabels[0].text === 'Aorta', 'labeled mode keeps only the named pill')
}

console.log('\nlatexToReadableText — readable maths for non-JS exports')
assert(latexToReadableText('18') === '18', 'plain number unchanged')
assert(latexToReadableText('4 \\div 2 \\times 3') === '4 ÷ 2 × 3', 'div/times → ÷/×')
assert(latexToReadableText('\\frac{1}{3}') === '(1)/(3)', 'fraction → (1)/(3)')
assert(latexToReadableText('x^2') === 'x²', 'power → superscript')
assert(latexToReadableText('H_2O') === 'H₂O', 'subscript → ₂')
assert(latexToReadableText('5 \\geq 3') === '5 ≥ 3', 'geq → ≥')
assert(latexToReadableText('') === '', 'empty stays empty')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentPaperLayout tests passed.')
