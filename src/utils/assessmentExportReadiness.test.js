/**
 * One readiness decision, three surfaces.
 *
 * The bypass these tests exist to close: every blocking rule the Assessment
 * Studio enforced could be sidestepped by exporting the same paper from the
 * library list instead, which checked `questions.length === 0` and nothing else.
 * A rule with a normal teacher workflow around it is not a rule.
 *
 * The subtlest case here is the `localId` one. A paper loaded from Firestore has
 * no `localId` — it is never persisted — and `collectQuizIssues` keys every
 * issue on it. Feed the documents straight in and you get a blocked paper whose
 * message names no question: it looks like the gate is working right up until a
 * teacher tries to act on it.
 *
 * Run: node src/utils/assessmentExportReadiness.test.js
 */

import assert from 'node:assert/strict'
import {
  buildAssessmentExportReadiness, buildSavedAssessmentExportReadiness, buildQuestionNumberMap,
} from './assessmentExportReadiness.js'

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

const catalog = { triangle: '<svg/>' }
const resolve = (key) => catalog[key] || null

/** A finished standalone question, in editor-section shape. */
const goodQuestion = (localId, over = {}) => ({
  localId,
  type: 'short_answer',
  text: '<p>Name the largest river in Zambia.</p>',
  marks: 2,
  ...over,
})
const sectionOf = (question) => ({ kind: 'standalone', question })
const paperDetails = { title: 'Term Test', subject: 'Geography', grade: '7' }

const readiness = (questions, over = {}) => buildAssessmentExportReadiness({
  sections: questions.map(sectionOf),
  parts: [],
  paperDetails,
  serialized: { questions, passages: [], questionCount: questions.length, totalMarks: 2 },
  diagramResolver: resolve,
  ...over,
})

console.log('\n— a finished paper is ready —')

test('a complete paper exports', () => {
  const r = readiness([goodQuestion('a'), goodQuestion('b')])
  assert.equal(r.gate.blocked, false)
  assert.equal(r.gate.reason, 'ready')
  assert.equal(r.questionCount, 2)
})

test('the prepared model comes back with the decision', () => {
  // The point of one adapter: a caller gets the questions it will export AND the
  // verdict about them, rather than deriving the first and trusting the second.
  const r = readiness([goodQuestion('a')])
  assert.equal(r.questions.length, 1)
  assert.deepEqual(r.questionNumbers, { a: 1 })
  assert.ok(Array.isArray(r.issues))
})

console.log('\n— the three blocking rules, from one place —')

test('an empty paper cannot export', () => {
  const r = readiness([])
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'empty')
})

test('an unfinished question cannot export, and is named', () => {
  const r = readiness([goodQuestion('a'), goodQuestion('b', { text: '' })])
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'incomplete-questions')
  assert.deepEqual(r.gate.numbers, [2], 'the second question, by its printed number')
})

test('a missing required figure cannot export', () => {
  const r = readiness([
    goodQuestion('a'),
    goodQuestion('b', { imageDiagram: { libraryKey: 'not-in-the-catalog' } }),
  ])
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'unresolved-figure')
  assert.match(r.gate.message, /^Question 2 requires a diagram/)
})

test('a passage diagram is covered too', () => {
  const r = buildAssessmentExportReadiness({
    sections: [sectionOf(goodQuestion('a'))],
    paperDetails,
    serialized: {
      questions: [goodQuestion('a')],
      passages: [{ id: 'p1', title: 'The Zambezi', imageDiagram: { libraryKey: 'gone' } }],
      questionCount: 1,
    },
    diagramResolver: resolve,
  })
  assert.equal(r.gate.reason, 'unresolved-figure')
})

test('a caller that forgets the resolver is refused', () => {
  // Otherwise the gate silently checks everything except figures — the failure
  // mode where the surface looks wired up and protects less than the studio.
  assert.throws(() => buildAssessmentExportReadiness({ sections: [] }), TypeError)
})

test('pre-computed issues are used rather than recomputed', () => {
  // The studio already shows these as badges. Computing them twice is two
  // answers to one question, and the day they diverge the badge and the banner
  // disagree.
  const r = readiness([goodQuestion('a')], {
    validationIssues: [{ id: 'subject', label: 'Pick a subject.', severity: 'error', localId: null }],
  })
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'paper-details')
})

console.log('\n— a paper loaded from Firestore —')

