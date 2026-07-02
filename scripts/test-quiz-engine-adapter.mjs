#!/usr/bin/env node
/* global console, process */
/**
 * Tests for src/utils/quizEngineAdapter.js — the bridge between the Quiz
 * Editor's in-memory question shape and the shared Document Understanding
 * Engine (src/documentEngine/validationEngine.js).
 *
 * Plain `node` (auto-discovered by scripts/run-all-tests.mjs via the test:*
 * key). extractRichTextPlain degrades to tag-stripping under node, so HTML
 * fixtures are fine; Tiptap fixtures exercise the pure JSON path.
 *
 * Run: npm run test:quiz-engine-adapter
 */
import {
  deriveAnswerKnown,
  toEngineQuestion,
  questionValidationStatus,
  questionSourceNumber,
  runQuizValidation,
} from '../src/utils/quizEngineAdapter.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const tiptapDoc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const tiptapString = (text) => JSON.stringify(tiptapDoc(text))

function mcq(overrides = {}) {
  return {
    localId: overrides.localId || 'q-1',
    type: 'mcq',
    text: '<p>Capital of Zambia?</p>',
    options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'],
    correctAnswer: 0,
    explanation: '',
    sourceQuestionNumber: null,
    ...overrides,
  }
}

// ── toEngineQuestion ─────────────────────────────────────────────
console.log('\ntoEngineQuestion')

test('flattens HTML text and options to plain prompt/options', () => {
  const out = toEngineQuestion(mcq({ text: '<p>What is <strong>1/2</strong>?</p>' }))
  assert(out.prompt.includes('What is'), `prompt: ${out.prompt}`)
  assert(!out.prompt.includes('<'), 'no HTML tags in prompt')
  assert(out.options.length === 4, 'four options survive')
})

test('flattens a Tiptap JSON object stem', () => {
  const out = toEngineQuestion(mcq({ text: tiptapDoc('Solve for x.') }))
  assert(out.prompt === 'Solve for x.', `got: ${out.prompt}`)
})

test('flattens stringified-Tiptap options to plain text (never raw JSON)', () => {
  const out = toEngineQuestion(mcq({ options: [tiptapString('1/2'), tiptapString('1/4'), 'c', 'd'] }))
  assert(out.options[0] === '1/2', `got: ${out.options[0]}`)
  assert(!out.options[0].includes('{'), 'no raw JSON leaking through')
})

test('drops blank options (empty string + empty Tiptap doc)', () => {
  const emptyDoc = JSON.stringify({ type: 'doc', content: [] })
  const out = toEngineQuestion(mcq({ options: ['Lusaka', '', emptyDoc, 'Kitwe'] }))
  assert(out.options.length === 2, `expected 2, got ${out.options.length}`)
})

test('canonicalizes aliased types', () => {
  assert(toEngineQuestion(mcq({ type: 'truefalse', options: ['True', 'False'] })).type === 'tf')
  assert(toEngineQuestion(mcq({ type: 'fill_in_blank', options: [] })).type === 'fill_blanks')
})

test('carries the printed source number; ignores junk', () => {
  assert(toEngineQuestion(mcq({ sourceQuestionNumber: 47 })).sourceNumber === 47)
  assert(toEngineQuestion(mcq({ sourceQuestionNumber: 'not-a-number' })).sourceNumber === null)
  assert(toEngineQuestion(mcq()).sourceNumber === null)
  assert(questionSourceNumber({ sourceQuestionNumber: 12000 }) === null, 'out of range → null')
})

// ── deriveAnswerKnown ────────────────────────────────────────────
console.log('\nderiveAnswerKnown')

test('mcq: valid index → known; empty string / null → unknown', () => {
  assert(deriveAnswerKnown(mcq({ correctAnswer: 2 })) === true)
  assert(deriveAnswerKnown(mcq({ correctAnswer: '' })) === false, "'' must not read as option A")
  assert(deriveAnswerKnown(mcq({ correctAnswer: null })) === false)
})

test('mcq: out-of-range index → unknown', () => {
  assert(deriveAnswerKnown(mcq({ correctAnswer: 9 })) === false)
  assert(deriveAnswerKnown(mcq({ correctAnswer: -1 })) === false)
})

