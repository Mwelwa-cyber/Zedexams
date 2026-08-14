/**
 * The generated-quiz converter: markup in, rendered nodes in the editor,
 * marking fields untouched. Run: node src/features/quizEditor/lib/generatedQuizRichText.test.js
 */

import assert from 'node:assert/strict'
import { richifyGeneratedQuestion, richifyGeneratedQuestions } from './generatedQuizRichText.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\ngeneratedQuizRichText')

test('a generated fraction question arrives as editor nodes, not markup text', () => {
  const q = richifyGeneratedQuestion({
    text: 'Which is bigger, \\frac{3}{5} or \\frac{1}{2}?',
    options: ['\\frac{3}{5}', '\\frac{1}{2}', 'They are equal', '$x^2$'],
    correctAnswer: 0,
    explanation: 'Compare via $\\frac{6}{10}$ and $\\frac{5}{10}$.',
    type: 'mcq',
  })
  assert.ok(!q.text.includes('\\frac'), 'no raw markup in the stem')
  assert.match(q.text, /data-math-fraction|math-frac/, 'the stem carries a real fraction node')
  assert.ok(q.options.every((o) => !o.includes('\\frac')), 'no raw markup in options')
  assert.equal(q.correctAnswer, 0, 'the answer index is untouched')
  assert.ok(!q.explanation.includes('$'), 'the explanation converted too')
})

test('a plain question passes through byte-identical', () => {
  const original = {
    text: 'Name the capital of Zambia.',
    options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'],
    correctAnswer: 0,
    explanation: 'Lusaka has been the capital since 1935.',
  }
  const out = richifyGeneratedQuestion({ ...original, options: [...original.options] })
  assert.equal(out.text, original.text)
  assert.deepEqual(out.options, original.options)
  assert.equal(out.explanation, original.explanation)
})

test('marking fields are never converted', () => {
  const q = richifyGeneratedQuestion({
    text: 'What is $\\sqrt{81}$?',
    options: [],
    correctAnswer: '9',
    answer: 'sqrt(81)',
    type: 'short_answer',
  })
  assert.equal(q.correctAnswer, '9')
  assert.equal(q.answer, 'sqrt(81)')
})

test('fill-in-the-blank statements convert inline; their answers do not', () => {
  const q = richifyGeneratedQuestion({
    text: 'Complete the statements.',
    statements: [
      { text: 'Half of \\frac{1}{2} is ____.', answer: '1/4' },
      { text: 'Plain statement with ____.', answer: 'word' },
    ],
    type: 'fill_blank',
  })
  assert.ok(!q.statements[0].text.includes('\\frac'))
  assert.ok(!q.statements[0].text.startsWith('<p>'), 'inline conversion keeps the blank segmentation')
  assert.equal(q.statements[0].answer, '1/4', 'the typed answer stays plain')
  assert.equal(q.statements[1].text, 'Plain statement with ____.')
})

test('the batch helper is null-safe', () => {
  assert.deepEqual(richifyGeneratedQuestions(null), [])
  assert.deepEqual(richifyGeneratedQuestions([null]), [null])
})

console.log(`\ngeneratedQuizRichText: ${passed} passed\n`)
