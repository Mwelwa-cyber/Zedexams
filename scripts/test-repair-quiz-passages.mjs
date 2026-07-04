/**
 * Unit tests for scripts/repairQuizPassagesCore.mjs — the pure logic behind the
 * quiz counts/passages repair tool. Plain `node` assertion script (throws on
 * failure), discovered by scripts/run-all-tests.mjs via the test:* npm key.
 */

import assert from 'node:assert/strict'
import {
  recomputeCounts,
  rebuildPassages,
  extractInlinePassage,
  planQuizRepair,
} from './repairQuizPassagesCore.mjs'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ── recomputeCounts ───────────────────────────────────────────────
test('recomputeCounts recounts a doc whose questionCount drifted to 0', () => {
  const quiz = { mode: 'imported_document', questionCount: 0, reviewCount: 59 }
  const questions = Array.from({ length: 60 }, (_, i) => ({
    marks: 1,
    requiresReview: i < 59,
  }))
  const counts = recomputeCounts(quiz, questions, [])
  assert.equal(counts.questionCount, 60, 'counts the real subcollection, not the stale field')
  assert.equal(counts.totalMarks, 60)
  assert.equal(counts.reviewCount, 59, 'reviewCount recomputed from requiresReview flags')
})

test('recomputeCounts leaves reviewCount untouched for non-imported quizzes', () => {
  const quiz = { mode: 'hand', questionCount: 3, reviewCount: 7 }
  const counts = recomputeCounts(quiz, [{ marks: 2 }, { marks: 2 }], [])
  assert.equal(counts.questionCount, 2)
  assert.equal(counts.totalMarks, 4)
  assert.equal(counts.reviewCount, 7, 'non-import reviewCount is preserved, not forced to 0')
})

test('recomputeCounts defaults missing marks to 1', () => {
  const counts = recomputeCounts({}, [{}, { marks: 3 }, {}], [])
  assert.equal(counts.totalMarks, 5)
})

// ── extractInlinePassage ──────────────────────────────────────────
test('extractInlinePassage prefers passageText, then passage', () => {
  assert.equal(extractInlinePassage({ passageText: 'A', passage: 'B' }).text, 'A')
  assert.equal(extractInlinePassage({ passage: 'B' }).text, 'B')
  assert.equal(extractInlinePassage({}).text, '')
})

test('extractInlinePassage recovers a Tiptap doc from passageJSON', () => {
  const doc = { type: 'doc', content: [] }
  assert.deepEqual(extractInlinePassage({ passageJSON: doc }).textJSON, doc)
  assert.equal(extractInlinePassage({ passageJSON: { nope: true } }).textJSON, null)
})

// ── rebuildPassages ───────────────────────────────────────────────
test('rebuildPassages restores a passage a question references but the doc dropped', () => {
  const existing = [] // passages[] was wiped
  const questions = [
    { passageId: 'p1', order: 1, passage: 'The lion hunts at night.' },
    { passageId: 'p1', order: 2 },
  ]
  const { passages, report } = rebuildPassages(existing, questions)
  assert.equal(passages.length, 1)
  assert.equal(passages[0].id, 'p1')
  assert.equal(passages[0].passageText, 'The lion hunts at night.', 'text recovered from inline copy')
  assert.equal(passages[0].recovered, true)
  assert.equal(report[0].action, 'recreated')
  assert.equal(report[0].textRecovered, true)
  assert.equal(report[0].linkedQuestions, 2)
})

test('rebuildPassages creates a stub (no fabricated text) when nothing is recoverable', () => {
  const { passages, report } = rebuildPassages([], [{ passageId: 'p9', order: 3 }])
  assert.equal(passages.length, 1)
  assert.equal(passages[0].passageText, '', 'no text invented when none survives')
  assert.equal(report[0].textRecovered, false)
})

test('rebuildPassages refills blank text on an existing passage from a linked question', () => {
  const existing = [{ id: 'p1', title: 'Comprehension', passageText: '', order: 0 }]
  const questions = [{ passageId: 'p1', order: 1, passageText: 'Recovered body.' }]
  const { passages, report } = rebuildPassages(existing, questions)
  assert.equal(passages[0].passageText, 'Recovered body.')
  assert.equal(report[0].action, 'refilled-text')
})

test('rebuildPassages never overwrites existing non-empty passage text', () => {
  const existing = [{ id: 'p1', passageText: 'Original.', order: 0 }]
  const questions = [{ passageId: 'p1', passage: 'Different inline.' }]
  const { passages, report } = rebuildPassages(existing, questions)
  assert.equal(passages[0].passageText, 'Original.', 'original text is authoritative')
  assert.equal(report.length, 0, 'no change reported when nothing needed doing')
})

test('rebuildPassages keeps an existing passage even with no linked questions', () => {
  const existing = [{ id: 'orphan', passageText: 'Keep me.', order: 0 }]
  const { passages } = rebuildPassages(existing, [])
  assert.equal(passages.length, 1, 'nothing is ever dropped')
  assert.equal(passages[0].id, 'orphan')
})

test('rebuildPassages ignores questions with no passageId', () => {
  const { passages } = rebuildPassages([], [{ order: 1 }, { passageId: '', order: 2 }])
  assert.equal(passages.length, 0)
})

// ── planQuizRepair ────────────────────────────────────────────────
test('planQuizRepair emits a minimal patch for the reported "0 Q · 60 to review" case', () => {
  const quiz = {
    title: 'Grade 7 social studies past paper 2024',
    mode: 'imported_document',
    questionCount: 0,
    // reviewCount drifted too (the badge kept an older snapshot).
    reviewCount: 12,
    passageCount: 0,
    passages: [],
  }
  const questions = Array.from({ length: 60 }, (_, i) => ({
    marks: 1,
    order: i + 1,
    requiresReview: true,
    ...(i < 5 ? { passageId: 'src1' } : {}),
  }))
  const plan = planQuizRepair(quiz, questions)
  assert.equal(plan.changed, true)
  assert.equal(plan.updates.questionCount, 60, 'card will now show 60 Q, not 0')
  assert.equal(plan.updates.totalMarks, 60)
  assert.equal(plan.updates.reviewCount, 60)
  assert.ok(Array.isArray(plan.updates.passages), 'the dropped source passage is restored')
  assert.equal(plan.updates.passages.length, 1)
  assert.equal(plan.updates.passageCount, 1)
})

test('planQuizRepair reports no change for an already-consistent quiz', () => {
  const quiz = { questionCount: 2, totalMarks: 2, reviewCount: 0, passageCount: 0, passages: [] }
  const plan = planQuizRepair(quiz, [{ marks: 1 }, { marks: 1 }])
  assert.equal(plan.changed, false)
  assert.deepEqual(plan.updates, {})
})

test('planQuizRepair never puts a delete/removal into the patch', () => {
  const quiz = { questionCount: 5, totalMarks: 5, passages: [{ id: 'p1', passageText: 'x', order: 0 }] }
  // subcollection genuinely has fewer questions now, but we still only ADD/adjust
  const plan = planQuizRepair(quiz, [{ marks: 1 }])
  // passages[] with the existing block is preserved, never emptied
  if (plan.updates.passages) {
    assert.ok(plan.updates.passages.some(p => p.id === 'p1'), 'existing passage survives any patch')
  }
})

console.log(`\nrepair-quiz-passages: ${passed} test(s) passed`)