test('written-response types are always known (blank = AI judges)', () => {
  for (const type of ['short_answer', 'essay', 'diagram', 'fill', 'short']) {
    assert(deriveAnswerKnown({ type, correctAnswer: '' }) === true, `${type} blank should be ok`)
  }
})

test('numeric: finite → known; blank/NaN → unknown', () => {
  assert(deriveAnswerKnown({ type: 'numeric', correctAnswer: '3.14' }) === true)
  assert(deriveAnswerKnown({ type: 'numeric', correctAnswer: '' }) === false)
  assert(deriveAnswerKnown({ type: 'numeric', correctAnswer: 'pi' }) === false)
})

test('fill_blanks: complete key → known; missing blank answer → unknown', () => {
  const complete = {
    type: 'fill_blanks',
    statements: [{ text: 'The sun rises in the ____.', answers: ['east'] }],
  }
  const incomplete = {
    type: 'fill_blanks',
    statements: [{ text: 'Water is ____ and ____.', answers: ['wet'] }],
  }
  assert(deriveAnswerKnown(complete) === true)
  assert(deriveAnswerKnown(incomplete) === false)
})

test('matching: complete mapping → known; hole → unknown', () => {
  const base = { type: 'matching', matchingLeft: ['Zambia', 'Kenya'], matchingRight: ['Lusaka', 'Nairobi'] }
  assert(deriveAnswerKnown({ ...base, matchingAnswer: [0, 1] }) === true)
  assert(deriveAnswerKnown({ ...base, matchingAnswer: [0, -1] }) === false)
})

test('sequence: valid permutation → known; duplicate position → unknown', () => {
  const base = { type: 'sequence', sequenceItems: ['Egg', 'Larva', 'Adult'] }
  assert(deriveAnswerKnown({ ...base, sequenceAnswer: [1, 2, 3] }) === true)
  assert(deriveAnswerKnown({ ...base, sequenceAnswer: [1, 1, 3] }) === false)
})

test('hotspot: region set → known; missing → unknown', () => {
  assert(deriveAnswerKnown({ type: 'hotspot', correctRegion: { x: 0.5, y: 0.5, radius: 0.1 } }) === true)
  assert(deriveAnswerKnown({ type: 'hotspot', correctRegion: null }) === false)
})

// ── questionValidationStatus (per-card chip) ─────────────────────
console.log('\nquestionValidationStatus')

test('clean answered MCQ → ok', () => {
  assert(questionValidationStatus(mcq()) === 'ok')
})

test('unanswered MCQ → warning', () => {
  assert(questionValidationStatus(mcq({ correctAnswer: '' })) === 'warning')
})

test('[UNCLEAR] in the stem → warning', () => {
  assert(questionValidationStatus(mcq({ text: '<p>The [UNCLEAR] of water</p>' })) === 'warning')
})

test('labelled option gap → error', () => {
  const status = questionValidationStatus(mcq({ options: ['A. x', 'B. y', 'D. z'], correctAnswer: 0 }))
  assert(status === 'error', `got ${status}`)
})

test('empty stem → error', () => {
  assert(questionValidationStatus(mcq({ text: '' })) === 'error')
})

test('blank short-answer → ok (AI judges — must NOT warn)', () => {
  const status = questionValidationStatus({
    type: 'short_answer', text: '<p>Explain rainfall.</p>', options: [], correctAnswer: '',
  })
  assert(status === 'ok', `got ${status}`)
})

// ── runQuizValidation (whole-quiz panel) ─────────────────────────
console.log('\nrunQuizValidation')

function standalone(question) {
  return { kind: 'standalone', id: `s-${question.localId}`, question }
}

test('clean numbered quiz → ok, no blockers, no items', () => {
  const sections = [1, 2, 3, 4, 5].map(n =>
    standalone(mcq({ localId: `q-${n}`, sourceQuestionNumber: n })))
  const result = runQuizValidation(sections)
  assert(result.ok === true, JSON.stringify(result.blockers))
  assert(result.items.length === 0, JSON.stringify(result.items))
  assert(result.questionCount === 5)
})

