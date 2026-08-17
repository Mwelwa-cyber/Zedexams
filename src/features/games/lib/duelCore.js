/**
 * Pure logic for "Race Zed!" — the honest duel (learner redesign step 7).
 *
 * The prototype's duel faked a human opponent ("Chanda M."); this build
 * keeps its screens and pace but races ZED, openly labelled a robot —
 * no pretend matchmaking, no fabricated players. Zed's whole run is a
 * PRECOMPUTED TIMELINE: before the race starts, a plan decides which of
 * the five questions he gets right and how long each takes him, and the
 * race simply reads his score off that timeline as the clock runs. That
 * makes him deterministic under test (rng injection), fair when the
 * learner finishes first (his final score is the timeline's end — he
 * always finishes his own run), and impossible to quietly rubber-band.
 *
 * Question content comes from existing `timed_quiz` game docs (the
 * standard MCQ shape) — the duel authors nothing and saves the
 * learner's score against the SOURCE game through the kept backend.
 * Zed's score is never written anywhere.
 */

export const DUEL_QUESTIONS = 5

/** Zed's tuning: beatable but not trivial, a touch slower than a
 * confident learner. Delays are per question, in milliseconds. */
export const ZED_TUNING = Object.freeze({
  accuracy: 0.65,
  minDelayMs: 2600,
  maxDelayMs: 6200,
})

/**
 * The default random source: crypto-backed uniform [0, 1). Game
 * outcomes are not secrets, but CodeQL rightly refuses to take that on
 * faith for a draw that decides scores — and `crypto.getRandomValues`
 * is available in every runtime this code sees (browsers, node tests),
 * so there is no cost to drawing properly. Tests inject a seeded rng.
 */
function defaultRng() {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0] / 4294967296
}

function shuffled(list, rng = defaultRng) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The playable MCQ items of a game doc — same contract as timed_quiz:
 * 2+ options and an answer matching one of them (verbatim or index). */
export function playableQuestions(questions) {
  const out = []
  for (const q of questions || []) {
    const options = (q?.options || []).map((o) => String(o ?? '').trim()).filter(Boolean)
    if (options.length < 2) continue
    const asText = String(q?.answer ?? '').trim()
    let correctIndex = options.indexOf(asText)
    if (correctIndex < 0 && /^\d+$/.test(asText) && Number(asText) < options.length) {
      correctIndex = Number(asText)
    }
    if (correctIndex < 0) continue
    out.push({ question: String(q?.question || '').trim() || '…', options, correctIndex })
  }
  return out
}

/**
 * Pick the race's source: the timed_quiz game (learner's grade when one
 * matches, else anywhere) with enough playable questions, plus the five
 * questions drawn from it, options left in place. Null when no game can
 * field a race — the caller shows "no race today" rather than inventing
 * content.
 */
export function pickDuelSource(games, { grade = null, rng = defaultRng } = {}) {
  const quizzes = (games || []).filter((g) => g?.type === 'timed_quiz' && playableQuestions(g.questions).length >= DUEL_QUESTIONS)
  if (!quizzes.length) return null
  const inGrade = quizzes.filter((g) => Number(g.grade) === Number(grade))
  const pool = inGrade.length ? inGrade : quizzes
  const game = pool[Math.floor(rng() * pool.length)]
  const questions = shuffled(playableQuestions(game.questions), rng).slice(0, DUEL_QUESTIONS)
  return { game, questions }
}

/**
 * Zed's plan: for each question, whether he gets it right and how long
 * he takes. Pure draw — the race never re-rolls it.
 */
export function zedPlan(count = DUEL_QUESTIONS, rng = defaultRng, tuning = ZED_TUNING) {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => ({
    correct: rng() < tuning.accuracy,
    delayMs: Math.round(tuning.minDelayMs + rng() * (tuning.maxDelayMs - tuning.minDelayMs)),
  }))
}

/** Points for a correct answer — 20 × combo, the quiz family's scoring. */
export function answerGain(combo) {
  return 20 * Math.max(1, Math.floor(Number(combo) || 1))
}

/**
 * Zed's cumulative score over time: [{ atMs, score }], one entry per
 * question he answers, delays summed from the race start. His combo
 * follows the same 20 × combo arithmetic as the learner's.
 */
export function zedTimeline(plan) {
  const points = []
  let atMs = 0
  let score = 0
  let combo = 1
  for (const step of plan || []) {
    atMs += step.delayMs
    if (step.correct) {
      score += answerGain(combo)
      combo += 1
    } else {
      combo = 1
    }
    points.push({ atMs, score })
  }
  return points
}

/** Zed's score at a moment in the race. */
export function zedScoreAt(timeline, elapsedMs) {
  let score = 0
  for (const point of timeline || []) {
    if (point.atMs <= elapsedMs) score = point.score
    else break
  }
  return score
}

/** Zed's final score — he always finishes his own run. */
export function zedFinalScore(timeline) {
  return timeline?.length ? timeline[timeline.length - 1].score : 0
}

/** The most either racer could hold after `answered` questions — the
 * denominator both score bars share, so they stay comparable. */
export function maxScoreAfter(answered = DUEL_QUESTIONS) {
  let total = 0
  for (let combo = 1; combo <= Math.max(0, Math.floor(answered)); combo += 1) total += answerGain(combo)
  return total
}

/** Who took the race. */
export function duelVerdict(yourScore, zedScore) {
  const you = Number(yourScore) || 0
  const zed = Number(zedScore) || 0
  if (you > zed) return 'win'
  if (you < zed) return 'lose'
  return 'tie'
}

/**
 * Map the learner's half of a finished race onto the shared
 * `useGameFinish` result shape. Zed appears nowhere in it — only the
 * learner's run is saved, against the source game.
 */
export function roundResult({ game, score, correct, wrong, peakCombo, timeSpentMs }) {
  const right = Math.max(0, Math.floor(Number(correct) || 0))
  const missed = Math.max(0, Math.floor(Number(wrong) || 0))
  const attempts = right + missed
  return {
    game,
    score: Math.max(0, Math.floor(Number(score) || 0)),
    correct: right,
    wrong: missed,
    accuracy: attempts ? Math.round((right / attempts) * 100) : 0,
    bestStreak: Math.max(0, Math.floor(Number(peakCombo) || 0)),
    timeSpent: Math.max(1, Math.round((Number(timeSpentMs) || 0) / 1000)),
  }
}
