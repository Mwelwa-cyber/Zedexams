/**
 * Tests for the printable answer-sheet builder.
 *
 * Run: node src/utils/assessmentAnswerSheet.test.js
 */

import { buildAnswerSheet, answerSheetOptionCount } from './assessmentAnswerSheet.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('answerSheetOptionCount — bubbles per real option')
{
  assert(answerSheetOptionCount({ options: ['A', 'B', 'C', 'D'], optionsPlain: ['A', 'B', 'C', 'D'] }) === 4, 'four full options → 4')
  assert(answerSheetOptionCount({ options: ['True', 'False', '', ''], optionsPlain: ['True', 'False', '', ''] }) === 2, 'true/false → 2')
  assert(answerSheetOptionCount({ options: ['A', 'B', 'C', ''], optionsPlain: ['A', 'B', 'C', ''] }) === 3, 'three filled → 3')
  assert(answerSheetOptionCount({ options: ['', '', '', ''], optionMedia: [{ imageUrl: 'x' }, { imageUrl: 'y' }, null, null] }) === 2, 'image-only options counted')
  assert(answerSheetOptionCount({ options: [] }) === 4, 'no options → default 4')
  assert(answerSheetOptionCount({ options: ['only one', '', '', ''], optionsPlain: ['only one', '', '', ''] }) === 4, 'fewer than 2 filled → falls back, not below 2')
}

console.log('\nbuildAnswerSheet — rows mirror the paper')
{
  const assessment = { schoolName: 'Test School', subject: 'Integrated Science', grade: '4', showNameField: true, showDateField: true }
  const questions = [
    { localId: 'a', order: 1, type: 'mcq', marks: 1, options: ['Lungs', 'Heart', 'Liver', 'Kidney'], correctAnswer: 0 },
    { localId: 'b', order: 2, type: 'mcq', marks: 1, options: ['True', 'False', '', ''], correctAnswer: 0 },
    { localId: 'c', order: 3, type: 'short_answer', marks: 2, text: 'Explain.' },
  ]
  const sheet = buildAnswerSheet(assessment, questions)
  assert(sheet.items.length === 3, 'one row per question')
  assert(sheet.items[0].kind === 'mcq' && sheet.items[0].optionCount === 4, 'Q1 → 4 bubbles')
  assert(sheet.items[1].kind === 'mcq' && sheet.items[1].optionCount === 2, 'Q2 (T/F) → 2 bubbles')
  assert(sheet.items[2].kind === 'written', 'Q3 → write-in line')
  assert(sheet.items.map((i) => i.number).join(',') === '1,2,3', 'numbering matches the paper')
  assert(sheet.mcqCount === 2, 'counts MCQ rows')
  assert(sheet.subject === 'INTEGRATED SCIENCE', 'carries the (upper-cased) subject from the header')
  assert(sheet.name === true && sheet.date === true, 'name/date flags carried')
}

console.log('\nbuildAnswerSheet — empty paper')
{
  const sheet = buildAnswerSheet({ subject: 'Maths', grade: '5' }, [])
  assert(sheet.items.length === 0 && sheet.mcqCount === 0, 'no questions → no rows')
  assert(typeof sheet.title === 'string' && sheet.title.length > 0, 'still derives a title')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentAnswerSheet tests passed.')
