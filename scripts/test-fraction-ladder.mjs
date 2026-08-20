/**
 * test:fraction-ladder — the marking function and the unlock ladder.
 *
 * Both halves fail silently in a UI test. A marker that rejects 2/4 for 1/2
 * renders a perfectly good red cross; a ladder that opens a level early
 * renders a perfectly good level. So the rules are asserted here, against the
 * pure functions, including the one that has to hold for EVERY level.
 */
import assert from 'node:assert/strict'

import { GAMES_SEED } from '../src/data/gamesSeed.js'
import {
  FRACTION_LEVELS,
  answerGain,
  blockerText,
  fracWords,
  isOpen,
  levelState,
  markFractionAnswer,
  mixedWords,
  playableLevels,
  questionsForLevel,
  simplify,
  starsForScore,
} from '../src/features/games/lib/fractionLadderCore.js'

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

const HALF = { value: { n: 1, d: 2 } }
const frac = (num, den, whole = '') => ({ mode: 'fraction', whole, num: String(num), den: String(den) })

console.log('fraction-ladder')

/* ── marking ───────────────────────────────────────────────────────── */

test('an equivalent fraction is CORRECT, and says how it simplifies', () => {
  const result = markFractionAnswer(frac(2, 4), HALF)
  assert.equal(result.correct, true, '2/4 is the right amount and must be marked right')
  assert.match(result.note, /simplifies to one half/)
})

test('…unless the question asks for lowest terms', () => {
  const result = markFractionAnswer(frac(2, 4), { ...HALF, form: 'lowest' })
  assert.equal(result.correct, false)
  assert.equal(result.reason, 'form-lowest')
  assert.match(result.headline, /Right amount, wrong form/)
  assert.match(result.why, /one half/, 'the feedback must say what the simpler form is')
  // And the same answer already in lowest terms passes.
  assert.equal(markFractionAnswer(frac(1, 2), { ...HALF, form: 'lowest' }).correct, true)
})

test('improper and mixed are interchangeable unless one is asked for', () => {
  const sevenQuarters = { value: { n: 7, d: 4 } }
  assert.equal(markFractionAnswer(frac(7, 4), sevenQuarters).correct, true)
  assert.equal(markFractionAnswer(frac(3, 4, '1'), sevenQuarters).correct, true)
  // The note teaches the other form each way round.
  assert.match(markFractionAnswer(frac(7, 4), sevenQuarters).note, /mixed number/)
  assert.match(markFractionAnswer(frac(3, 4, '1'), sevenQuarters).note, /improper fraction/)
  // Asked for, the form is part of the answer.
  assert.equal(markFractionAnswer(frac(7, 4), { ...sevenQuarters, form: 'mixed' }).reason, 'form-mixed')
  assert.equal(markFractionAnswer(frac(3, 4, '1'), { ...sevenQuarters, form: 'improper' }).reason, 'form-improper')
})

test('a decimal is refused unless the question allows it', () => {
  const typed = { mode: 'decimal', decimal: '0.5' }
  const refused = markFractionAnswer(typed, HALF)
  assert.equal(refused.correct, false)
  assert.equal(refused.reason, 'form-decimal')
  assert.match(refused.why, /one half/)
  assert.equal(markFractionAnswer(typed, { ...HALF, allowDecimal: true }).correct, true)
  // Within the question's own tolerance, and outside it.
  assert.equal(markFractionAnswer({ mode: 'decimal', decimal: '0.501' }, { ...HALF, allowDecimal: true }).correct, true)
  assert.equal(markFractionAnswer({ mode: 'decimal', decimal: '0.55' }, { ...HALF, allowDecimal: true }).correct, false)
})

test('a question may ask for the decimal, and refuse the fraction', () => {
  const asDecimal = { value: { n: 3, d: 8 }, form: 'decimal', tolerance: 0.001 }
  const wrote = markFractionAnswer(frac(3, 8), asDecimal)
  assert.equal(wrote.correct, false, 'the right amount, but not in the form the question asked for')
  assert.equal(wrote.reason, 'form-fraction')
  assert.match(wrote.why, /Divide the top by the bottom/)
  assert.equal(markFractionAnswer({ mode: 'decimal', decimal: '0.375' }, asDecimal).correct, true)
  assert.equal(markFractionAnswer({ mode: 'decimal', decimal: '0.38' }, asDecimal).correct, false)
})

