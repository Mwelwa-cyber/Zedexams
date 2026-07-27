/**
 * A required figure the renderer cannot produce is a BLOCKING correctness error.
 *
 * The distinction these tests exist to hold: a figure that looks wrong is a
 * quality warning and the paper still downloads; a figure that is not there at
 * all means a learner is asked to label blank paper, and the export must not
 * happen. Everything below is about keeping those two apart, and about the gate
 * and the exporter describing the same missing diagram in the same words.
 *
 * Run: node src/utils/unresolvedFigures.test.js
 */

import assert from 'node:assert/strict'
import {
  unresolvedFigure, unresolvedFigureMessage, unresolvedFiguresMessage,
  unresolvedRequiredFigures, affectedQuestionNumbers, listNumbers,
  FIGURE_STAGES, STATIC_STAGE,
} from './unresolvedFigures.js'

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

console.log('\n— the sentence a teacher is shown —')

test('names the question and says what to do about it', () => {
  // The wording is specified, not stylistic: it has to name a question the
  // teacher can navigate to and an action they can take.
  assert.equal(
    unresolvedFigureMessage({ questionNumber: 5 }),
    'Question 5 requires a diagram, but the figure could not be rendered. '
    + 'Replace, regenerate or repair the diagram before exporting.',
  )
})

test('falls back to the paper when the question is unnumbered, never to "undefined"', () => {
  const msg = unresolvedFigureMessage({ questionNumber: null })
  assert.match(msg, /^A question on this paper requires a diagram/)
  assert.ok(!/undefined|null|NaN/.test(msg), msg)
  assert.equal(unresolvedFigureMessage(undefined), unresolvedFigureMessage({ questionNumber: null }))
})

test('one unresolved figure gets the exact single-figure sentence', () => {
  // A teacher fixing one diagram should not have to read a summary of one.
  assert.equal(
    unresolvedFiguresMessage([{ questionNumber: 5 }]),
    unresolvedFigureMessage({ questionNumber: 5 }),
  )
})

test('several questions are named in ascending order, whatever order they arrived in', () => {
  // The mismatch this pins: the gate sorted its badge numbers while the sentence
  // led with array position, so a paper badging 2 and 9 opened "Question 9".
  assert.equal(
    unresolvedFiguresMessage([{ questionNumber: 9 }, { questionNumber: 2 }]),
    'Questions 2 and 9 require diagrams, but the figures could not be rendered. '
    + 'Replace, regenerate or repair the diagrams before exporting.',
  )
  assert.equal(
    unresolvedFiguresMessage([{ questionNumber: 9 }, { questionNumber: 2 }, { questionNumber: 5 }]),
    'Questions 2, 5 and 9 require diagrams, but the figures could not be rendered. '
    + 'Replace, regenerate or repair the diagrams before exporting.',
  )
})

test('the message and the badge numbers can never disagree', () => {
  // Stated as a property rather than as three more examples: whatever the gate
  // badges must appear in the sentence a teacher reads.
  for (const entries of [
    [{ questionNumber: 3 }],
    [{ questionNumber: 9 }, { questionNumber: 2 }],
    [{ questionNumber: 4 }, { questionNumber: 4 }, { questionNumber: 1 }],
  ]) {
    const msg = unresolvedFiguresMessage(entries)
    for (const n of affectedQuestionNumbers(entries)) {
      assert.ok(msg.includes(String(n)), `${msg} names ${n}`)
    }
  }
})

test('two broken figures on ONE question stay one question', () => {
  // Counting figures rather than questions would send a teacher looking for a
  // second problem that is not there.
  assert.equal(
    unresolvedFiguresMessage([{ questionNumber: 5 }, { questionNumber: 5 }]),
    unresolvedFigureMessage({ questionNumber: 5 }),
  )
})

test('a named question alongside an unplaceable one mentions both', () => {
  // Naming only the one that has a number would quietly drop the other, and a
  // teacher who fixed question 5 would meet the same block with no idea why.
  assert.equal(
    unresolvedFiguresMessage([{ questionNumber: 5 }, { questionNumber: null }]),
    'Question 5 and another question on this paper require diagrams, but the figures '
    + 'could not be rendered. Replace, regenerate or repair the diagrams before exporting.',
  )
})

test('nothing numbered at all keeps the generic sentence', () => {
  assert.equal(
    unresolvedFiguresMessage([{ questionNumber: null }, { questionNumber: null }]),
    unresolvedFigureMessage({ questionNumber: null }),
  )
})

test('affectedQuestionNumbers never yields question 0', () => {
  // Number(null) is 0 and finite. Uncaught, an unnumbered figure badges the
  // first card on the paper.
  assert.deepEqual(affectedQuestionNumbers([{ questionNumber: null }, { questionNumber: 4 }]), [4])
  assert.deepEqual(affectedQuestionNumbers([{ questionNumber: undefined }]), [])
  assert.deepEqual(affectedQuestionNumbers([]), [])
})

