/**
 * §2 — no field left behind.
 *
 * The generator writes mathematics as markup (`\frac{a}{b}`, `$…$`,
 * `[[vmath …]]`) and `aiPaperToSections` is where that markup becomes editor
 * nodes. It converted four fields out of eleven. Every other field arrived in
 * the Studio as a raw trimmed string, so a teacher opening a freshly generated
 * paper found `\frac{3}{5}` printed as literal text in the very places a maths
 * paper puts its arithmetic — the sub-part answers most of all.
 *
 * The test is driven by the CONTRACT's own field list rather than by a
 * hand-written one. A field added to `NOTATION_FIELDS` with no conversion route
 * fails here, which is the only way this stays true after the next schema
 * change.
 *
 * Run: node src/utils/aiPaperMathsFields.test.js
 */

import assert from 'node:assert/strict'
import { mapAiQuestion, aiAssessmentToStudioBlocks } from './aiPaperToSections.js'
import { NOTATION_FIELDS } from '../../functions/shared/assessment/mathsNotationCore.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** Did this value come out as a structured maths node rather than markup? */
function isStructured(value) {
  const s = String(value ?? '')
  return /math-frac|mnode|vert-arith/.test(s)
}

/** Is there still raw contract markup visible in this value? */
function hasRawMarkup(value) {
  const s = String(value ?? '')
  return /\\frac|\[\[\s*vmath|\$[^$\n]+\$/.test(s)
}

/** Assert a converted field: structured, and no markup left behind. */
function assertConverted(value, what) {
  assert.ok(isStructured(value), `${what} was not converted — got: ${String(value).slice(0, 80)}`)
  assert.ok(!hasRawMarkup(value), `${what} still carries raw markup: ${String(value).slice(0, 80)}`)
  assert.ok(!String(value).includes('[object Object]'), `${what} was stringified`)
}

console.log('\nthe fields that were leaking')

check('a sub-question part and its ANSWER both convert', () => {
  // The leak the phase names by name. A sub-part is where a maths paper puts
  // "(a) Work out …", and both halves were raw.
  const { overrides } = mapAiQuestion({
    type: 'structured',
    prompt: 'Work out the following.',
    parts: [
      { text: 'Calculate \\frac{3}{5} + \\frac{1}{4}.', answer: '\\frac{17}{20}', marks: 3 },
      { text: 'Convert 2\\frac{3}{7} to an improper fraction.', answer: '\\frac{17}{7}', marks: 2 },
    ],
  })
  assert.equal(overrides.subParts.length, 2)
  for (const [i, part] of overrides.subParts.entries()) {
    assertConverted(part.text, `parts[${i}].text`)
    assertConverted(part.answer, `parts[${i}].answer`)
  }
})

check('the expected ANSWER converts on a plain short-answer question', () => {
  const { overrides } = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Calculate \\frac{3}{5} + \\frac{1}{4}.',
    answer: '\\frac{17}{20}',
  })
  assertConverted(overrides.text, 'prompt')
  assertConverted(overrides.correctAnswer, 'answer')
})

check('fill-in-the-blank statements, their answers and the word bank all convert', () => {
  const { overrides } = mapAiQuestion({
    type: 'fill_blanks',
    prompt: 'Fill in the blanks.',
    statements: [
      { text: 'One half is written ____ as a fraction.', answer: '\\frac{1}{2}' },
      { text: '\\frac{2}{4} in its lowest terms is ____.', answer: '\\frac{1}{2}' },
    ],
    wordBank: ['\\frac{1}{2}', '\\frac{1}{3}'],
    answer: '\\frac{1}{2}; \\frac{1}{2}',
  })
  assertConverted(overrides.statements[1].text, 'statements[1].text')
  assertConverted(overrides.statements[0].answers[0], 'statements[0].answers[0]')
  assertConverted(overrides.wordBank[0], 'wordBank[0]')
  assertConverted(overrides.correctAnswer, 'answer')
})

check('a passage carrying a word problem converts', () => {
  const blocks = aiAssessmentToStudioBlocks({
    sections: [{
      title: 'Section A',
      passage: { title: 'At the market', text: 'Mary sold \\frac{3}{4} of her tomatoes.' },
      questions: [{ type: 'short_answer', prompt: 'How much was left?', answer: '\\frac{1}{4}' }],
    }],
  })
  const passage = blocks.sections.find((s) => s.kind === 'passage')
  assertConverted(passage.passage.passageText, 'passage.text')
})

