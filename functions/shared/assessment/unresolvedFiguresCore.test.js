/**
 * A required figure the renderer cannot produce is a BLOCKING correctness error.
 *
 * The distinction these tests exist to hold: a figure that looks wrong is a
 * quality warning and the paper still downloads; a figure that is not there at
 * all means a learner is asked to label blank paper, and the export must not
 * happen. Everything below is about keeping those two apart, and about the gate
 * and the exporter describing the same missing diagram in the same words.
 *
 * Run: node functions/shared/assessment/unresolvedFiguresCore.test.js
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import {
  unresolvedFigure, unresolvedFigureMessage, unresolvedFiguresMessage,
  unresolvedRequiredFigures, affectedQuestionNumbers, listNumbers, UnresolvedFigureError,
  FIGURE_STAGES, STATIC_STAGE,
} from './unresolvedFiguresCore.js'

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

test('an option diagram is read from optionMedia[i].diagram, the shape the app uses', () => {
  // The first version of this check looked at `options[i].imageDiagram`, a
  // field nothing writes — so it found nothing and reported every paper clean,
  // which is the worst outcome a check can have. The exporter reads
  // `optionMedia[i].diagram`; so does this.
  const questions = [{
    id: 'a',
    options: ['A', 'B'],
    optionMedia: [{ diagram: { libraryKey: 'triangle' } }, { diagram: { libraryKey: 'gone' } }],
  }]
  const found = unresolvedRequiredFigures(questions, resolve)
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'option_diagram')
  assert.equal(found[0].diagramKey, 'gone')
  assert.equal(found[0].questionNumber, 1)
})

test('a sparse optionMedia array does not throw', () => {
  // Only some options carry media, so the array has holes.
  const questions = [{ id: 'a', optionMedia: [null, undefined, { diagram: { libraryKey: 'gone' } }] }]
  assert.equal(unresolvedRequiredFigures(questions, resolve).length, 1)
})

test('a passage stimulus diagram is checked, and named by its title', () => {
  // Passages carry their own diagram in a separate array, and both renderers
  // draw it. Checking only the questions left every diagram/map/source passage
  // unprotected.
  const paper = {
    questions: [{ id: 'q1', imageDiagram: { libraryKey: 'triangle' } }],
    passages: [{ id: 'p1', title: 'The water cycle', imageDiagram: { libraryKey: 'gone' } }],
  }
  const found = unresolvedRequiredFigures(paper, resolve)
  assert.equal(found.length, 1)
  assert.equal(found[0].questionId, 'p1')
  assert.equal(found[0].label, 'The water cycle', 'the exporter labels it the same way')
  assert.equal(found[0].questionNumber, null, 'a passage has no question number')
  assert.match(unresolvedFigureMessage(found[0]), /^A question on this paper requires a diagram/)
})

test('a bare questions array is still accepted', () => {
  // Callers with no passages should not have to wrap.
  assert.equal(unresolvedRequiredFigures([{ id: 'a', imageDiagram: { libraryKey: 'gone' } }], resolve).length, 1)
  assert.equal(unresolvedRequiredFigures({ questions: [], passages: [] }, resolve).length, 0)
  assert.equal(unresolvedRequiredFigures({}, resolve).length, 0)
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

console.log('\n— a refused export fails loudly —')

test('UnresolvedFigureError carries the repair sentence and a code', () => {
  // Returning `{delivered: false}` put the burden on every caller to look, and
  // the library export routes did not — they toasted "download started" over a
  // file that was never written. A caller that does nothing must now fail.
  const err = new UnresolvedFigureError([{ questionNumber: 5 }])
  assert.ok(err instanceof Error, 'a plain catch block sees it')
  assert.equal(err.code, 'unresolved-figure', 'recognised without instanceof, which a dynamic import breaks')
  assert.equal(err.message, unresolvedFigureMessage({ questionNumber: 5 }))
  assert.equal(err.entries.length, 1, 'the records travel with it')
})

test('the harness escape hatch is never set by application code', () => {
  // `allowUnresolvedFigures` lets a caller take delivery of a paper with a
  // missing required figure. The docblock says it is for the visual harness;
  // nothing enforced that, so a refactor could pass `true` and silently undo
  // the whole gate. This is the enforcement: the flag may be DEFINED in the
  // exporter and USED by tests, and must appear nowhere else under src/.
  // Searched across BOTH sides now that the server enforces the same rule — an
  // opt-out reintroduced in functions/ would be worse than one in src/, because
  // the server is the entry point a client cannot talk its way past.
  const root = new URL('../../..', import.meta.url).pathname
  const allowed = new Set([
    'src/utils/assessmentToDocx.js',      // defines it
    'functions/shared/assessment/unresolvedFiguresCore.test.js', // this guard
    'src/utils/paperGolden.test.js',       // proves the opt-out still delivers
    'functions/assessmentExports/exportReadiness.test.js', // proves the server ignores it
  ])
  const hits = execSync(
    "grep -rl 'allowUnresolvedFigures' src functions --exclude-dir=node_modules || true",
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter(Boolean)
  // `|| true` swallows a grep that could not read its search roots, and an empty
  // result then reads exactly like a clean tree. This guard moved directories
  // once already and spent that move searching a path that did not exist,
  // passing every time. The known-present hits are the proof it looked.
  assert.ok(
    hits.includes('src/utils/assessmentToDocx.js'),
    'the guard found nothing at all — it is searching the wrong root, not proving the tree is clean',
  )
  // A docblock explaining that the server reads no such flag names the flag.
  // Failing on that would push the explanation out of the code, which is the
  // opposite of what this guard is for: what matters is whether anything
  // REACHES for the opt-out, not whether anything mentions it.
  const setsIt = (file) => {
    const code = readFileSync(join(root, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    return /allowUnresolvedFigures/.test(code)
  }
  const unexpected = hits.filter((f) => !allowed.has(f) && setsIt(f))
  assert.deepEqual(unexpected, [], `application code must not opt out: ${unexpected.join(', ')}`)
})

test('listNumbers reads as prose, and is the gate’s implementation too', () => {
  assert.equal(listNumbers([]), '')
  assert.equal(listNumbers([3]), '3')
  assert.equal(listNumbers([3, 7]), '3 and 7')
  assert.equal(listNumbers([3, 7, 9]), '3, 7 and 9')
})

console.log(`\n✓ unresolved figures — ${passed} tests passed`)
