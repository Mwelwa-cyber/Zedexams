/**
 * Tests for the Province Shapes game core (src/features/games/lib/provinceShapesCore.js).
 *
 * Run: node scripts/test-province-shapes.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  DEFAULT_POINTS,
  DEFAULT_DURATION,
  EMPTY_QUESTION,
  PROVINCE_SLUGS,
  ZAMBIA_PROVINCES,
  accuracyPct,
  advanceOutcome,
  clampScore,
  correctAnswerOutcome,
  correctIndexFor,
  questionAt,
  ratingStarsFor,
  resolveDuration,
  resolvePoints,
  shouldCelebrate,
  silhouetteMapSpec,
  timerPct,
  wrongAnswerPenalty,
} from '../src/features/games/lib/provinceShapesCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

/* ── game-doc config resolution ──────────────────────────────── */

assert(resolvePoints({ points: 20 }) === 20, 'explicit points win')
assert(resolvePoints({ points: '25' }) === 25, 'string points coerce')
assert(resolvePoints({}) === DEFAULT_POINTS, 'missing points fall back to default')
assert(resolvePoints({ points: 0 }) === DEFAULT_POINTS, 'zero points fall back (falsy)')
assert(resolvePoints({ points: 'abc' }) === DEFAULT_POINTS, 'NaN points fall back')
assert(resolvePoints(undefined) === DEFAULT_POINTS, 'no game doc falls back')

assert(resolveDuration({ timer: 60 }) === 60, 'explicit timer wins')
assert(resolveDuration({}) === DEFAULT_DURATION, 'missing timer falls back to default')
assert(resolveDuration({ timer: 0 }) === DEFAULT_DURATION, 'zero timer falls back (falsy)')

/* ── deck access ─────────────────────────────────────────────── */

const deck = [
  { question: 'Which province is this?', options: ['Lusaka', 'Central', 'Eastern', 'Southern'], answer: 'Central', provinceId: 'central' },
  { question: '', options: ['Copperbelt', 'Luapula'], answer: 'Luapula', provinceId: 'luapula' },
]
assert(questionAt(deck, 0) === deck[0], 'in-range position returns the deck question')
assert(questionAt(deck, 2) === EMPTY_QUESTION, 'past-the-end position returns the empty question')
assert(questionAt(undefined, 0) === EMPTY_QUESTION, 'missing deck returns the empty question')
assert(Array.isArray(EMPTY_QUESTION.options) && EMPTY_QUESTION.options.length === 0, 'empty question is render-safe')

/* ── correct-answer index (string-coerced, no duplicates needed) ── */

assert(correctIndexFor(deck[0]) === 1, 'finds the answer among the options')
assert(correctIndexFor({ options: ['1', '2', '10'], answer: 10 }) === 2, 'numeric answer matches its string option')
assert(correctIndexFor({ options: [1, 2, 10], answer: '10' }) === 2, 'string answer matches its numeric option')
assert(correctIndexFor({ options: ['A', 'B'], answer: 'Z' }) === -1, 'answer missing from options is -1')
assert(correctIndexFor({}) === -1, 'question with no options is -1')
assert(correctIndexFor(EMPTY_QUESTION) === -1, 'the render-safe empty question yields -1 (zero options)')

/* ── scoring: streak bonus ramps and caps ────────────────────── */

{
  const first = correctAnswerOutcome(0, 15)
  assert(first.newStreak === 1 && first.bonus === 0 && first.gained === 15, 'first correct: base points, no bonus')
  const second = correctAnswerOutcome(1, 15)
  assert(second.newStreak === 2 && second.bonus === 0 && second.gained === 15, 'streak 2: still no bonus')
  const third = correctAnswerOutcome(2, 15)
  assert(third.newStreak === 3 && third.bonus === 1 && third.gained === 16, 'streak 3: +1 bonus')
  const sixth = correctAnswerOutcome(5, 15)
  assert(sixth.bonus === 2 && sixth.gained === 17, 'streak 6: +2 bonus')
  const fifteenth = correctAnswerOutcome(14, 15)
  assert(fifteenth.bonus === 5 && fifteenth.gained === 20, 'streak 15: bonus reaches the +5 cap')
  const thirtieth = correctAnswerOutcome(29, 15)
  assert(thirtieth.bonus === 5 && thirtieth.gained === 20, 'bonus never exceeds +5')
  const otherPoints = correctAnswerOutcome(2, 10)
  assert(otherPoints.gained === 11, 'bonus rides on top of the game\'s own points value')
}

