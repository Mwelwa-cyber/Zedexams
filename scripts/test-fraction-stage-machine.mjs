/**
 * test:fraction-stage-machine — the flow through one question, and the states
 * that must not exist.
 *
 * The teaching shape of a stage — answer, be told which mistake you made, be
 * offered the working, walk it a step at a time, then do the SAME question
 * again unaided — is expressible as five booleans, and that is how it goes
 * wrong. `checking && showWorking && isRetry` is a reachable combination of
 * five flags and is not a state anything meant. So it is one phase and a
 * transition table, and these are the pairs the table refuses.
 */
import assert from 'node:assert/strict'

import {
  PHASES,
  allRevealed,
  begin,
  canAdvance,
  canEditAnswer,
  canSubmit,
  initialState,
  isSettled,
  next,
  openWorking,
  revealStep,
  showsAnswer,
  showsWorking,
  skip,
  startRetry,
  submit,
  tally,
} from '../src/features/games/lib/fractionStageMachine.js'
import { markResponse } from '../src/features/games/lib/fractionQuestionCore.js'

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

console.log('fraction-stage-machine')

const QUESTION = {
  id: 'q1',
  skill: 'add-one-fits',
  type: 'write',
  prompt: '1/2 + 1/4',
  value: { n: 3, d: 4 },
  workingSteps: [
    { title: 'Make the bottoms match', math: '1/2 = 2/4' },
    { title: 'Add the tops only', math: '2/4 + 1/4 = 3/4' },
  ],
  misconceptions: [
    { answer: '2/6', code: 'added_denominators', explanation: 'The bottoms were added too.' },
  ],
}
const RIGHT = { mode: 'fraction', whole: '', num: '3', den: '4' }
const WRONG = { mode: 'fraction', whole: '', num: '2', den: '6' }
const points = () => 20

const start = () => begin(initialState({ total: 3 }))

/* ── the states themselves ─────────────────────────────────────────── */

test('the intro is a state, and Start is the only way out of it', () => {
  const state = initialState({ total: 3 })
  assert.equal(state.phase, 'intro')
  assert.equal(canSubmit(state), false, 'nothing can be answered before the stage has started')
  assert.equal(begin(state).phase, 'asking')
  assert.equal(begin(begin(state)).phase, 'asking', 'begin is idempotent')
})

test('a stage can start already asking, for a resume', () => {
  assert.equal(initialState({ intro: false, total: 2 }).phase, 'asking')
})

/* ── you cannot submit twice ───────────────────────────────────────── */

test('a second submit in the same frame is REFUSED, not scored', () => {
  // The guard is the phase, which submit leaves as its first act — so a double
  // tap arriving before any render still cannot pass it. A React state flag
  // applies on the next render and would let the second one through.
  const first = submit(start(), QUESTION, RIGHT, { pointsFor: points })
  assert.equal(first.state.phase, 'right')
  assert.equal(first.state.score, 20)
  const second = submit(first.state, QUESTION, RIGHT, { pointsFor: points })
  assert.equal(second.state.score, 20, 'the second submit must not score again')
  assert.equal(second.outcome, null, 'and must not produce a second outcome to record')
  assert.equal(second.state, first.state, 'the state is returned untouched')
})

test('a settled question cannot be answered again', () => {
  for (const phase of ['right', 'wrong', 'recovered', 'stillWrong', 'skipped', 'complete']) {
    assert.equal(canSubmit({ ...start(), phase }), false, `${phase} must not accept a submission`)
    assert.equal(canEditAnswer({ ...start(), phase }), false, `${phase} must not accept an edit`)
  }
  assert.equal(canSubmit(start()), true)
  assert.equal(canSubmit({ ...start(), phase: 'retrying' }), true)
})

test('nothing entered is not a mistake — nothing moves and nothing is recorded', () => {
  const blank = submit(start(), QUESTION, { mode: 'fraction', whole: '', num: '', den: '' }, { pointsFor: points })
  assert.equal(blank.state.phase, 'asking', 'the learner is still answering')
  assert.equal(blank.outcome, null, 'an empty pad is not a miss')
  assert.equal(blank.state.attempts, 0)
  assert.ok(blank.verdict.blank)
})

/* ── the wrong path ────────────────────────────────────────────────── */

