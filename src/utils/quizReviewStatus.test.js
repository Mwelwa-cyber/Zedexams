// Quiz review status — plain `node` assertion tests.
// Run: node src/utils/quizReviewStatus.test.js
// Wired into test:all via the `test:quiz-review-status` npm script.

import assert from 'node:assert/strict'
import { buildReviewEntries, filterReviewEntries, reviewCounts } from './quizReviewStatus.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}`)
    throw err
  }
}

const q = (id, extra = {}) => ({ id, type: 'mcq', correctAnswer: 0, ...extra })
const standalone = (question) => ({ kind: 'standalone', question })
const passage = (questions) => ({ kind: 'passage', questions, passage: { questions } })

const SECTIONS = [
  standalone(q('q1')),
  passage([q('q2'), q('q3')]),
  standalone(q('q4', { type: 'short_answer', correctAnswer: 'osmosis' })),
]

test('flattens sections into numbered entries with section indices', () => {
  const entries = buildReviewEntries({ sections: SECTIONS })
  assert.equal(entries.length, 4)
  assert.deepEqual(entries.map((e) => e.number), [1, 2, 3, 4])
  assert.deepEqual(entries.map((e) => e.sectionIndex), [0, 1, 1, 2])
  assert.deepEqual(entries.map((e) => e.questionId), ['q1', 'q2', 'q3', 'q4'])
})

test('answered + bookmarked reflect runner state', () => {
  const entries = buildReviewEntries({
    sections: SECTIONS,
    answers: { q1: 0, q3: 2 },
    flagged: { q2: true },
  })
  assert.deepEqual(entries.map((e) => e.answered), [true, false, true, false])
  assert.deepEqual(entries.map((e) => e.bookmarked), [false, true, false, false])
})

test('EXAM MODE GUARANTEE: nothing revealed → correctness always null', () => {
  const entries = buildReviewEntries({
    sections: SECTIONS,
    answers: { q1: 0, q2: 1, q3: 2 },
    revealed: {}, // exam mode never reveals before submit
  })
  assert.ok(entries.every((e) => e.correctness === null))
  assert.equal(reviewCounts(entries).hasCorrectness, false)
})

test('practice mode: revealed MCQ gets correct/incorrect from the answer key', () => {
  const entries = buildReviewEntries({
    sections: SECTIONS,
    answers: { q1: 0, q2: 3 },
    revealed: { q1: true, q2: true },
  })
  assert.equal(entries[0].correctness, 'correct')   // picked 0, key 0
  assert.equal(entries[1].correctness, 'incorrect') // picked 3, key 0
  assert.equal(entries[2].correctness, null)        // unrevealed
})

test('revealed AI-checked answers use aiResults.correct', () => {
  const entries = buildReviewEntries({
    sections: [standalone(q('t1', { type: 'short_answer' }))],
    answers: { t1: { text: 'osmosis' } },
    revealed: { t1: true },
    aiResults: { t1: { correct: true } },
  })
  assert.equal(entries[0].correctness, 'correct')
})

test('revealed typed answers fall back to answer.correct', () => {
  const entries = buildReviewEntries({
    sections: [standalone(q('t2', { type: 'short_answer' }))],
    answers: { t2: { text: 'wrong', correct: false } },
    revealed: { t2: true },
  })
  assert.equal(entries[0].correctness, 'incorrect')
})

test('revealed question with no cheap check stays null (never guesses)', () => {
  const entries = buildReviewEntries({
    sections: [standalone(q('m1', { type: 'matching', correctAnswer: undefined }))],
    answers: { m1: [0, 1, 2] },
    revealed: { m1: true },
  })
  assert.equal(entries[0].correctness, null)
})

test('filters: unanswered / bookmarked / incorrect / all', () => {
  const entries = buildReviewEntries({
    sections: SECTIONS,
    answers: { q1: 1, q2: 0 },
    flagged: { q4: true },
    revealed: { q1: true },
  })
  assert.deepEqual(filterReviewEntries(entries, 'unanswered').map((e) => e.questionId), ['q3', 'q4'])
  assert.deepEqual(filterReviewEntries(entries, 'bookmarked').map((e) => e.questionId), ['q4'])
  assert.deepEqual(filterReviewEntries(entries, 'incorrect').map((e) => e.questionId), ['q1'])
  assert.equal(filterReviewEntries(entries, 'all').length, 4)
})

test('reviewCounts tallies every status', () => {
  const entries = buildReviewEntries({
    sections: SECTIONS,
    answers: { q1: 0, q2: 3 },
    flagged: { q1: true, q3: true },
    revealed: { q1: true, q2: true },
  })
  const counts = reviewCounts(entries)
  assert.equal(counts.total, 4)
  assert.equal(counts.answered, 2)
  assert.equal(counts.unanswered, 2)
  assert.equal(counts.bookmarked, 2)
  assert.equal(counts.correct, 1)
  assert.equal(counts.incorrect, 1)
  assert.equal(counts.hasCorrectness, true)
})

test('empty/garbage input degrades safely', () => {
  assert.deepEqual(buildReviewEntries({}), [])
  assert.deepEqual(buildReviewEntries({ sections: null }), [])
  assert.deepEqual(filterReviewEntries(null, 'all'), [])
  assert.equal(reviewCounts(undefined).total, 0)
})

console.log(`✓ quizReviewStatus — ${passed} tests passed`)