/* ── scoring: wrong-answer penalty + clamp ───────────────────── */

assert(wrongAnswerPenalty(15) === 3, '15-point game: penalty is 3 (quarter, floored)')
assert(wrongAnswerPenalty(40) === 10, '40-point game: penalty is 10')
assert(wrongAnswerPenalty(4) === 2, 'small games never drop below the 2-point penalty floor')
assert(wrongAnswerPenalty(0) === 2, 'zero points still penalises 2')

assert(clampScore(12) === 12, 'positive score passes through')
assert(clampScore(0) === 0, 'zero passes through')
assert(clampScore(-3) === 0, 'a penalty can never push the score negative')

/* ── accuracy ────────────────────────────────────────────────── */

assert(accuracyPct(0, 0) === 0, 'unanswered round is 0%, not NaN')
assert(accuracyPct(10, 0) === 100, 'all correct is 100%')
assert(accuracyPct(0, 10) === 0, 'all wrong is 0%')
assert(accuracyPct(1, 2) === 33, 'one of three rounds to 33%')
assert(accuracyPct(2, 1) === 67, 'two of three rounds to 67%')

/* ── celebration + rating edges ──────────────────────────────── */

assert(shouldCelebrate(50, 0) === true, 'score 50 celebrates regardless of accuracy')
assert(shouldCelebrate(49, 79) === false, 'just under both bars: no celebration')
assert(shouldCelebrate(0, 80) === true, 'accuracy 80 celebrates regardless of score')

assert(ratingStarsFor(100) === 5 && ratingStarsFor(90) === 5, '90%+ is five stars')
assert(ratingStarsFor(89) === 4 && ratingStarsFor(70) === 4, '70–89% is four stars')
assert(ratingStarsFor(69) === 3 && ratingStarsFor(50) === 3, '50–69% is three stars')
assert(ratingStarsFor(49) === 2 && ratingStarsFor(0) === 2, 'below 50% is two stars')

/* ── timer bar ───────────────────────────────────────────────── */

assert(timerPct(90, 90) === 100, 'full clock is 100%')
assert(timerPct(45, 90) === 50, 'half clock is 50%')
assert(timerPct(0, 90) === 0, 'expired clock is 0%')
assert(timerPct(-1, 90) === 0, 'overrun clamps to 0, never negative')

/* ── progression ─────────────────────────────────────────────── */

{
  const mid = advanceOutcome(3, 10)
  assert(mid.nextPos === 4 && mid.done === false, 'mid-deck advance moves to the next question')
  const last = advanceOutcome(9, 10)
  assert(last.done === true, 'answering the final question ends the round')
  const empty = advanceOutcome(0, 0)
  assert(empty.done === true, 'an empty deck is immediately done')
}

/* ── silhouette map spec (real province data) ────────────────── */

{
  const spec = silhouetteMapSpec({ provinceId: 'central' })
  const central = ZAMBIA_PROVINCES.central
  assert(spec !== null, 'known province yields a spec')
  assert(spec.lat === central.center.lat && spec.lng === central.center.lng, 'spec centers on the province')
  assert(spec.zoom === central.zoom, 'spec uses the province zoom')
  assert(spec.size[0] === 600 && spec.size[1] === 380, 'spec uses the 600x380 game frame')
  assert(spec.mapType === 'terrain', 'spec renders on terrain tiles')
  assert(spec.paths.length === 1 && spec.paths[0].points === central.polygon, 'spec draws the province polygon')
  assert(spec.paths[0].fillcolor === '0xff572277', 'spec fills the silhouette')
}

assert(silhouetteMapSpec({ provinceId: 'atlantis' }) === null, 'unknown province yields null (component falls back)')
assert(silhouetteMapSpec(undefined) === null, 'missing question yields null')
assert(silhouetteMapSpec(EMPTY_QUESTION) === null, 'empty question yields null')

for (const slug of PROVINCE_SLUGS) {
  const spec = silhouetteMapSpec({ provinceId: slug })
  assert(spec && Number.isFinite(spec.lat) && Number.isFinite(spec.lng), `${slug}: spec has finite center`)
  assert(spec.paths[0].points.length >= 3, `${slug}: polygon has enough vertices to draw`)
}

console.log(`province-shapes core: ${passed} assertions passed ✓`)
