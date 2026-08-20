/**
 * test:fraction-questions — marking six kinds of response, and the rule that a
 * wrong answer is answered by name.
 *
 * The marking rules are here rather than in a rendering test because each of
 * them renders a perfectly good screen while being wrong: a marker that
 * rejects 2/4 for 1/2 draws a flawless red cross, and a "shade one half" round
 * that insists on the leftmost two pieces fails a child who shaded the right
 * amount from the other end.
 */
import assert from 'node:assert/strict'

import {
  COMPARE_SYMBOLS,
  MISCONCEPTION_CODES,
  codesFor,
  diagnose,
  hasWorking,
  introducesSymbol,
  learnerFacingText,
  markResponse,
  parseWrittenAnswer,
  questionFraction,
  questionWords,
  responseKey,
  validateQuestion,
  workingSteps,
} from '../src/features/games/lib/fractionQuestionCore.js'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('fraction-questions')

const base = { id: 'q', skill: 's', prompt: 'p' }

/* ── choice ────────────────────────────────────────────────────────── */

const CHOICE = {
  ...base,
  type: 'choice',
  options: [{ id: 'half', label: 'One half' }, { id: 'quarter', label: 'One quarter' }],
  answer: 'quarter',
  explanation: 'Four equal pieces, one taken.',
  misconceptions: [{ answer: 'half', code: 'wrong_piece_count', explanation: 'A half is when there are only 2 pieces.' }],
}

test('a choice is right, or is answered by name', () => {
  const right = markResponse(CHOICE, 'quarter')
  assert.equal(right.correct, true)
  assert.equal(right.body, 'Four equal pieces, one taken.')
  const wrong = markResponse(CHOICE, 'half')
  assert.equal(wrong.correct, false)
  assert.match(wrong.body, /only 2 pieces/)
  assert.equal(wrong.misconception, 'wrong_piece_count')
})

test('an unpredicted choice still gets a human sentence, never "Incorrect"', () => {
  const wrong = markResponse({ ...CHOICE, options: [...CHOICE.options, { id: 'third' }] }, 'third')
  assert.equal(wrong.correct, false)
  assert.ok(wrong.body.length > 20)
  assert.equal(wrong.misconception, null)
  assert.doesNotMatch(wrong.body, /^incorrect/i)
})

test('choosing nothing is not a wrong answer', () => {
  assert.equal(markResponse(CHOICE, null).blank, true)
  assert.equal(markResponse(CHOICE, '').blank, true)
})

/* ── shade ─────────────────────────────────────────────────────────── */

const SHADE = {
  ...base,
  type: 'shade',
  visual: { shape: 'bar', object: 'bun', parts: 4 },
  want: 2,
  explanation: 'Half means the same amount on each side.',
  misconceptions: [{ answer: '1', code: 'wrong_piece_count', explanation: 'One piece out of 4 is a quarter, not a half.' }],
}

test('shading is marked on HOW MANY, not which', () => {
  // For an equal partition every region is the same piece, so insisting on the
  // leftmost two would fail a learner who shaded the right amount from the
  // other end. That is a UI opinion, not a maths one.
  assert.equal(markResponse(SHADE, [0, 1]).correct, true)
  assert.equal(markResponse(SHADE, [2, 3]).correct, true)
  assert.equal(markResponse(SHADE, [3, 0]).correct, true)
})

test('shading the wrong number is named by the number', () => {
  const wrong = markResponse(SHADE, [0])
  assert.equal(wrong.correct, false)
  assert.match(wrong.body, /quarter, not a half/)
  assert.equal(wrong.misconception, 'wrong_piece_count')
})

test('shading nothing is not a wrong answer', () => {
  assert.equal(markResponse(SHADE, []).blank, true)
})

/* ── select (a fraction of a group) ────────────────────────────────── */

const SELECT = {
  ...base,
  type: 'select',
  visual: { shape: 'group', object: 'sweet', parts: 8 },
  want: 2,
  explanation: 'Eight sweets in four equal shares is two each.',
  misconceptions: [{ answer: '4', code: 'wrong_piece_count', explanation: '4 out of 8 is a half, not a quarter.' }],
}

