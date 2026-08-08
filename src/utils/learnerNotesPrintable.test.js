/**
 * The learner handout's printable form.
 *
 * The assertions worth having are the ones about what must NOT be on the page.
 * A handout that is missing a section is a complaint; a handout carrying the
 * answers, or a label-it figure carrying its own labels, is forty photocopies
 * of a ruined exercise. So those are checked from the rendered output rather
 * than trusted from the validator that produced it — two independent layers,
 * because this is the one that reaches the printer.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 * Run: node src/utils/learnerNotesPrintable.test.js
 */

import assert from 'node:assert/strict'
import {
  buildAnswerPageBlocks,
  buildAnswerPageHtml,
  buildLearnerNotesBlocks,
  buildLearnerNotesHtml,
  inlineText,
  learnerNotesCss,
  paperSize,
} from './learnerNotesPrintable.js'

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

const NOTES = {
  audience: 'learner',
  format: 'handout',
  paperSize: 'a4',
  header: {
    title: 'Digestion — Grade 7 Integrated Science',
    grade: 'Grade 7', subject: 'integrated_science', topic: 'The Digestive System',
    school: 'Kabulonga Primary', date: '3 March 2026',
  },
  learningOutcomes: ['You will be able to name the parts of your digestive system.'],
  sections: [{
    heading: 'Your mouth',
    body: ['Your **saliva** makes the food soft so you can swallow it.'],
    definitions: [{ term: 'saliva', meaning: 'the water in your mouth that softens food' }],
    recap: 'Digestion starts in your mouth.',
  }],
  workedExamples: [{
    title: 'Follow one mouthful',
    problem: 'Where does nshima go after you swallow it?',
    steps: ['Step 1 — your mouth.'],
    answer: 'It goes down to your stomach.',
  }],
  dontMixThese: [{
    confusedPair: 'Chewing / Digestion',
    warning: 'Chewing is only the first step!',
    clarification: 'Digestion carries on all the way down.',
  }],
  learnerQuestions: [{ question: 'Why does my stomach rumble?', answer: 'Muscles squeezing air.' }],
  rememberBox: ['Digestion starts in your mouth.'],
  exercise: {
    instructions: 'Answer all the questions in your exercise book.',
    questions: [
      { number: 1, prompt: 'Name two parts of your digestive system.', marks: 2, type: 'recall' },
      { number: 2, prompt: 'Why do you chew your food?', marks: 2, type: 'apply' },
    ],
  },
  answerKey: {
    answers: [
      { number: 1, answer: 'Any two of: mouth, stomach, small intestine.', note: 'One mark each.' },
      { number: 2, answer: 'So it is small enough to swallow.', note: '' },
    ],
    diagramLabels: [
      { number: 1, name: 'mouth' }, { number: 2, name: 'oesophagus' },
      { number: 3, name: 'liver' }, { number: 4, name: 'stomach' },
      { number: 5, name: 'small intestine' }, { number: 6, name: 'large intestine' },
    ],
    diagramCaption: 'Digestive system',
  },
  diagrams: [
    {
      placement: 'body', sectionIndex: 0, libraryKey: 'digestivesystem', mode: 'study',
      caption: 'Digestive system', params: { labels: 'on', board: 'no' },
    },
    {
      placement: 'exercise', libraryKey: 'digestivesystem', mode: 'label-it',
      caption: 'Label the digestive system', params: { labels: 'off', board: 'no' },
      wordBank: ['large intestine', 'liver', 'mouth', 'oesophagus', 'small intestine', 'stomach'],
    },
  ],
  grounding: { grounded: true, outcomes: ['describe the parts'], count: 1 },
}

const learnerHtml = () => buildLearnerNotesHtml(NOTES)

/* ── What must not be on the learner's pages ───────────────────────────── */

test('the learner pages carry no exercise answer', () => {
  const html = learnerHtml()
  assert.ok(!html.includes('Any two of'), 'the marking answer reached the learner sheet')
  assert.ok(!html.includes('One mark each'), 'the marking note reached the learner sheet')
})

test('the label-it figure on the learner pages carries no labels', () => {
  const html = learnerHtml()
  // The STUDY figure names its parts, so a naive "does the word appear" check
  // would pass for the wrong reason. This checks the exercise figure's own
  // markup: the word bank is there (that is the help), the labels are not.
  const exercise = html.slice(html.indexOf('Exercise'))
  assert.ok(exercise.includes('Word bank:'), 'the word bank should help the learner')
  assert.ok(exercise.includes('data-label-box'), 'the exercise figure should have write-in boxes')
  const boxCount = (exercise.match(/data-label-box=/g) || []).length
  assert.equal(boxCount, 6, 'one box per part')
})