test('a wrong answer records the miss AT ONCE, with the misconception named', () => {
  // Recorded now rather than when the question finally resolves: whatever the
  // learner does next — working, skip, recover — they got it wrong, and a miss
  // recorded later can be lost by a reload in between.
  const result = submit(start(), QUESTION, WRONG, { pointsFor: points })
  assert.equal(result.state.phase, 'wrong')
  assert.equal(result.outcome.correct, false)
  assert.equal(result.outcome.misconception, 'added_denominators')
  assert.equal(result.state.score, 0)
})

test('the working opens only from a wrong answer, and only where there IS one', () => {
  const wrong = submit(start(), QUESTION, WRONG, { pointsFor: points }).state
  assert.equal(openWorking(wrong, QUESTION).phase, 'working')
  assert.equal(openWorking(start(), QUESTION).phase, 'asking', 'not while still answering')
  const right = submit(start(), QUESTION, RIGHT, { pointsFor: points }).state
  assert.equal(openWorking(right, QUESTION).phase, 'right', 'not from a correct answer')
  // A question with no steps gets no offer. There is deliberately no generated
  // fallback — an invented walk-through after a miss is a confident lie.
  assert.equal(openWorking(wrong, { ...QUESTION, workingSteps: [] }).phase, 'wrong')
})

test('the steps are revealed ONE at a time and never overshoot', () => {
  let state = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  assert.equal(state.revealed, 0)
  state = revealStep(state, 2)
  assert.equal(state.revealed, 1)
  assert.equal(allRevealed(state, 2), false)
  state = revealStep(state, 2)
  assert.equal(state.revealed, 2)
  assert.equal(allRevealed(state, 2), true)
  state = revealStep(state, 2)
  assert.equal(state.revealed, 2, 'revealing past the last step changes nothing')
})

/* ── the retry has no help in it ───────────────────────────────────── */

test('the retry shows NO answer and NO working — the pair is not a state', () => {
  let state = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  state = revealStep(revealStep(state, 2), 2)
  assert.equal(showsWorking(state), true)
  assert.equal(showsAnswer(state), true)
  state = startRetry(state)
  assert.equal(state.phase, 'retrying')
  assert.equal(showsWorking(state), false, 'the solution must be gone')
  assert.equal(showsAnswer(state), false, 'and so must the answer')
  assert.equal(state.verdict, null, 'and the feedback from the first attempt with it')
  assert.equal(canEditAnswer(state), true, 'the learner types it themselves')
})

test('there is no state that is both retrying and showing the answer', () => {
  for (const phase of PHASES) {
    if (phase !== 'retrying') continue
    assert.equal(showsAnswer({ phase }), false)
    assert.equal(showsWorking({ phase }), false)
  }
})

test('the retry is reachable only from the working', () => {
  const wrong = submit(start(), QUESTION, WRONG, { pointsFor: points }).state
  assert.equal(startRetry(wrong).phase, 'wrong', 'not straight from the wrong answer')
  assert.equal(startRetry(start()).phase, 'asking')
})

test('getting it right in the retry is RECOVERY, and says so', () => {
  let state = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  state = startRetry(revealStep(revealStep(state, 2), 2))
  const result = submit(state, QUESTION, RIGHT, { pointsFor: points })
  assert.equal(result.state.phase, 'recovered')
  assert.equal(result.outcome.correct, true)
  assert.equal(result.outcome.firstTry, false, 'a recovery is never a first try')
  assert.equal(result.outcome.recovery, true, 'and the mastery rule reads this to refuse it')
})

test('getting it wrong in the retry too is its own state, and goes on the list', () => {
  let state = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  state = startRetry(revealStep(revealStep(state, 2), 2))
  const result = submit(state, QUESTION, WRONG, { pointsFor: points })
  assert.equal(result.state.phase, 'stillWrong')
  assert.equal(result.outcome.correct, false)
  assert.equal(result.outcome.recovery, false)
  assert.equal(isSettled(result.state), true, 'the learner can move on rather than being stuck on it')
})

/* ── skip ──────────────────────────────────────────────────────────── */

test('skipping declines the help and changes nothing about the miss', () => {
  const wrong = submit(start(), QUESTION, WRONG, { pointsFor: points })
  const skipped = skip(wrong.state)
  assert.equal(skipped.phase, 'skipped')
  assert.equal(canAdvance(skipped), true)
  // The miss was recorded on the wrong answer. Skipping does not un-record it,
  // and does not record a second one.
  assert.equal(skipped.attempts, wrong.state.attempts)
  assert.equal(skip(start()).phase, 'asking', 'there is nothing to skip while still answering')
})

/* ── advancing ─────────────────────────────────────────────────────── */

