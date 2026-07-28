/**
 * Answer-choice count resolution and choice validation.
 *
 * The cases that matter here are the ones where a wrong answer looks right: a
 * paper set to A–C whose correct answer was option D, and two distractors that
 * are the same number written two ways.
 */

import assert from 'node:assert/strict'
import {
  CHOICE_ISSUES,
  DEFAULT_CHOICE_COUNT,
  areNumericallyEquivalent,
  normalizeChoiceCount,
  numericValueOf,
  optionLabel,
  paperChoiceSettings,
  recommendedChoiceCount,
  resolveChoiceCount,
  validateChoices,
} from './mcqChoices.js'

const codes = (issues) => issues.map((i) => i.code)

/* ── The count ───────────────────────────────────────────────────────────── */

assert.equal(optionLabel(0), 'A')
assert.equal(optionLabel(4), 'E')

assert.equal(normalizeChoiceCount(3), 3)
assert.equal(normalizeChoiceCount('5'), 5)
assert.equal(normalizeChoiceCount(6), null, 'six choices is out of range')
assert.equal(normalizeChoiceCount(1), null)
assert.equal(normalizeChoiceCount(undefined), null)
assert.equal(normalizeChoiceCount(2), 2, 'legacy two-choice papers still resolve')

assert.equal(recommendedChoiceCount(2), 3, 'lower primary gets three choices')
assert.equal(recommendedChoiceCount(4), 4)
assert.equal(recommendedChoiceCount(9), 4)
assert.equal(recommendedChoiceCount('Grade 7'), 4)
assert.equal(recommendedChoiceCount(null), DEFAULT_CHOICE_COUNT)

// A Grade-7 paper the teacher set to A–C stays at A–C. The recommendation is
// never allowed to override a choice — that is the whole of §3's "never force".
assert.equal(resolveChoiceCount({ paper: { grade: 7, answerChoiceCount: 3 } }), 3)
assert.equal(resolveChoiceCount({ paper: { grade: 7 } }), 4, 'unset falls back to the recommendation')
assert.equal(resolveChoiceCount({ paper: { grade: 2 } }), 3)

// Section overrides the paper; a question overrides the section ONLY when the
// paper enabled per-question overrides.
assert.equal(resolveChoiceCount({ paper: { answerChoiceCount: 4 }, section: { answerChoiceCount: 5 } }), 5)
assert.equal(
  resolveChoiceCount({ paper: { answerChoiceCount: 4 }, question: { answerChoiceCount: 3 } }),
  4,
  'a stray per-question field is ignored unless overrides are enabled',
)
assert.equal(
  resolveChoiceCount({ paper: { answerChoiceCount: 4 }, question: { answerChoiceCount: 3 }, allowPerQuestion: true }),
  3,
)
assert.equal(resolveChoiceCount({ paper: { answerChoiceCount: 5 }, type: 'tf' }), 2, 'true/false is always two')

// The legacy field name keeps working, so every saved paper resolves.
assert.equal(resolveChoiceCount({ paper: { mcqAnswerChoiceCount: 3 } }), 3)
assert.deepEqual(paperChoiceSettings({ grade: 6 }), { count: 4, allowPerQuestion: false })
assert.deepEqual(
  paperChoiceSettings({ grade: 6, answerChoiceCount: 5, allowPerQuestionChoiceCount: true }),
  { count: 5, allowPerQuestion: true },
)

/* ── Numeric equivalence ─────────────────────────────────────────────────── */

assert.equal(numericValueOf('1/2'), 0.5)
assert.equal(numericValueOf('50%'), 0.5)
assert.equal(numericValueOf('0.5'), 0.5)
assert.equal(numericValueOf('½'), 0.5)
assert.equal(numericValueOf('2 1/2'), 2.5)
assert.equal(numericValueOf('-3'), -3)
assert.equal(numericValueOf('1,000'), 1000)
assert.equal(numericValueOf('1/0'), null, 'a zero denominator is not a value')
assert.equal(numericValueOf('the heart'), null)
assert.equal(numericValueOf('3 apples'), null, 'a number with a unit is not comparable as a bare number')
assert.equal(numericValueOf(''), null)

