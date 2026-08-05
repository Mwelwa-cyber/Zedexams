/**
 * The presentation rules a choice question follows, asserted without a browser.
 *
 * These are the ones worth having cheaply: that the letters come from the
 * shared rule rather than from arithmetic, and that an exam never carries the
 * answer key in its markup. The second is not a visual bug if it breaks — it is
 * the assessment being wrong — so it should be provable by running node, not by
 * rendering and reading the DOM.
 */
import assert from 'node:assert/strict'
import { buildChoiceRows, isAnswerable } from './choiceRows.js'
import { optionLabel } from '../../../../functions/shared/assessment/answerChoicesCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const rich = (text) => ({ version: 1, tiptapDoc: null, plainTextFallback: text })
const question = (over = {}) => ({
  id: 'q1', type: 'mcq', marks: 1, topicIds: [], answerKey: {},
  prompt: rich('What is 1 + 1?'),
  options: [rich('1'), rich('2'), rich('3'), rich('4')],
  correctIndex: 1,
  ...over,
})

console.log('engine — choice rows')

// ── Letters ──────────────────────────────────────────────────────────────────

test('rows are lettered A, B, C, D in order', () => {
  assert.deepEqual(buildChoiceRows({ question: question(), answer: null }).map((r) => r.letter),
    ['A', 'B', 'C', 'D'])
})

test('the letters come from the SHARED rule, not from arithmetic here', () => {
  // `optionLabel` lives in the shared package because how many choices a
  // question offers and what they are called is a rule the export gate
  // enforces on papers. A learner reading "C" and a marking key printing "C"
  // is one function called twice, not two implementations that agree today.
  const rows = buildChoiceRows({
    question: question({ options: Array.from({ length: 5 }, (_, i) => rich(String(i))) }),
    answer: null,
  })
  assert.deepEqual(rows.map((r) => r.letter), [0, 1, 2, 3, 4].map(optionLabel))
  assert.equal(rows[4].letter, 'E', 'the fifth option is lettered, not blank — the D4 defect')
})

test('a true/false question is lettered A and B', () => {
  const rows = buildChoiceRows({
    question: question({ type: 'tf', options: [rich('True'), rich('False')], correctIndex: 0 }),
    answer: null,
  })
  assert.deepEqual(rows.map((r) => r.letter), ['A', 'B'])
})

// ── Selection ────────────────────────────────────────────────────────────────

test('exactly the answered row is selected', () => {
  const rows = buildChoiceRows({ question: question(), answer: 2 })
  assert.deepEqual(rows.map((r) => r.selected), [false, false, true, false])
})

test('answering nothing selects nothing', () => {
  for (const answer of [null, undefined]) {
    assert.deepEqual(buildChoiceRows({ question: question(), answer }).map((r) => r.selected),
      [false, false, false, false])
  }
})

test('index 0 is a real answer, not a falsy nothing', () => {
  // The classic bug in this shape: `answer && …` treats picking A as unanswered.
  assert.equal(buildChoiceRows({ question: question(), answer: 0 })[0].selected, true)
})

// ── Verdicts, and when they may appear ───────────────────────────────────────

test('nothing is marked correct or wrong until it is revealed', () => {
  // Exam mode never reveals. If a row could carry `correct` while unrevealed,
  // the key would be in the DOM of an exam — readable by anyone who opens the
  // inspector. That is not a rendering bug; it is the assessment being wrong.
  const rows = buildChoiceRows({ question: question(), answer: 0, revealed: false })
  assert.equal(rows.some((r) => r.correct), false)
  assert.equal(rows.some((r) => r.wrong), false)
})

test('revealed: the key is correct and the learner\'s wrong pick is wrong', () => {
  const rows = buildChoiceRows({ question: question(), answer: 0, revealed: true })
  assert.deepEqual(rows.map((r) => r.correct), [false, true, false, false])
  assert.deepEqual(rows.map((r) => r.wrong), [true, false, false, false])
})

test('revealed with the right answer: correct, and nothing wrong', () => {
  const rows = buildChoiceRows({ question: question(), answer: 1, revealed: true })
  assert.deepEqual(rows.map((r) => r.correct), [false, true, false, false])
  assert.equal(rows.some((r) => r.wrong), false)
})

test('revealed with no answer: the key still shows, nothing is wrong', () => {
  // Skipping a question in practice should still teach the learner the answer.
  const rows = buildChoiceRows({ question: question(), answer: null, revealed: true })
  assert.equal(rows[1].correct, true)
  assert.equal(rows.some((r) => r.wrong), false)
})

test('an unanswerable key marks NOTHING correct rather than guessing', () => {
  // `fromQuiz` returns null for a stored index pointing past the end of the
  // options — a corrupt document. Painting a row green would invent an answer
  // the paper does not state.
  const rows = buildChoiceRows({ question: question({ correctIndex: null }), answer: 0, revealed: true })
  assert.equal(rows.some((r) => r.correct), false)
  assert.equal(rows[0].wrong, true, 'the learner\'s pick is still not the key')
})

// ── Answerability ────────────────────────────────────────────────────────────

test('a choice question with no options is not answerable', () => {
  // It would render as a prompt with nothing under it: visually a paragraph,
  // functionally a question the learner cannot answer.
  assert.equal(isAnswerable(question({ options: [] })), false)
  assert.equal(isAnswerable(question()), true)
  assert.equal(isAnswerable(null), false)
})

test('the row carries the option CONTENT untouched', () => {
  // The envelope reaches the component whole; nothing here flattens rich
  // content to a string, which is what would drop KaTeX school notation.
  const content = { version: 1, tiptapDoc: { type: 'doc' }, plainTextFallback: '2' }
  assert.equal(buildChoiceRows({ question: question({ options: [content] }), answer: null })[0].content, content)
})

console.log(`\nengine choice rows: ${passed} passed`)
