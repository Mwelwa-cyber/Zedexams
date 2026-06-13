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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentPaperLayout tests passed.')