test('nothing unresolved says nothing at all', () => {
  // An empty message is what lets the caller treat "" as "no block"; a cheerful
  // "all figures fine" here would read as a warning in a banner.
  assert.equal(unresolvedFiguresMessage([]), '')
  assert.equal(unresolvedFiguresMessage(), '')
  assert.equal(unresolvedFiguresMessage([null, undefined]), '')
})

console.log('\n— the record —')

test('every field is present and defaulted, so a consumer never reads undefined', () => {
  const r = unresolvedFigure({})
  assert.deepEqual(Object.keys(r).sort(), [
    'diagramKey', 'kind', 'label', 'questionId', 'questionNumber', 'reason', 'stage',
  ])
  assert.equal(r.kind, 'library_diagram')
  assert.equal(r.stage, 'unknown')
  assert.equal(r.questionNumber, null)
})

test('the static stage is one of the declared stages', () => {
  // If these drifted apart, the gate would be checking a stage the exporter
  // never reports, and reporting green because it found nothing.
  assert.ok(FIGURE_STAGES.includes(STATIC_STAGE))
})

console.log('\n— what the gate can know before anything renders —')

const catalog = { triangle: '<svg/>', beaker: '<svg/>' }
const resolve = (key) => catalog[key] || null

test('a paper whose diagrams all exist is clean', () => {
  const questions = [
    { id: 'a', imageDiagram: { libraryKey: 'triangle' } },
    { id: 'b', imageDiagram: { libraryKey: 'beaker' } },
  ]
  assert.deepEqual(unresolvedRequiredFigures(questions, resolve), [])
})

test('a diagram the catalog cannot draw is reported against its question number', () => {
  const questions = [
    { id: 'a', imageDiagram: { libraryKey: 'triangle' } },
    { id: 'b' },
    { id: 'c', imageDiagram: { libraryKey: 'not-a-shape' }, },
  ]
  const found = unresolvedRequiredFigures(questions, resolve)
  assert.equal(found.length, 1)
  assert.equal(found[0].questionNumber, 3, 'the third question, as the studio numbers it')
  assert.equal(found[0].questionId, 'c')
  assert.equal(found[0].diagramKey, 'not-a-shape')
  assert.equal(found[0].stage, STATIC_STAGE)
  assert.equal(unresolvedFigureMessage(found[0]), 'Question 3 requires a diagram, but the figure could not be rendered. Replace, regenerate or repair the diagram before exporting.')
})

test('numbering is position, matching how the studio numbers questions', () => {
  // buildQuestionNumberMap is index + 1 over this same serialized list. A record
  // that named a different number would send the teacher to the wrong card.
  const questions = [
    { id: 'a', order: 99, imageDiagram: { libraryKey: 'gone' } },
  ]
  assert.equal(unresolvedRequiredFigures(questions, resolve)[0].questionNumber, 1)
})

test('an option diagram counts too, and says which kind it was', () => {
  // The exporter draws these; a check that only looked at the question stem
  // would leave a whole class of missing figure unprotected.
  const questions = [{
    id: 'a',
    options: [{ imageDiagram: { libraryKey: 'triangle' } }, { imageDiagram: { libraryKey: 'gone' } }],
  }]
  const found = unresolvedRequiredFigures(questions, resolve)
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'option_diagram')
})

test('a question with no figure at all contributes nothing', () => {
  assert.deepEqual(unresolvedRequiredFigures([{ id: 'a' }, null], resolve), [])
  assert.deepEqual(unresolvedRequiredFigures([{ id: 'a', imageDiagram: {} }], resolve), [])
  assert.deepEqual(unresolvedRequiredFigures([], resolve), [])
})

test('a resolver that THROWS is a missing figure, not a crash', () => {
  // A catalog that blows up is exactly as unable to draw the diagram as one that
  // returns nothing, and letting the exception escape would take the studio down
  // rather than block the export.
  const angry = () => { throw new Error('catalog exploded') }
  const found = unresolvedRequiredFigures([{ id: 'a', imageDiagram: { libraryKey: 'x' } }], angry)
  assert.equal(found.length, 1)
  assert.equal(found[0].stage, STATIC_STAGE)
  assert.match(found[0].reason, /catalog exploded/)
})

test('no resolver is refused outright rather than passing everything', () => {
  // The failure mode this prevents: a caller forgets the resolver, every figure
  // "resolves", and the gate reports a clean paper it never checked.
  assert.throws(() => unresolvedRequiredFigures([{ id: 'a' }]), TypeError)
})

test('the resolver receives the key AND the params the exporter would pass', () => {
  const seen = []
  unresolvedRequiredFigures(
    [{ id: 'a', imageDiagram: { libraryKey: 'triangle', params: { sides: 3 } } }],
    (key, params) => { seen.push([key, params]); return '<svg/>' },
  )
  assert.deepEqual(seen, [['triangle', { sides: 3 }]])
})

test('listNumbers reads as prose, and is the gate’s implementation too', () => {
  assert.equal(listNumbers([]), '')
  assert.equal(listNumbers([3]), '3')
  assert.equal(listNumbers([3, 7]), '3 and 7')
  assert.equal(listNumbers([3, 7, 9]), '3, 7 and 9')
})

console.log(`\n✓ unresolved figures — ${passed} tests passed`)