check('a crammed "(a)… (b)…" prompt splits AND converts each part', () => {
  const { overrides } = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Work out the following. (a) Calculate \\frac{3}{5} + \\frac{1}{4}. (b) Convert 2\\frac{3}{7} to an improper fraction.',
    answer: '',
  })
  if (Array.isArray(overrides.subParts) && overrides.subParts.length >= 2) {
    for (const [i, part] of overrides.subParts.entries()) {
      assertConverted(part.text, `split part ${i}`)
    }
  } else {
    // The splitter declined; the whole prompt must still be converted.
    assertConverted(overrides.text, 'unsplit prompt')
  }
})

console.log('\nthe fields that were already converted stay converted')

check('question text, marking guide and MCQ options', () => {
  const { overrides } = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Which fraction is the largest?',
    options: ['\\frac{1}{2}', '\\frac{2}{3}', '\\frac{3}{4}', '\\frac{5}{8}'],
    answer: '\\frac{3}{4}',
    markingGuide: 'The largest is \\frac{3}{4}.',
  })
  for (const [i, opt] of overrides.options.entries()) assertConverted(opt, `options[${i}]`)
  assertConverted(overrides.explanation, 'markingGuide')
})

check('a column calculation becomes a real vertical-arithmetic node', () => {
  const { overrides } = mapAiQuestion({
    type: 'short_answer',
    prompt: 'Work out:\n[[vmath op=x lines=234,6 answer=1404]]',
    answer: '1404',
  })
  assert.match(String(overrides.text), /vert-arith/)
  assert.match(String(overrides.text), /data-operator="×"/)
  assert.ok(!hasRawMarkup(overrides.text))
})

console.log('\nwhat conversion must NOT disturb')

check('the MCQ correct-answer INDEX survives conversion', () => {
  // The match runs against the PLAIN option text; converting first would
  // compare node HTML against plain text and never line up, silently
  // defaulting every fraction MCQ to option A.
  const { overrides } = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Which fraction is the largest?',
    options: ['\\frac{1}{2}', '\\frac{2}{3}', '\\frac{3}{4}', '\\frac{5}{8}'],
    answer: '\\frac{3}{4}',
  })
  assert.equal(overrides.correctAnswer, 2)
  assert.notEqual(overrides.requiresReview, true)
})

check('a letter answer still resolves after conversion', () => {
  const { overrides } = mapAiQuestion({
    type: 'multiple_choice',
    prompt: 'Which is largest?',
    options: ['\\frac{1}{2}', '\\frac{2}{3}', '\\frac{3}{4}', '\\frac{5}{8}'],
    answer: 'C',
  })
  assert.equal(overrides.correctAnswer, 2)
})

check('a NON-mathematics question is byte-identical to before', () => {
  // hasImportMarkup gates every converter, so prose is returned unchanged.
  // This is what makes routing more fields through them safe for English,
  // Science and the rest.
  const q = {
    type: 'multiple_choice',
    prompt: 'Which animal lives on a farm?',
    options: ['Cow', 'Aeroplane', 'Table', 'Cloud'],
    answer: 'Cow',
    markingGuide: 'One mark.',
    parts: [],
  }
  const { overrides } = mapAiQuestion(q)
  assert.equal(overrides.text, 'Which animal lives on a farm?')
  assert.deepEqual(overrides.options, ['Cow', 'Aeroplane', 'Table', 'Cloud'])
  assert.equal(overrides.explanation, 'One mark.')
  assert.equal(overrides.correctAnswer, 0)
})

check('a plain-prose sub-part is not wrapped in markup it never had', () => {
  const { overrides } = mapAiQuestion({
    type: 'structured',
    prompt: 'Answer the following.',
    parts: [
      { text: 'Name two farm animals.', answer: 'cow, goat', marks: 2 },
      { text: 'Name one wild animal.', answer: 'lion', marks: 1 },
    ],
  })
  assert.equal(overrides.subParts[0].text, 'Name two farm animals.')
  assert.equal(overrides.subParts[0].answer, 'cow, goat')
})

console.log('\nthe contract drives this test, not a hand-written list')

check('every contract field has a proven conversion route', () => {
  // A field added to NOTATION_FIELDS with no route fails HERE rather than
  // delivering raw markup to a teacher after the next schema change.
  const COVERED = new Set([
    'prompt', 'options[]', 'answer', 'markingGuide',
    'parts[].text', 'parts[].answer',
    'statements[].text', 'statements[].answers[]', 'wordBank[]',
    'passage.text',
    // `solution` is declared by the contract for the server-side check; the
    // generator schema has no such field today, so there is nothing in
    // aiPaperToSections to route. Named here so adding one is a deliberate act.
    'solution',
  ])
  for (const field of NOTATION_FIELDS) {
    assert.ok(
      COVERED.has(field.path),
      `${field.path} (${field.what}) is in the contract but has no conversion route`,
    )
  }
})

console.log(`\n${passed} generated-field conversion checks passed\n`)
