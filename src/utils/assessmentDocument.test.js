/**
 * The canonical document: one resolution, four renderers.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  ASSESSMENT_DOCUMENT_VERSION, bodyBlocks, buildAssessmentDocument, indexBlocks,
  isBodyBlock, readLayoutPreferences, resolvePageNumbering,
} from './assessmentDocument.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const paper = {
  schoolName: 'Kabulonga Primary', subject: 'Science', grade: 5, term: 1,
  assessmentType: 'mid_term', answerChoiceCount: 4,
}
const questions = [
  { localId: 'a', order: 1, type: 'mcq', text: 'One?', options: ['w', 'x', 'y', 'z'], correctAnswer: 0, marks: 1 },
  { localId: 'b', order: 2, type: 'short', text: 'Two?', marks: 4 },
]

console.log('\n— the shape —')

test('the document carries everything a renderer needs and nothing it must derive', () => {
  const doc = buildAssessmentDocument(paper, questions)
  assert.equal(doc.version, ASSESSMENT_DOCUMENT_VERSION)
  for (const key of ['meta', 'layout', 'marks', 'choices', 'blocks', 'pageNumbering', 'totalMarks']) {
    assert.ok(doc[key] !== undefined, `${key} is on the document`)
  }
  assert.equal(doc.mode, 'paper')
  assert.equal(doc.questionCount, 2)
  assert.equal(doc.totalMarks, 5)
})

test('the marking key is the same document in a different mode, not a second layout', () => {
  const key = buildAssessmentDocument(paper, questions, { mode: 'scheme' })
  const learner = buildAssessmentDocument(paper, questions, { mode: 'paper' })
  assert.equal(key.mode, 'scheme')
  const questionsOf = (doc) => doc.blocks.filter((b) => b.kind === 'question')
  assert.deepEqual(
    questionsOf(key).map((b) => [b.number, b.marks, b.options.length]),
    questionsOf(learner).map((b) => [b.number, b.marks, b.options.length]),
    'the same questions, in the same order, worth the same, offering the same choices',
  )
  assert.equal(key.totalMarks, learner.totalMarks)
  // The one structural difference is deliberate and it is the marking-key
  // notice: a key always carries an instructions block, a learner paper only
  // when the teacher wrote instructions.
  assert.ok(key.blocks.some((b) => b.kind === 'instructions' && b.isMarkingKey))
  assert.ok(!learner.blocks.some((b) => b.kind === 'instructions'))
  assert.equal(key.blocks.length, learner.blocks.length + 1)
})

test('the learner paper never carries an answer', () => {
  const learner = buildAssessmentDocument(paper, [
    { ...questions[0], explanation: 'Because w is correct.' },
  ], { mode: 'paper' })
  const block = learner.blocks.find((b) => b.kind === 'question')
  assert.equal(block.showAnswer, false)
  assert.equal(block.explanation, '')
})

test('an unknown mode is the learner paper, never a half-marking-key', () => {
  assert.equal(buildAssessmentDocument(paper, questions, { mode: 'nonsense' }).mode, 'paper')
})

console.log('\n— block indices —')

test('every block carries its position', () => {
  const doc = buildAssessmentDocument(paper, questions)
  doc.blocks.forEach((block, i) => assert.equal(block.index, i))
})

test('indexing is idempotent and does not copy a block that already agrees', () => {
  const blocks = [{ kind: 'header' }, { kind: 'question' }]
  const once = indexBlocks(blocks)
  const twice = indexBlocks(once)
  assert.equal(twice[0], once[0], 'a block already at its index is passed through by reference')
  assert.deepEqual(twice.map((b) => b.index), [0, 1])
})

test('an empty list indexes to an empty list', () => {
  assert.deepEqual(indexBlocks([]), [])
  assert.deepEqual(indexBlocks(null), [])
})

console.log('\n— the body —')

test('the paper code is not part of the flowing body', () => {
  assert.equal(isBodyBlock({ kind: 'footerCode' }), false)
  assert.equal(isBodyBlock({ kind: 'question' }), true)
  const doc = buildAssessmentDocument(paper, questions)
  assert.ok(doc.blocks.some((b) => b.kind === 'footerCode'))
  assert.ok(!bodyBlocks(doc).some((b) => b.kind === 'footerCode'))
})

test('body blocks keep the indices they were given', () => {
  const doc = buildAssessmentDocument(paper, questions)
  const body = bodyBlocks(doc)
  assert.deepEqual(body.map((b) => b.index), body.map((b) => doc.blocks.indexOf(b)))
})

test('a document with nothing in it has an empty body rather than throwing', () => {
  assert.deepEqual(bodyBlocks(null), [])
  assert.deepEqual(bodyBlocks({}), [])
})

console.log('\n— layout preferences —')

test('a nested layout object wins over loose top-level fields', () => {
  const prefs = readLayoutPreferences({ orientation: 'portrait', layout: { orientation: 'landscape' } })
  assert.equal(prefs.orientation, 'landscape')
})

test('a paper saved before the layout object existed still resolves', () => {
  const doc = buildAssessmentDocument({ ...paper, orientation: 'landscape', pageSize: 'a5' }, questions)
  assert.equal(doc.layout.orientation, 'landscape')
  assert.equal(doc.layout.pageSize, 'a5')
})

console.log('\n— page numbering —')

test('pages are numbered by default, in the "of total" form', () => {
  const n = resolvePageNumbering({})
  assert.equal(n.show, true)
  assert.equal(n.label(2, 3), 'Page 2 of 3')
})

test('a paper can number pages without a total, or not at all', () => {
  assert.equal(resolvePageNumbering({ pageNumberFormat: 'page-only' }).label(2, 3), 'Page 2')
  assert.equal(resolvePageNumbering({ showPageNumbers: false }).show, false)
})

console.log('\n— what does not change on read —')

test('building a document never mutates the paper or its questions', () => {
  const storedPaper = JSON.parse(JSON.stringify(paper))
  const storedQuestions = JSON.parse(JSON.stringify(questions))
  buildAssessmentDocument(storedPaper, storedQuestions, { mode: 'scheme' })
  assert.deepEqual(storedPaper, paper)
  assert.deepEqual(storedQuestions, questions)
})

test('the same inputs produce the same document twice', () => {
  const a = buildAssessmentDocument(paper, questions)
  const b = buildAssessmentDocument(paper, questions)
  assert.equal(JSON.stringify(a.blocks), JSON.stringify(b.blocks))
  assert.equal(a.totalMarks, b.totalMarks)
})

console.log(`\n✓ assessment document — ${passed} tests passed`)