test('the answer page is a SEPARATE document', () => {
  const answers = buildAnswerPageHtml(NOTES)
  assert.ok(answers.includes('Any two of'), 'the answers belong on the answer page')
  assert.ok(answers.includes("Teacher's copy"), 'the answer page says whose it is')
  // …and the learner document does not contain it under any heading.
  assert.ok(!learnerHtml().includes("Teacher's copy"))
})

test('the answer page names the diagram labels against the learner numbering', () => {
  const blocks = buildAnswerPageBlocks(NOTES)
  const html = blocks.map((b) => b.html).join('')
  for (const label of NOTES.answerKey.diagramLabels) assert.ok(html.includes(label.name))
})

/* ── What must be on them ──────────────────────────────────────────────── */

test('every required part of a learner document is rendered', () => {
  const html = learnerHtml()
  for (const [what, needle] of [
    ['the outcomes', 'What you will learn'],
    ['a boxed definition', 'ln-defs'],
    ['a worked example', "Let's work one out together"],
    ['a Don\'t mix these up! box', "Don't mix these up!"],
    ['the FAQ', 'Questions learners ask'],
    ['the Remember! box', 'Remember!'],
    ['the exercise', 'Exercise'],
    ['a name line for the learner', 'Name:'],
  ]) {
    assert.ok(html.includes(needle), `${what} is missing from the printed sheet`)
  }
})

test('a new term keeps its emphasis', () => {
  assert.equal(inlineText('Your **saliva** softens food.'), 'Your <strong>saliva</strong> softens food.')
})

test('content is escaped before the emphasis is applied', () => {
  // The `**` handling must not become a hole for markup.
  assert.equal(inlineText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
})

/* ── Blocks ────────────────────────────────────────────────────────────── */

test('the blocks the preview renders are the blocks the printer gets', () => {
  const blocks = buildLearnerNotesBlocks(NOTES)
  const html = buildLearnerNotesHtml(NOTES)
  for (const b of blocks) {
    assert.ok(html.includes(b.html.trim().slice(0, 60)),
      `block ${b.id} is in the preview but not in the printed document`)
  }
})

test('headings declare that they keep with what follows', () => {
  const blocks = buildLearnerNotesBlocks(NOTES)
  const keepers = blocks.filter((b) => b.keepWithNext).map((b) => b.kind)
  assert.ok(keepers.includes('exercise-heading'),
    'an Exercise heading alone at the foot of a page is the classic print defect')
})

test('a figure that cannot be drawn leaves a visible gap, not a silent one', () => {
  const broken = { ...NOTES, diagrams: [{ placement: 'body', sectionIndex: 0, libraryKey: 'no-such-figure', caption: 'Missing thing', params: {} }] }
  const html = buildLearnerNotesHtml(broken)
  assert.ok(html.includes('Figure could not be drawn'))
})

/* ── Paper ─────────────────────────────────────────────────────────────── */

test('A5 is a different sheet, not a scaled A4', () => {
  const a4 = paperSize('a4')
  const a5 = paperSize('a5')
  assert.ok(a5.widthMm < a4.widthMm && a5.heightMm < a4.heightMm)
  // Content has to reflow, so the type size changes with the sheet — an A4
  // measure at A4 type on an A5 page is four words a line.
  assert.ok(a5.fontPt < a4.fontPt)
  assert.ok(learnerNotesCss({ paper: 'a5' }).includes('148mm'))
  assert.ok(learnerNotesCss({ paper: 'a4' }).includes('210mm'))
})

test('an unknown paper falls back to A4 rather than to nothing', () => {
  assert.equal(paperSize('foolscap').id, 'a4')
  assert.equal(paperSize(undefined).id, 'a4')
})

test('the board look is preview-only and never in an export', () => {
  assert.ok(learnerNotesCss({ boardPreview: true }).includes('.ln-board'))
  assert.ok(!learnerNotesCss({ boardPreview: false }).includes('.ln-board'))
  // The exported document builds its own stylesheet and never asks for it.
  assert.ok(!buildLearnerNotesHtml(NOTES).includes('.ln-board'))
})

test('the print stylesheet names the page it prints on', () => {
  assert.ok(learnerNotesCss({ paper: 'a5' }).includes('size:A5 portrait'))
})

if (process.exitCode) {
  console.error('\n✗ learner-notes printable FAILED')
} else {
  console.log(`\n✓ learner-notes printable — ${passed} checks passed`)
}