test('a fraction of a group is marked on how many things were tapped', () => {
  assert.equal(markResponse(SELECT, [0, 5]).correct, true)
  assert.equal(markResponse(SELECT, [0, 1, 2, 3]).correct, false)
  assert.match(markResponse(SELECT, [0, 1, 2, 3]).body, /a half, not a quarter/)
})

/* ── compare ───────────────────────────────────────────────────────── */

const COMPARE = {
  ...base,
  type: 'compare',
  pair: [{ n: 1, d: 3 }, { n: 1, d: 5 }],
  answer: '>',
  explanation: 'More pieces means smaller pieces.',
  misconceptions: [{ answer: '<', code: 'compared_by_denominator', explanation: '5 is bigger, but it means the pieces are smaller.' }],
}

test('comparing uses the school symbols, and names the classic slip', () => {
  assert.deepEqual(COMPARE_SYMBOLS, ['>', '<', '='])
  assert.equal(markResponse(COMPARE, '>').correct, true)
  const wrong = markResponse(COMPARE, '<')
  assert.equal(wrong.misconception, 'compared_by_denominator')
  assert.equal(markResponse(COMPARE, 'bigger').blank, true, 'anything that is not a symbol is not an answer')
})

/* ── order ─────────────────────────────────────────────────────────── */

const ORDER = {
  ...base,
  type: 'order',
  options: [{ id: 'a', fraction: { n: 1, d: 2 } }, { id: 'b', fraction: { n: 1, d: 4 } }, { id: 'c', fraction: { n: 3, d: 4 } }],
  answer: ['b', 'a', 'c'],
  explanation: 'All of them in quarters: one, two, three.',
  misconceptions: [{ answer: 'a>b>c', code: 'compared_by_denominator', explanation: 'A half is not the smallest.' }],
}

test('ordering is right only in the right order, and a part-order is not an answer', () => {
  assert.equal(markResponse(ORDER, ['b', 'a', 'c']).correct, true)
  assert.equal(markResponse(ORDER, ['b', 'a']).blank, true, 'an unfinished order is not a wrong one')
  const wrong = markResponse(ORDER, ['a', 'b', 'c'])
  assert.equal(wrong.correct, false)
  assert.match(wrong.body, /not the smallest/)
})

/* ── write ─────────────────────────────────────────────────────────── */

const WRITE = {
  ...base,
  type: 'write',
  value: { n: 3, d: 4 },
  misconceptions: [{ answer: '2/6', code: 'added_denominators', explanation: 'The bottoms were added too.' }],
}
const frac = (num, den, whole = '') => ({ mode: 'fraction', whole, num: String(num), den: String(den) })

test('an equivalent written fraction is CORRECT and says how it simplifies', () => {
  const result = markResponse({ ...base, type: 'write', value: { n: 1, d: 2 } }, frac(2, 4))
  assert.equal(result.correct, true)
  assert.match(result.body, /simplifies to one half/)
})

test('a wrong written answer reaches the STRUCTURED misconception list', () => {
  // `markFractionAnswer`'s own lookup only sees the legacy `traps` map. This is
  // the path that finds a coded entry, which is what the review queue reads.
  const wrong = markResponse(WRITE, frac(2, 6))
  assert.equal(wrong.correct, false)
  assert.match(wrong.body, /bottoms were added/)
  assert.equal(wrong.misconception, 'added_denominators')
})

test('a FORM failure is not diagnosed as a value mistake', () => {
  // "Right amount, wrong form" already names exactly what happened. Sending it
  // through the misconception list would look up a right answer and find
  // nothing, or worse, find something.
  const lowest = markResponse({ ...WRITE, value: { n: 1, d: 2 }, form: 'lowest' }, frac(2, 4))
  assert.equal(lowest.correct, false)
  assert.equal(lowest.reason, 'form-lowest')
  assert.equal(lowest.misconception, null)
  assert.match(lowest.body, /lowest terms/)
})

test('a whole-number answer has its own form, and the pad follows it', () => {
  const whole = { ...base, type: 'write', value: { n: 180, d: 1 }, form: 'whole' }
  assert.equal(markResponse(whole, { mode: 'whole', whole: '180' }).correct, true)
  assert.equal(markResponse(whole, { mode: 'whole', whole: '320' }).correct, false)
  assert.equal(markResponse(whole, { mode: 'whole', whole: '' }).blank, true)
  // Writing a fraction where a plain number was asked for is refused with a
  // sentence rather than marked wrong on the value.
  assert.equal(markResponse(whole, frac(180, 1)).reason, 'form-whole')
})