test('you cannot advance mid-question', () => {
  assert.equal(canAdvance(start()), false)
  assert.equal(next(start()).phase, 'asking', 'and next() refuses rather than skipping the question')
  const working = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  assert.equal(canAdvance(working), false, 'not from inside the working either')
})

test('advancing records the question once, and resets everything per question', () => {
  const right = submit(start(), QUESTION, RIGHT, { pointsFor: points }).state
  const moved = next(right)
  assert.equal(moved.index, 1)
  assert.equal(moved.phase, 'asking')
  assert.equal(moved.answered.length, 1)
  assert.deepEqual(moved.answered[0], { index: 0, correct: true, firstTry: true })
  assert.equal(moved.verdict, null)
  assert.equal(moved.revealed, 0)
  assert.equal(moved.attempts, 0)
  assert.equal(moved.score, 20, 'the score carries across questions')
})

test('a second next() cannot append the same question twice', () => {
  const right = submit(start(), QUESTION, RIGHT, { pointsFor: points }).state
  const once = next(right)
  const twice = next(once)
  assert.equal(twice.answered.length, 1, 'the phase is no longer settled, so nothing is appended')
  assert.equal(twice.index, 1)
})

test('a recovery counts as correct on the stage, but not as first-try', () => {
  let state = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  state = startRetry(revealStep(revealStep(state, 2), 2))
  state = submit(state, QUESTION, RIGHT, { pointsFor: points }).state
  const moved = next(state)
  assert.deepEqual(moved.answered[0], { index: 0, correct: true, firstTry: false })
})

test('a skip and a still-wrong both count as missed', () => {
  const skipped = next(skip(submit(start(), QUESTION, WRONG, { pointsFor: points }).state))
  assert.deepEqual(skipped.answered[0], { index: 0, correct: false, firstTry: false })
})

test('the last question completes the stage rather than asking a fourth', () => {
  let state = begin(initialState({ total: 2 }))
  state = next(submit(state, QUESTION, RIGHT, { pointsFor: points }).state)
  state = next(submit(state, QUESTION, WRONG, { pointsFor: points }).state)
  assert.equal(state.phase, 'complete')
  assert.equal(state.answered.length, 2)
  const summary = tally(state)
  assert.deepEqual(summary, { total: 2, answered: 2, correct: 1, firstTry: 1, recovered: 0, missed: 1 })
})

test('the tally separates first-try from recovered, which is what the stars read', () => {
  let state = begin(initialState({ total: 2 }))
  state = next(submit(state, QUESTION, RIGHT, { pointsFor: points }).state)
  let second = openWorking(submit(state, QUESTION, WRONG, { pointsFor: points }).state, QUESTION)
  second = startRetry(revealStep(revealStep(second, 2), 2))
  second = next(submit(second, QUESTION, RIGHT, { pointsFor: points }).state)
  const summary = tally(second)
  assert.equal(summary.correct, 2)
  assert.equal(summary.firstTry, 1)
  assert.equal(summary.recovered, 1)
})

/* ── the machine and the marker agree ──────────────────────────────── */

test('a half-points recovery still scores less than a first-try answer', () => {
  const scoring = ({ firstTry }) => (firstTry ? 20 : 10)
  const first = submit(start(), QUESTION, RIGHT, { pointsFor: scoring })
  assert.equal(first.state.score, 20)
  let state = openWorking(submit(start(), QUESTION, WRONG, { pointsFor: scoring }).state, QUESTION)
  state = startRetry(revealStep(revealStep(state, 2), 2))
  assert.equal(submit(state, QUESTION, RIGHT, { pointsFor: scoring }).state.score, 10)
})

test('the machine marks through markResponse, so every question type flows', () => {
  const choice = { id: 'c', skill: 's', type: 'choice', prompt: 'p', options: [{ id: 'a' }, { id: 'b' }], answer: 'a' }
  assert.equal(markResponse(choice, 'a').correct, true)
  assert.equal(submit(begin(initialState({ total: 1 })), choice, 'a', { pointsFor: points }).state.phase, 'right')
  const shade = { id: 's', skill: 's', type: 'shade', prompt: 'p', visual: { shape: 'bar', parts: 4 }, want: 2 }
  assert.equal(submit(begin(initialState({ total: 1 })), shade, [0, 1], { pointsFor: points }).state.phase, 'right')
  assert.equal(submit(begin(initialState({ total: 1 })), shade, [], { pointsFor: points }).state.phase, 'asking',
    'nothing tapped is not a wrong answer')
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
