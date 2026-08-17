/**
 * Tests for the Race Zed! duel core (src/features/games/lib/duelCore.js)
 * — the honest robot race (learner redesign step 7): Zed's run is a
 * precomputed deterministic timeline, question content comes from
 * existing timed_quiz docs, and only the learner's half maps onto the
 * saved-round shape.
 *
 * Run: node scripts/test-duel.mjs
 * Plain node script, throws on assertion failure — repo test convention.
 */
import {
  DUEL_QUESTIONS,
  ZED_TUNING,
  answerGain,
  duelVerdict,
  maxScoreAfter,
  pickDuelSource,
  playableQuestions,
  roundResult,
  zedFinalScore,
  zedPlan,
  zedScoreAt,
  zedTimeline,
} from '../src/features/games/lib/duelCore.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const QUIZ = (id, grade, n = 6) => ({
  id,
  grade,
  type: 'timed_quiz',
  questions: Array.from({ length: n }, (_, i) => ({
    question: `${i} + ${i} = ?`,
    options: [String(i + i), String(i + i + 1)],
    answer: String(i + i),
  })),
})

/* ── Question normalisation ────────────────────────────────────── */
{
  const qs = playableQuestions([
    { question: '6 × 7', options: ['42', '36'], answer: '42' },
    { question: 'index answer', options: ['a', 'b', 'c'], answer: '2' },
    { question: 'no answer', options: ['x', 'y'], answer: 'z' },
    { question: 'one option', options: ['only'], answer: 'only' },
  ])
  assert(qs.length === 2, 'only items with 2+ options and a resolvable answer survive')
  assert(qs[0].correctIndex === 0 && qs[1].correctIndex === 2, 'verbatim and index answers both resolve')
}

/* ── Source picking ────────────────────────────────────────────── */
{
  const games = [
    QUIZ('quiz-g4', 4),
    QUIZ('quiz-g6', 6),
    { id: 'not-a-quiz', grade: 4, type: 'word_builder', questions: [] },
    QUIZ('too-small', 4, 3),
  ]
  const src = pickDuelSource(games, { grade: 4, rng: mulberry32(1) })
  assert(src.game.id === 'quiz-g4', 'the learner grade wins when it can field a race')
  assert(src.questions.length === DUEL_QUESTIONS, 'a race is five questions')
  assert(new Set(src.questions.map((q) => q.question)).size === DUEL_QUESTIONS, 'no repeated questions')
  const offGrade = pickDuelSource(games, { grade: 1, rng: mulberry32(2) })
  assert(['quiz-g4', 'quiz-g6'].includes(offGrade.game.id), 'no in-grade quiz → any quiz fields the race')
  assert(pickDuelSource([{ id: 'x', type: 'timed_quiz', grade: 4, questions: [] }]) === null, 'no fieldable quiz → null, never invented content')
}

/* ── Zed's plan + timeline ─────────────────────────────────────── */
{
  const plan = zedPlan(DUEL_QUESTIONS, mulberry32(3))
  assert(plan.length === DUEL_QUESTIONS, 'one plan step per question')
  assert(plan.every((s) => s.delayMs >= ZED_TUNING.minDelayMs && s.delayMs <= ZED_TUNING.maxDelayMs), 'delays stay in tuning bounds')
  const again = zedPlan(DUEL_QUESTIONS, mulberry32(3))
  assert(JSON.stringify(plan) === JSON.stringify(again), 'the same seed draws the same plan — Zed is deterministic under test')
}
{
  const plan = [
    { correct: true, delayMs: 3000 },
    { correct: true, delayMs: 3000 },
    { correct: false, delayMs: 3000 },
    { correct: true, delayMs: 3000 },
  ]
  const timeline = zedTimeline(plan)
  assert(timeline.length === 4, 'one timeline point per answer')
  // 20 (×1) then 40 (×2), a miss resets, then 20 (×1) again.
  assert(timeline[0].score === 20 && timeline[1].score === 60 && timeline[2].score === 60 && timeline[3].score === 80, 'Zed scores by the same 20 × combo arithmetic')
  assert(timeline[3].atMs === 12000, 'delays accumulate from the race start')
  assert(zedScoreAt(timeline, 0) === 0, 'before his first answer Zed holds zero')
  assert(zedScoreAt(timeline, 6500) === 60, 'mid-race reads the last crossed point')
  assert(zedScoreAt(timeline, 999999) === 80 && zedFinalScore(timeline) === 80, 'Zed always finishes his own run')
  assert(zedFinalScore([]) === 0, 'an empty timeline is zero, not a crash')
}
{
  // Over many seeds, Zed wins some and loses some — beatable, not trivial.
  let perfect = 0
  for (let seed = 0; seed < 200; seed += 1) {
    const timeline = zedTimeline(zedPlan(DUEL_QUESTIONS, mulberry32(seed)))
    if (zedFinalScore(timeline) === maxScoreAfter(DUEL_QUESTIONS)) perfect += 1
  }
  assert(perfect > 0 && perfect < 100, `Zed sometimes aces, mostly does not (${perfect}/200 perfect runs)`)
}

/* ── Scoring + verdict ─────────────────────────────────────────── */
assert(answerGain(1) === 20 && answerGain(4) === 80, 'an answer pays 20 × combo')
assert(maxScoreAfter(5) === 300, 'a perfect five-answer run holds 300')
assert(maxScoreAfter(0) === 0, 'nothing answered, nothing held')
assert(duelVerdict(80, 60) === 'win' && duelVerdict(40, 60) === 'lose' && duelVerdict(60, 60) === 'tie', 'verdict compares final scores')

/* ── Saved-round mapping ───────────────────────────────────────── */
{
  const game = { id: 'quiz-g4' }
  const result = roundResult({ game, score: 120, correct: 4, wrong: 1, peakCombo: 3, timeSpentMs: 42500 })
  assert(result.game === game, 'the SOURCE game rides through — the learner score saves against it')
  assert(result.correct === 4 && result.wrong === 1 && result.accuracy === 80, 'answers map to correct/wrong/accuracy')
  assert(result.bestStreak === 3 && result.timeSpent === 43, 'peak combo carries; time rounds to seconds')
  assert(!('zed' in result) && !('opponent' in result), 'Zed appears nowhere in the saved shape')
  const idle = roundResult({ game, score: 0, correct: 0, wrong: 0, peakCombo: 1, timeSpentMs: 0 })
  assert(idle.accuracy === 0 && idle.timeSpent === 1, 'an idle race is 0% accuracy and never a zero-second save')
}

console.log(`test-duel: ${passed} assertions passed`)