test('a wrong answer gets its own misconception when the question names one', () => {
  const question = {
    value: { n: 3, d: 4 },
    traps: { '2/6': 'You added the bottoms as well. The bottom says what SIZE the pieces are — it stays 4.' },
  }
  const named = markFractionAnswer(frac(2, 6), question)
  assert.equal(named.correct, false)
  assert.match(named.why, /added the bottoms/)
  // An answer nobody wrote a trap for still gets a human sentence.
  assert.equal(markFractionAnswer(frac(5, 9), question).why, 'Let us walk through it.')
})

test('a zero bottom is explained, not just refused', () => {
  const result = markFractionAnswer(frac(1, 0), HALF)
  assert.equal(result.reason, 'zero-denominator')
  assert.match(result.why, /how many pieces/)
})

test('nothing entered is not a wrong answer', () => {
  assert.equal(markFractionAnswer(frac('', ''), HALF).reason, 'blank')
  assert.equal(markFractionAnswer({ mode: 'decimal', decimal: '' }, { ...HALF, allowDecimal: true }).reason, 'blank')
})

test('the words are the accessible name, not the digits', () => {
  assert.equal(fracWords(1, 2), 'one half')
  assert.equal(fracWords(3, 4), 'three quarters')
  assert.equal(fracWords(2, 2), 'two halves')
  assert.equal(fracWords(5, 13), 'five thirteenths')
  assert.equal(mixedWords(2, 1, 3), 'two and one third')
  assert.equal(mixedWords(0, 1, 3), 'one third')
  assert.deepEqual(simplify(6, 8), [3, 4])
})

/* ── the ladder ────────────────────────────────────────────────────── */

test('level 1 is open to everybody and nothing else is', () => {
  assert.equal(levelState('basics', []).state, 'open')
  for (const level of FRACTION_LEVELS.slice(1)) {
    assert.equal(levelState(level.id, []).state, 'locked', `${level.id} must not open before anything is passed`)
  }
})

test('EVERY level still refuses to open without its own predecessor', () => {
  // Pass every level except one, then check that one's predecessor still gates
  // it. This is the check that catches a prereq list quietly going empty.
  for (const level of FRACTION_LEVELS.slice(1)) {
    const previous = FRACTION_LEVELS.find((l) => l.order === level.order - 1)
    const passed = FRACTION_LEVELS
      .filter((l) => l.id !== level.id && l.id !== previous.id)
      .map((l) => l.id)
    const state = levelState(level.id, passed)
    assert.equal(state.state, 'locked', `${level.id} opened without ${previous.id}`)
    assert.ok(state.blockers.includes(previous.id), `${level.id}'s lock must name ${previous.id}`)
  }
})

test('a lock names the NEXT thing to do, earliest first', () => {
  const state = levelState('real', ['basics', 'equal', 'compare'])
  assert.equal(state.state, 'locked')
  assert.deepEqual(state.blockers, ['add', 'sub', 'mult', 'div', 'fdp'])
  assert.match(blockerText(state.blockers), /^Level 4 — Adding fractions,/)
  assert.match(blockerText(state.blockers), /and Level 8 — Fractions, decimals & percentages$/)
  assert.equal(blockerText(['add']), 'Level 4 — Adding fractions')
  assert.equal(blockerText([]), '')
})

test('stars never gate anything', () => {
  // A bare pass — no score, no stars — opens the next level, and a score
  // handed in alongside changes nothing, because the rule has nowhere to read
  // one. A child who scrapes a pass moves on exactly as one who aced it does.
  assert.equal(isOpen('equal', ['basics']), true)
  assert.deepEqual(
    levelState('equal', ['basics'], { stars: 1, score: 20 }),
    levelState('equal', ['basics'], { stars: 3, score: 900 }),
    'a score passed alongside must make no difference at all',
  )
  // …and passing an EARLIER level does not open a later one, however well it
  // went. Only the sequence does that.
  assert.equal(levelState('compare', ['basics']).state, 'locked')
})

