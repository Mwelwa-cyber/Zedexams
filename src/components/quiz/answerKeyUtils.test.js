/**
 * Tests for the bulk answer-key utilities. Plain `node` ES-module script —
 * throws on first failed assertion.
 *
 * Run: node src/components/quiz/answerKeyUtils.test.js
 */

import assert from 'node:assert'
import {
  collectAnswerableQuestions,
  parseAnswerKey,
  applyAnswerKeyToSections,
  countUnansweredQuestions,
  collectAiAnswerTargets,
} from './answerKeyUtils.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const standalone = (q) => ({ kind: 'standalone', question: q })
const passage = (questions) => ({ kind: 'passage', passage: { questions } })
const mcq = (over = {}) => ({ localId: 'q1', type: 'mcq', options: ['a', 'b', 'c', 'd'], correctAnswer: '', ...over })

console.log('answerKeyUtils')

// ── collectAnswerableQuestions ───────────────────────────────────────────────

test('collects MCQs from standalone + passage sections in order', () => {
  const list = collectAnswerableQuestions([
    standalone(mcq({ localId: 'a', sourceQuestionNumber: 1 })),
    passage([mcq({ localId: 'b', sourceQuestionNumber: 2 }), mcq({ localId: 'c', sourceQuestionNumber: 3 })]),
    standalone(mcq({ localId: 'd', sourceQuestionNumber: 4 })),
  ])
  assert.deepEqual(list.map(q => q.localId), ['a', 'b', 'c', 'd'])
  assert.deepEqual(list.map(q => q.number), [1, 2, 3, 4])
  assert.equal(list[1].inPassage, true)
  assert.equal(list[0].inPassage, false)
})

test('skips non-MCQ questions and pagebreaks', () => {
  const list = collectAnswerableQuestions([
    standalone(mcq({ localId: 'a' })),
    standalone({ localId: 'sa', type: 'short_answer', options: [] }),
    { kind: 'pagebreak' },
    standalone(mcq({ localId: 'b' })),
  ])
  assert.deepEqual(list.map(q => q.localId), ['a', 'b'])
})

test('falls back to a running number when sourceQuestionNumber is absent', () => {
  const list = collectAnswerableQuestions([
    standalone(mcq({ localId: 'a' })),
    standalone(mcq({ localId: 'b' })),
  ])
  assert.deepEqual(list.map(q => q.number), [1, 2])
})

test('reads the current correct index and image-option flag', () => {
  const list = collectAnswerableQuestions([
    standalone(mcq({ localId: 'a', correctAnswer: 2 })),
    standalone(mcq({ localId: 'b', correctAnswer: '' })),
    standalone(mcq({ localId: 'c', optionMedia: [{ imageUrl: 'x' }, null, null, null] })),
  ])
  assert.equal(list[0].correctIndex, 2)
  assert.equal(list[1].correctIndex, null)
  assert.equal(list[2].hasImageOptions, true)
})

test('treats truefalse as answerable with its option count', () => {
  const list = collectAnswerableQuestions([
    standalone({ localId: 'a', type: 'truefalse', options: ['True', 'False'], correctAnswer: '' }),
  ])
  assert.equal(list.length, 1)
  assert.equal(list[0].optionCount, 2)
})

// ── parseAnswerKey ───────────────────────────────────────────────────────────

const qList = [
  { localId: 'a', number: 1, optionCount: 4 },
  { localId: 'b', number: 2, optionCount: 4 },
  { localId: 'c', number: 3, optionCount: 4 },
]

test('parses a positional letter run', () => {
  assert.deepEqual(parseAnswerKey('ACB', qList), { a: 0, c: 1, b: 2 })
})

test('parses spaced / lowercase letters', () => {
  assert.deepEqual(parseAnswerKey('a c b', qList), { a: 0, c: 1, b: 2 })
})

test('parses a numbered key (wins over position)', () => {
  assert.deepEqual(parseAnswerKey('1A 2C 3B', qList), { a: 0, b: 2, c: 1 })
  assert.deepEqual(parseAnswerKey('2.D, 1) A', qList), { b: 3, a: 0 })
})

test('ignores out-of-range letters without shifting later answers', () => {
  // Positional: A→Q1, E→Q2, B→Q3. E is index 4 (out of range for a 4-option
  // question) so Q2 is left unset — crucially, the typo does NOT shift B onto
  // Q2. Q3 still gets B (localId 'c', index 1).
  assert.deepEqual(parseAnswerKey('AEB', qList), { a: 0, c: 1 })
})