assert.equal(areNumericallyEquivalent('1/2', '2/4'), true)
assert.equal(areNumericallyEquivalent('0.5', '50%'), true)
assert.equal(areNumericallyEquivalent('1/3', '0.333333'), true)
assert.equal(areNumericallyEquivalent('1/2', '1/3'), false)
assert.equal(areNumericallyEquivalent('heart', 'heart'), false, 'prose is never "numerically" equivalent')

/* ── Validation ──────────────────────────────────────────────────────────── */

const ok = { options: ['Heart', 'Lung', 'Liver', 'Kidney'], correctAnswer: 0, type: 'mcq' }
assert.deepEqual(validateChoices(ok, 4, { number: 1 }), [])

// A paper switched from A–D to A–C whose answer was D. The stored question is
// untouched; what changed is that the paper no longer prints the answer.
const orphaned = { options: ['Heart', 'Lung', 'Liver'], correctAnswer: 3, type: 'mcq' }
const orphanIssues = validateChoices(orphaned, 3, { number: 13 })
assert.ok(codes(orphanIssues).includes(CHOICE_ISSUES.CORRECT_OUT_OF_RANGE))
assert.match(orphanIssues[0].message, /Question 13/)
assert.match(orphanIssues[0].message, /A–C/)

const wrongCount = validateChoices({ options: ['a', 'b', 'c'], correctAnswer: 0, type: 'mcq' }, 4, { number: 2 })
assert.ok(codes(wrongCount).includes(CHOICE_ISSUES.WRONG_COUNT))
assert.match(wrongCount[0].message, /3 answer choices but this paper is set to 4 \(A–D\)/)

const empties = validateChoices({ options: ['Heart', '', 'Liver', 'Kidney'], correctAnswer: 0, type: 'mcq' }, 4, { number: 3 })
assert.ok(codes(empties).includes(CHOICE_ISSUES.EMPTY_CHOICE))
assert.match(empties[0].message, /choice B is empty/)

const dupes = validateChoices({ options: ['Heart', 'Lung', 'heart', 'Kidney'], correctAnswer: 0, type: 'mcq' }, 4, { number: 4 })
assert.ok(codes(dupes).includes(CHOICE_ISSUES.DUPLICATE_CHOICE))
assert.match(dupes.find((i) => i.code === CHOICE_ISSUES.DUPLICATE_CHOICE).message, /choices A and C are identical/)

const equiv = validateChoices({ options: ['1/2', '1/3', '0.5', '3/4'], correctAnswer: 0, type: 'mcq' }, 4, { number: 5 })
assert.ok(codes(equiv).includes(CHOICE_ISSUES.EQUIVALENT_CHOICE))
assert.match(equiv.find((i) => i.code === CHOICE_ISSUES.EQUIVALENT_CHOICE).message, /choices A and C are the same value/)

assert.ok(codes(validateChoices({ options: ['a', 'b', 'c', 'd'], type: 'mcq' }, 4, { number: 6 }))
  .includes(CHOICE_ISSUES.NO_CORRECT_ANSWER))
assert.ok(codes(validateChoices({ options: ['a', 'b', 'c', 'd'], correctAnswer: [0, 2], type: 'mcq' }, 4, { number: 7 }))
  .includes(CHOICE_ISSUES.MULTIPLE_CORRECT))

// An image-only option is a real choice, so it must not read as empty.
assert.deepEqual(
  validateChoices({
    options: ['', '', '', ''],
    optionMedia: [{ imageUrl: 'a' }, { imageUrl: 'b' }, { imageUrl: 'c' }, { imageUrl: 'd' }],
    correctAnswer: 1,
    type: 'mcq',
  }, 4, { number: 8 }),
  [],
)

// Non-choice question types are not this module's business.
assert.deepEqual(validateChoices({ options: [], type: 'short' }, 4, { number: 9, type: 'short' }), [])

// True/False validates against two whatever the paper is set to.
assert.deepEqual(validateChoices({ options: ['True', 'False'], correctAnswer: 0, type: 'tf' }, 5, { number: 10, type: 'tf' }), [])

console.log('mcqChoices: all assertions passed')