test('the ladder is walkable end to end, one level at a time', () => {
  const passed = []
  for (const level of FRACTION_LEVELS) {
    assert.equal(levelState(level.id, passed).state, 'open', `${level.id} should be next`)
    passed.push(level.id)
  }
  assert.equal(passed.length, 9)
})

test('a pack answers for the levels it has questions for', () => {
  const game = {
    questions: [
      { level: 'basics', prompt: 'a' },
      { level: 'basics', prompt: 'b' },
      { level: 'equal', prompt: 'c' },
    ],
  }
  assert.equal(questionsForLevel(game, 'basics').length, 2)
  assert.equal(questionsForLevel(game, 'div').length, 0)
  assert.deepEqual(playableLevels(game).map((l) => l.id), ['basics', 'equal'])
  assert.deepEqual(playableLevels({}).map((l) => l.id), [], 'a pack with no questions offers no levels')
})

test('scoring matches the other mechanics', () => {
  assert.equal(answerGain(1), 20)
  assert.equal(answerGain(4), 80)
  assert.equal(starsForScore(140), 3)
  assert.equal(starsForScore(59), 1)
})

/* ── the shipped content ───────────────────────────────────────────── */

test('every shipped answer key marks CORRECT against its own value', () => {
  // The answer key and the machine value are two fields, so they can disagree,
  // and a disagreement is invisible: the question renders, the learner types
  // the printed answer, and is told they are wrong. Nothing else checks this.
  for (const pack of GAMES_SEED.filter((g) => g.type === 'fraction_ladder')) {
    for (const question of pack.questions) {
      const entry = question.form === 'decimal'
        ? { mode: 'decimal', decimal: question.answer }
        : { mode: 'fraction', num: String(question.answer).split('/')[0], den: String(question.answer).split('/')[1] }
      const marked = markFractionAnswer(entry, question)
      assert.equal(
        marked.correct, true,
        `${pack.id} / "${question.question}": its own printed answer ${question.answer} marks as "${marked.headline}" — ${marked.why || ''}`,
      )
    }
  }
})

test('every shipped question belongs to a real level, and every trap is reachable', () => {
  const known = new Set(FRACTION_LEVELS.map((l) => l.id))
  for (const pack of GAMES_SEED.filter((g) => g.type === 'fraction_ladder')) {
    for (const question of pack.questions) {
      assert.ok(known.has(question.level), `${pack.id}: "${question.question}" is filed under level "${question.level}"`)
      assert.ok(question.value?.d, `${pack.id}: "${question.question}" has no value for the marker to compare against`)
      for (const wrong of Object.keys(question.traps || {})) {
        // A trap keyed to the RIGHT answer would never fire, and would mean a
        // learner who is correct was expected to be wrong.
        const entry = question.form === 'decimal'
          ? { mode: 'decimal', decimal: wrong }
          : { mode: 'fraction', num: wrong.split('/')[0], den: wrong.split('/')[1] }
        assert.equal(
          markFractionAnswer(entry, { ...question, traps: undefined }).correct, false,
          `${pack.id}: the trap "${wrong}" on "${question.question}" is a CORRECT answer — it can never fire`,
        )
      }
    }
  }
})

test('the shipped pack fills every level of the ladder', () => {
  const pack = GAMES_SEED.find((g) => g.id === 'math_fraction_ladder_g7')
  assert.ok(pack, 'the Grade 7 fraction pack is missing')
  const empty = FRACTION_LEVELS.filter((level) => questionsForLevel(pack, level.id).length < 3)
  assert.deepEqual(
    empty.map((l) => l.id), [],
    'a level with fewer than three questions ends before it teaches anything',
  )
})

if (failures > 0) {
  console.error(`\nfraction-ladder — ${failures} failed`)
  process.exit(1)
}
console.log('fraction-ladder — all passed')