test('missing printed number → blocker "Missing questions: 4"', () => {
  const sections = [1, 2, 3, 5, 6].map(n =>
    standalone(mcq({ localId: `q-${n}`, sourceQuestionNumber: n })))
  const result = runQuizValidation(sections)
  assert(result.ok === false)
  assert(result.blockers.some(b => /Missing questions: 4/.test(b)), JSON.stringify(result.blockers))
  assert(result.numbering.missing.includes(4))
})

test('section restart is NOT a blocker or duplicate', () => {
  const numbers = [1, 2, 3, 1, 2]
  const sections = numbers.map((n, i) =>
    standalone(mcq({ localId: `q-${i}`, sourceQuestionNumber: n })))
  const result = runQuizValidation(sections)
  assert(result.ok === true, JSON.stringify(result.blockers))
  assert(result.numbering.restarts.length === 1)
  assert(result.numbering.duplicates.length === 0)
})

test('per-question findings carry localId for jump + label from source number', () => {
  const sections = [
    standalone(mcq({ localId: 'q-a', sourceQuestionNumber: 17 })),
    standalone(mcq({
      localId: 'q-b',
      sourceQuestionNumber: 18,
      options: ['A. x', 'B. y', 'D. z'],
    })),
  ]
  const result = runQuizValidation(sections)
  const finding = result.items.find(i => i.localId === 'q-b')
  assert(finding, 'expected a finding for q-b')
  assert(/Question 18 — Missing Option C/.test(finding.message), finding.message)
  assert(finding.severity === 'error')
})

test('unnumbered hand-authored quiz stays quiet (no fake missing numbers)', () => {
  const sections = [
    standalone(mcq({ localId: 'q-1' })),
    standalone(mcq({ localId: 'q-2' })),
  ]
  const result = runQuizValidation(sections)
  assert(result.ok === true, JSON.stringify(result.blockers))
  assert(result.numbering.reliable === false)
})

test('passage children are walked; shared passage [UNCLEAR] counted once', () => {
  const passageSection = {
    kind: 'passage',
    id: 'sec-p',
    passage: {
      title: 'The Flood',
      passageText: '<p>The river [UNCLEAR] rose quickly.</p>',
      questions: [
        mcq({ localId: 'p-1', sourceQuestionNumber: 11 }),
        mcq({ localId: 'p-2', sourceQuestionNumber: 12 }),
      ],
    },
  }
  const result = runQuizValidation([
    passageSection,
    standalone(mcq({ localId: 'q-13', sourceQuestionNumber: 13 })),
  ])
  assert(result.questionCount === 3)
  assert(result.unclearCount === 1, `expected 1 unclear, got ${result.unclearCount}`)
  const finding = result.items.find(i => i.localId === 'p-1')
  assert(finding && /UNCLEAR/.test(finding.message), 'first passage child carries the finding')
})

test('an answer-key block pasted as a question is flagged as an error item', () => {
  const key = standalone({
    localId: 'q-key',
    type: 'short_answer',
    text: '<p>MARKING SCHEME 1. A 2. B 3. C 4. D 5. A 6. B</p>',
    options: [],
    correctAnswer: '',
  })
  const result = runQuizValidation([key])
  const finding = result.items.find(i => i.localId === 'q-key')
  assert(finding && finding.severity === 'error', JSON.stringify(result.items))
  assert(result.ok === false, 'answer-key block must also be a gate blocker')
})

test('no-answer tally counts unanswered MCQs, not blank short answers', () => {
  const result = runQuizValidation([
    standalone(mcq({ localId: 'q-1', correctAnswer: '' })),
    standalone({
      localId: 'q-2', type: 'short_answer', text: '<p>Explain.</p>', options: [], correctAnswer: '',
    }),
  ])
  assert(result.noAnswerCount === 1, `got ${result.noAnswerCount}`)
})

test('display-number fallback labels unnumbered findings', () => {
  const sections = [
    standalone(mcq({ localId: 'q-x', options: ['A. a', 'C. c'] })),
  ]
  const result = runQuizValidation(sections, { questionNumbers: { 'q-x': 7 } })
  const finding = result.items.find(i => i.localId === 'q-x')
  assert(finding && /Question 7/.test(finding.message), finding?.message)
})

// ── Report ───────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