test('ignores numbers that match no question', () => {
  assert.deepEqual(parseAnswerKey('9A 1B', qList), { a: 1 })
})

test('returns an empty map for junk input', () => {
  assert.deepEqual(parseAnswerKey('', qList), {})
  assert.deepEqual(parseAnswerKey('???', qList), {})
})

// ── applyAnswerKeyToSections ─────────────────────────────────────────────────

test('applies answers by localId without reordering or touching others', () => {
  const sections = [
    standalone(mcq({ localId: 'a', correctAnswer: '' })),
    passage([mcq({ localId: 'b', correctAnswer: '' }), mcq({ localId: 'c', correctAnswer: 1 })]),
  ]
  const { sections: next, changed } = applyAnswerKeyToSections(sections, { a: 2, b: 0 })
  assert.equal(changed, 2)
  assert.equal(next[0].question.correctAnswer, 2)
  assert.equal(next[1].passage.questions[0].correctAnswer, 0)
  // Unchanged question keeps its exact identity (no needless re-render).
  assert.strictEqual(next[1].passage.questions[1], sections[1].passage.questions[1])
})

test('no-op when the key sets the value already present', () => {
  const sections = [standalone(mcq({ localId: 'a', correctAnswer: 2 }))]
  const { sections: next, changed } = applyAnswerKeyToSections(sections, { a: 2 })
  assert.equal(changed, 0)
  assert.strictEqual(next[0], sections[0])
})

test('ignores localIds not present in the quiz', () => {
  const sections = [standalone(mcq({ localId: 'a', correctAnswer: '' }))]
  const { changed } = applyAnswerKeyToSections(sections, { zzz: 1 })
  assert.equal(changed, 0)
})

test('can clear an answer back to blank', () => {
  const sections = [standalone(mcq({ localId: 'a', correctAnswer: 2 }))]
  const { sections: next, changed } = applyAnswerKeyToSections(sections, { a: '' })
  assert.equal(changed, 1)
  assert.equal(next[0].question.correctAnswer, '')
})

// ── countUnansweredQuestions ─────────────────────────────────────────────────

test('counts questions still missing an answer', () => {
  const list = [
    { correctIndex: 0 },
    { correctIndex: null },
    { correctIndex: null },
  ]
  assert.equal(countUnansweredQuestions(list), 2)
})

// ── collectAiAnswerTargets ───────────────────────────────────────────────────

const plain = (v) => String(v ?? '').replace(/<[^>]+>/g, '')

test('collectAiAnswerTargets returns id+text+options for unanswered MCQs only', () => {
  const sections = [
    standalone(mcq({ localId: 'a', text: '<p>2+2?</p>', options: ['<p>3</p>', '<p>4</p>'], correctAnswer: '' })),
    standalone(mcq({ localId: 'b', text: '3+3?', options: ['5', '6'], correctAnswer: 1 })), // answered → skipped
    passage([mcq({ localId: 'c', text: 'Who?', options: ['x', 'y'], correctAnswer: '' })]),
  ]
  const targets = collectAiAnswerTargets(sections, plain, { onlyUnanswered: true })
  assert.deepEqual(targets.map(t => t.id), ['a', 'c'])
  assert.deepEqual(targets[0], { id: 'a', text: '2+2?', options: ['3', '4'] })
})

test('collectAiAnswerTargets can include already-answered questions', () => {
  const sections = [standalone(mcq({ localId: 'b', text: 'q', options: ['5', '6'], correctAnswer: 1 }))]
  assert.equal(collectAiAnswerTargets(sections, plain, { onlyUnanswered: false }).length, 1)
})

test('collectAiAnswerTargets skips non-MCQ, empty-stem, and <2-option questions', () => {
  const sections = [
    standalone(mcq({ localId: 'a', type: 'short_answer', text: 'open', options: [] })),
    standalone(mcq({ localId: 'b', text: '', options: ['a', 'b'] })),
    standalone(mcq({ localId: 'c', text: 'one option', options: ['a'] })),
  ]
  assert.equal(collectAiAnswerTargets(sections, plain).length, 0)
})

console.log(`\nanswerKeyUtils: ${passed} passed`)