test('a "give it in sixths" question refuses an equivalent with a different bottom', () => {
  // The one place the equivalence rule is narrowed, and it is narrowed by the
  // question naming the bottom it wants — never by default.
  const sixths = { ...base, type: 'write', value: { n: 3, d: 6 }, form: 'denominator', requireDenominator: 6 }
  assert.equal(markResponse(sixths, frac(3, 6)).correct, true)
  const half = markResponse(sixths, frac(1, 2))
  assert.equal(half.correct, false)
  assert.equal(half.reason, 'form-denominator')
  assert.match(half.body, /sixths/)
})

/* ── the response key ──────────────────────────────────────────────── */

test('one misconception list serves every question type', () => {
  assert.equal(responseKey('choice', 'half'), 'half')
  assert.equal(responseKey('compare', '>'), '>')
  assert.equal(responseKey('shade', [0, 1, 2]), '3')
  assert.equal(responseKey('select', [4]), '1')
  assert.equal(responseKey('order', ['b', 'a']), 'b>a')
  assert.equal(responseKey('write', frac(3, 4)), '3/4')
  assert.equal(responseKey('write', frac(3, 4, '2')), '2 3/4')
  assert.equal(responseKey('write', { mode: 'decimal', decimal: '0.75' }), '0.75')
  assert.equal(responseKey('write', { mode: 'whole', whole: '180' }), '180')
  assert.equal(responseKey('choice', null), '')
})

test('the legacy traps map is still read, so no pack had to be rewritten first', () => {
  const legacy = { ...base, type: 'write', value: { n: 3, d: 4 }, traps: { '2/6': 'The bottoms were added.' } }
  assert.match(markResponse(legacy, frac(2, 6)).body, /bottoms were added/)
  assert.equal(diagnose(legacy, '2/6').code, null, 'a legacy trap has no code, and that is honest')
})

test('a coded misconception outranks a legacy trap on the same answer', () => {
  const both = {
    ...base,
    misconceptions: [{ answer: 'x', code: 'inverted', explanation: 'coded' }],
    traps: { x: 'legacy' },
  }
  assert.equal(diagnose(both, 'x').explanation, 'coded')
})

test('the codes a question can produce are listable, for the review queue', () => {
  assert.deepEqual(codesFor(WRITE), ['added_denominators'])
  assert.deepEqual(codesFor({}), [])
  for (const code of Object.values(codesFor(WRITE))) assert.ok(MISCONCEPTION_CODES[code])
})

/* ── the working ───────────────────────────────────────────────────── */

test('a question with no steps gets NO working, and no invented one', () => {
  assert.deepEqual(workingSteps({}), [])
  assert.equal(hasWorking({}), false)
  assert.equal(hasWorking({ workingSteps: [{ title: 'a' }, { title: 'b' }] }), true)
})

test('steps are numbered and keep their order', () => {
  const steps = workingSteps({ workingSteps: [{ title: 'one', math: '1' }, { title: 'two', math: '2' }] })
  assert.deepEqual(steps.map((s) => s.index), [0, 1])
  assert.equal(steps[1].title, 'two')
  assert.deepEqual(workingSteps({ workingSteps: [{}, { title: 'real' }] }).length, 1, 'an empty step is dropped')
})

/* ── validation ────────────────────────────────────────────────────── */

test('a question with no id, type, prompt or skill is refused', () => {
  const result = validateQuestion({})
  assert.equal(result.ok, false)
  for (const code of ['id', 'type', 'prompt', 'skill']) {
    assert.ok(result.errors.some((e) => e.code === code), `missing ${code} must be reported`)
  }
})

test('an answer that is not among the options is refused', () => {
  const result = validateQuestion({ ...CHOICE, answer: 'nothing-like-this' })
  assert.ok(result.errors.some((e) => e.code === 'answer'))
})

test('a lowest-terms question whose own answer is not in lowest terms is refused', () => {
  const result = validateQuestion({ ...base, type: 'write', value: { n: 2, d: 4 }, form: 'lowest' })
  assert.ok(result.errors.some((e) => e.code === 'value-form'))
})

