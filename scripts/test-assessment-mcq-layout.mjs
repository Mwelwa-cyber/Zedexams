/**
 * Regression tests for the paper-level MCQ presentation settings:
 *   - mcqAnswerChoiceCount caps every MCQ to the first N options (2/3/4),
 *     non-destructively (options + optionMedia are trimmed in the layout
 *     block only).
 *   - mcqOptionLayout flows through to the block as `mcqLayout` so the
 *     three renderers (preview / PDF / DOCX) can lay text options out
 *     vertically or horizontally.
 *
 * Run: node scripts/test-assessment-mcq-layout.mjs
 */

import { buildPaperLayout } from '../src/utils/assessmentPaperLayout.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const mcqQuestion = {
  order: 0,
  type: 'mcq',
  text: 'Pick one',
  options: ['red', 'blue', 'green', 'yellow'],
  optionMedia: [null, null, null, null],
  correctAnswer: 1,
  marks: 1,
}

const questionBlock = (assessment) =>
  buildPaperLayout(assessment, [structuredClone(mcqQuestion)], { mode: 'paper' })
    .find(b => b.kind === 'question')

console.log('mcqAnswerChoiceCount — caps options to the first N')
{
  const b = questionBlock({ mcqAnswerChoiceCount: 3 })
  assert(b.options.length === 3, 'count=3 trims four options down to three')
  assert(b.options[2] === 'green', 'keeps the first three options in order')
  assert(b.optionMedia.length === 3, 'optionMedia is trimmed to match')
}
{
  const b = questionBlock({ mcqAnswerChoiceCount: 2 })
  assert(b.options.length === 2, 'count=2 trims to two options')
}

console.log('mcqAnswerChoiceCount — invalid / unset is a no-op')
{
  const b = questionBlock({})
  assert(b.options.length === 4, 'unset keeps all four options')
}
{
  const b = questionBlock({ mcqAnswerChoiceCount: 5 })
  assert(b.options.length === 4, 'out-of-range (5) is ignored, keeps four')
}
{
  // Fewer stored options than the cap must not pad with blanks.
  const b = buildPaperLayout(
    { mcqAnswerChoiceCount: 4 },
    [{ ...structuredClone(mcqQuestion), options: ['a', 'b'], optionMedia: [null, null] }],
    { mode: 'paper' },
  ).find(x => x.kind === 'question')
  assert(b.options.length === 2, 'cap above the stored count does not pad options')
}

console.log('mcqOptionLayout — flows through to the block')
{
  assert(questionBlock({ mcqOptionLayout: 'horizontal' }).mcqLayout === 'horizontal', 'horizontal passes through')
  assert(questionBlock({ mcqOptionLayout: 'vertical' }).mcqLayout === 'vertical', 'vertical passes through')
  assert(questionBlock({}).mcqLayout === null, 'unset layout is null (renderer auto behaviour)')
  assert(questionBlock({ mcqOptionLayout: 'diagonal' }).mcqLayout === null, 'invalid layout falls back to null')
}

console.log('non-MCQ questions are unaffected')
{
  const b = buildPaperLayout(
    { mcqAnswerChoiceCount: 2, mcqOptionLayout: 'horizontal' },
    [{ order: 0, type: 'short_answer', text: 'Explain', marks: 2 }],
    { mode: 'paper' },
  ).find(x => x.kind === 'question')
  assert(b.mcqLayout === null, 'short_answer block has null mcqLayout')
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll assessment MCQ layout tests passed')