/** A stored question document: an `id`, and NO `localId`. */
const storedQuestion = (id, over = {}) => ({
  id,
  order: over.order ?? 0,
  type: 'short_answer',
  text: '<p>Name the largest river in Zambia.</p>',
  marks: 2,
  ...over,
})
const assessment = { title: 'Term Test', subject: 'Geography', grade: '7', passages: [], parts: [] }

test('a saved paper with finished questions is ready', () => {
  const r = buildSavedAssessmentExportReadiness(
    assessment,
    [storedQuestion('q1', { order: 0 }), storedQuestion('q2', { order: 1 })],
    resolve,
  )
  assert.equal(r.gate.blocked, false, `expected ready, got ${r.gate.message}`)
  assert.equal(r.questionCount, 2)
})

test('a saved paper with an unfinished question NAMES it', () => {
  // THE test for the localId trap. Stored documents carry no localId, and
  // collectQuizIssues keys every issue on one. Without hydration the issue ids
  // become `question-text-undefined`, the numbers come back empty, and the gate
  // falls through to a generic message that names nothing — blocked, but
  // useless. Hydration restores localId from the document id.
  const r = buildSavedAssessmentExportReadiness(
    assessment,
    [storedQuestion('q1', { order: 0 }), storedQuestion('q2', { order: 1, text: '' })],
    resolve,
  )
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'incomplete-questions', `got ${r.gate.reason}: ${r.gate.message}`)
  assert.deepEqual(r.gate.numbers, [2], 'named, not merely blocked')
  assert.match(r.gate.message, /Question 2 is not finished/)
})

test('a saved paper with no questions cannot export', () => {
  const r = buildSavedAssessmentExportReadiness(assessment, [], resolve)
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'empty')
})

test('a saved paper with a missing required figure cannot export', () => {
  const r = buildSavedAssessmentExportReadiness(
    assessment,
    [storedQuestion('q1', { imageDiagram: { libraryKey: 'gone' } })],
    resolve,
  )
  assert.equal(r.gate.blocked, true)
  assert.equal(r.gate.reason, 'unresolved-figure')
  assert.match(r.gate.message, /^Question 1 requires a diagram/)
})

test('a saved paper reads its passages from the assessment document', () => {
  // Passages are stored on the parent document, not in the questions
  // subcollection, so a check that only read the subcollection would leave every
  // passage stimulus diagram unprotected on this surface.
  //
  // The passage carries a real child question: a passage with none is itself a
  // blocking issue, and would have made this pass for the wrong reason.
  const paper = {
    ...assessment,
    passages: [{
      id: 'p1',
      title: 'The Zambezi',
      passageText: '<p>The Zambezi rises in north-western Zambia.</p>',
      imageDiagram: { libraryKey: 'gone' },
      order: 0,
    }],
  }
  const r = buildSavedAssessmentExportReadiness(
    paper,
    [storedQuestion('q1', { order: 0, passageId: 'p1' })],
    resolve,
  )
  assert.equal(r.gate.reason, 'unresolved-figure', `got ${r.gate.reason}: ${r.gate.message}`)
})

test('the saved and editor paths agree about the same paper', () => {
  // The property that makes this one gate rather than two: the same paper
  // blocks for the same reason whichever surface a teacher exports it from.
  const broken = { text: '' }
  const fromEditor = readiness([goodQuestion('q1'), goodQuestion('q2', broken)])
  const fromStore = buildSavedAssessmentExportReadiness(
    assessment,
    [storedQuestion('q1', { order: 0 }), storedQuestion('q2', { order: 1, ...broken })],
    resolve,
  )
  assert.equal(fromEditor.gate.reason, fromStore.gate.reason)
  assert.deepEqual(fromEditor.gate.numbers, fromStore.gate.numbers)
  assert.equal(fromEditor.gate.message, fromStore.gate.message, 'the same sentence, both surfaces')
})

console.log('\n— the number map —')

test('numbers are position, keyed the way the issues are', () => {
  assert.deepEqual(
    buildQuestionNumberMap([{ localId: 'a' }, { localId: 'b' }, { localId: 'c' }]),
    { a: 1, b: 2, c: 3 },
  )
  assert.deepEqual(buildQuestionNumberMap(), {})
})

console.log(`\n✓ assessment export readiness — ${passed} tests passed`)