test('a printed answer that disagrees with the machine value is refused', () => {
  const result = validateQuestion({ ...base, type: 'write', value: { n: 3, d: 4 }, answer: '2/3' })
  assert.ok(result.errors.some((e) => e.code === 'answer-value'))
  assert.equal(validateQuestion({ ...base, type: 'write', value: { n: 3, d: 4 }, answer: '6/8' }).ok, true,
    'an equivalent printed answer is fine — it is the same amount')
  assert.equal(validateQuestion({ ...base, type: 'write', value: { n: 11, d: 4 }, answer: '2 3/4', form: 'mixed' }).ok, true)
})

test('a misconception keyed to the RIGHT answer is refused', () => {
  const result = validateQuestion({ ...CHOICE, misconceptions: [{ answer: 'quarter', explanation: 'x' }] })
  assert.ok(result.errors.some((e) => e.code === 'misconception-answer'))
})

test('an unknown misconception code is refused', () => {
  const result = validateQuestion({ ...CHOICE, misconceptions: [{ answer: 'half', code: 'made-up', explanation: 'x' }] })
  assert.ok(result.errors.some((e) => e.code === 'misconception-code'))
})

test('a bad picture fails the QUESTION, not just the picture', () => {
  const result = validateQuestion({ ...SHADE, visual: { shape: 'bar', parts: 4, numerator: 3, shaded: 2 } })
  assert.ok(result.errors.some((e) => e.code.startsWith('visual:')))
})

test('the introduction stage refuses a written fraction anywhere a learner reads', () => {
  const intro = { ...CHOICE, level: 'basics', stage: 1 }
  assert.equal(introducesSymbol(intro), true)
  assert.equal(introducesSymbol({ ...intro, stage: 3 }), false, 'by stage 3 the learner has met it')
  assert.ok(validateQuestion({ ...intro, prompt: 'Which shows 1/2?' }).errors.some((e) => e.code === 'level1-symbol'))
  assert.ok(validateQuestion({ ...intro, fraction: { n: 1, d: 2 } }).errors.some((e) => e.code === 'level1-symbol'))
  assert.ok(validateQuestion({
    ...intro,
    options: [{ id: 'half', fraction: { n: 1, d: 2 } }, { id: 'quarter' }],
  }).errors.some((e) => e.code === 'level1-symbol'))
  // …and stage 3 of the same level may show one, because §8 cannot be taught
  // without a fraction on the screen to point at.
  assert.equal(
    validateQuestion({ ...CHOICE, level: 'basics', stage: 3, fraction: { n: 3, d: 4 } }).ok,
    true,
  )
})

test('level 1 never says "numerator" or "denominator", at any stage', () => {
  const late = { ...CHOICE, level: 'basics', stage: 5, prompt: 'What is the denominator?' }
  assert.ok(validateQuestion(late).errors.some((e) => e.code === 'level1-vocabulary'))
  assert.equal(validateQuestion({ ...CHOICE, level: 'equal', prompt: 'What is the denominator?' }).ok, true,
    'level 2 is where the words are taught')
})

test('learnerFacingText finds everything a learner reads and nothing they do not', () => {
  const pieces = learnerFacingText({ prompt: 'p', caption: 'c', kicker: 'k', explanation: 'never', options: [{ label: 'o' }] })
  assert.deepEqual(pieces.map((x) => x.text).sort(), ['c', 'k', 'o', 'p'])
})

/* ── odds and ends ─────────────────────────────────────────────────── */

test('a written answer parses as fraction, mixed number or whole number', () => {
  assert.deepEqual(parseWrittenAnswer('3/4'), { n: 3, d: 4 })
  assert.deepEqual(parseWrittenAnswer('2 3/4'), { n: 11, d: 4 })
  assert.deepEqual(parseWrittenAnswer('180'), { n: 180, d: 1 })
  assert.equal(parseWrittenAnswer('quarter'), null)
  assert.equal(parseWrittenAnswer('1/0'), null)
  assert.equal(parseWrittenAnswer(undefined), null)
})

test('a question knows the fraction it is about, in numbers and in words', () => {
  assert.deepEqual(questionFraction(WRITE), { n: 3, d: 4 })
  assert.deepEqual(questionFraction({ visual: { parts: 5, numerator: 2 } }), { n: 2, d: 5 })
  assert.equal(questionWords(WRITE), 'three quarters')
  assert.equal(questionWords({}), null)
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
