/**
 * Unit tests for activityBankCore — mapping generated lesson activities into
 * reusable Question Bank entries.
 *
 *   node src/utils/activityBankCore.test.js
 */

import assert from 'node:assert'
import { activityQuestionToBank, activityToBankQuestions } from './activityBankCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok — ${name}`)
}

console.log('activityBankCore')

test('MCQ maps letter answer to a 0-based index', () => {
  const q = activityQuestionToBank(
    { type: 'multiple_choice', prompt: 'Pick', options: ['a', 'b', 'c', 'd'], answer: 'C', marks: 2 },
    { topic: 'Fractions' },
  )
  assert.strictEqual(q.type, 'mcq')
  assert.strictEqual(q.correctAnswer, 2)
  assert.strictEqual(q.marks, 2)
  assert.strictEqual(q.topic, 'Fractions')
  assert.strictEqual(q.contentVersion, 3)
})

test('MCQ with a numeric answer is clamped into range', () => {
  const q = activityQuestionToBank(
    { type: 'multiple_choice', prompt: 'Pick', options: ['a', 'b'], answer: 9 },
    {},
  )
  assert.strictEqual(q.correctAnswer, 1)
})

test('MCQ with fewer than two options is rejected', () => {
  assert.strictEqual(
    activityQuestionToBank({ type: 'multiple_choice', prompt: 'x', options: ['only'] }),
    null,
  )
})

test('true/false maps to tf with True first', () => {
  const t = activityQuestionToBank({ type: 'true_false', prompt: 'Sky is blue', answer: 'True' })
  assert.strictEqual(t.type, 'tf')
  assert.deepStrictEqual(t.options, ['True', 'False'])
  assert.strictEqual(t.correctAnswer, 0)
  const f = activityQuestionToBank({ type: 'true_false', prompt: 'Sky is green', answer: 'false' })
  assert.strictEqual(f.correctAnswer, 1)
})

test('short answer keeps the expected text answer', () => {
  const q = activityQuestionToBank({ type: 'short_answer', prompt: 'Capital of Zambia?', answer: 'Lusaka' })
  assert.strictEqual(q.type, 'short_answer')
  assert.strictEqual(q.correctAnswer, 'Lusaka')
})

test('fill-in-the-blank maps to fill_blanks', () => {
  const q = activityQuestionToBank({ type: 'fill_in_blank', prompt: 'Water is ____', answer: 'wet' })
  assert.strictEqual(q.type, 'fill_blanks')
  assert.strictEqual(q.correctAnswer, 'wet')
})

test('matching keeps index-aligned pairs', () => {
  const q = activityQuestionToBank({
    type: 'matching', prompt: 'Match',
    matchPairs: [{ left: 'cat', right: 'animal' }, { left: 'Lusaka', right: 'city' }],
  })
  assert.deepStrictEqual(q.matchingLeft, ['cat', 'Lusaka'])
  assert.deepStrictEqual(q.matchingRight, ['animal', 'city'])
  assert.deepStrictEqual(q.matchingAnswer, [0, 1])
})

test('structured questions are skipped (no single-answer bank shape)', () => {
  assert.strictEqual(
    activityQuestionToBank({ type: 'structured', prompt: 'Multi-part', parts: [{ prompt: 'a' }] }),
    null,
  )
})

test('activityToBankQuestions counts the skipped items', () => {
  const { questions, skipped } = activityToBankQuestions({
    questions: [
      { type: 'short_answer', prompt: 'Q1', answer: 'a' },
      { type: 'structured', prompt: 'Q2', parts: [] },
      { type: 'multiple_choice', prompt: 'Q3', options: ['x', 'y'], answer: 'A' },
    ],
  }, { topic: 'T' })
  assert.strictEqual(questions.length, 2)
  assert.strictEqual(skipped, 1)
})

console.log(`\nactivityBankCore: ${passed} tests passed`)
