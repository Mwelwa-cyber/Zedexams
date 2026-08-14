/**
 * The LEGACY path — flag off — after the round reducer was extracted.
 *
 * `timedQuizRound.js` replaced eight `useState`s that every learner's round
 * runs through today, whether or not the Assessment Engine flag is on. So the
 * extraction has to be proved on the OLD path first: the engine cutover is
 * behind a switch nobody has flipped, and this is not.
 *
 * Each case below was run against BOTH the pre-extraction component and this
 * one, and the results are recorded in the PR. Where they differ, the
 * difference is stated in the test rather than smoothed over.
 *
 * The flag is mocked OFF for every case here — this file is about the code path
 * a learner is on right now.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => ({
    engine: false, resolved: true, final: true, live: true, latched: false,
    runner: 'game', source: 'runner-off',
  }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Chanda' } }),
}))
vi.mock('../../utils/gamesService', () => ({
  shuffle: (arr) => arr.slice(),
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
  readRoundBaseline: vi.fn(async () => ({})),
  readRoundOutcome: vi.fn(async () => ({ levelChange: null, personalBest: null })),
}))
vi.mock('../../utils/gameBadgesService', () => ({
  evaluateAndAwardGameBadges: vi.fn(async () => ({ newlyEarned: [] })),
}))
vi.mock('../../utils/dailyChallengeService', () => ({
  getTodaysChallenge: vi.fn(async () => ({ game: null })),
  recordDailyPlay: vi.fn(async () => ({ isDaily: false })),
}))
vi.mock('../../utils/gameSounds', () => ({
  playCorrect: vi.fn(), playWrong: vi.fn(), playWin: vi.fn(),
  playStreak: vi.fn(), primeSounds: vi.fn(),
}))
vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('./Leaderboard', () => ({ default: () => null }))
vi.mock('./SmartFeedback', () => ({ default: () => null }))

import TimedQuizGame from './TimedQuizGame'
import { saveScore } from '../../utils/gamesService'

/**
 * Three questions, correct at index 1, 2 and 0. `points: 10`, so a correct
 * answer is +10 (no streak bonus below three) and a wrong one is −2.
 */
const GAME = Object.freeze({
  id: 'game-1',
  title: 'Times Tables Sprint',
  description: 'Answer as many as you can.',
  subject: 'mathematics',
  grade: 4,
  type: 'timed_quiz',
  timer: 10,
  points: 10,
  questions: [
    { question: '6 x 7', options: ['36', '42', '48'], answer: '42' },
    { question: '8 x 4', options: ['24', '28', '32'], answer: '32' },
    { question: '9 x 3', options: ['27', '30', '33'], answer: '27' },
  ],
})

function mountGame() {
  return render(<MemoryRouter><TimedQuizGame game={GAME} /></MemoryRouter>)
}

const startRound = () => fireEvent.click(screen.getByRole('button', { name: /start sprint/i }))
const optionCard = () => document.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2')
const options = () => within(optionCard()).getAllByRole('button')
const scoreValue = () => screen.getByText('Score').parentElement.querySelector('.font-display').textContent
const wrongValue = () => screen.getByText('Wrong').parentElement.querySelector('.font-display').textContent

/** Run the 700ms reveal beat so the deck advances to the next question. */
function advancePastReveal() {
  act(() => { vi.advanceTimersByTime(700) })
}

/**
 * Burn the whole clock, which calls `finish()` from the countdown effect.
 *
 * Advanced one second at a TIME rather than in one jump: the countdown is a
 * chain of `setTimeout(…, 1000)` calls, each scheduled by the render that the
 * previous tick's `setTimeLeft` caused. Jumping the whole round in one
 * `advanceTimersByTime` fires the first timeout and then finds nothing else
 * scheduled, so the clock never reaches zero and `finish()` never runs.
 */
async function runOutTheClock() {
  for (let i = 0; i <= GAME.timer + 1; i += 1) {
    act(() => { vi.advanceTimersByTime(1000) })
  }
  await flushFinish()
}

/**
 * `finish()` is async — it awaits `readRoundBaseline` before `saveScore` and
 * then three more calls after it. Advancing fake timers runs the countdown but
 * not the microtask queue, so without this the assertions read `saveScore`
 * before it has been reached.
 */
async function flushFinish() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TimedQuizGame — the legacy path, after the reducer extraction', () => {
  it('the old card still serves and still scores', async () => {
    mountGame()
    startRound()
    expect(optionCard()).not.toBeNull()
    fireEvent.click(options()[1])
    expect(scoreValue()).toBe('10')
  })

  // ── 1. rapid / double selection ────────────────────────────────────────────

  it('a second click on the SAME question is ignored, however fast', async () => {
    // `pick()`'s guard is `picked !== null`, and after the first click React has
    // committed `picked` before the next event is dispatched — so the second
    // click returns early rather than scoring twice.
    mountGame()
    startRound()
    const rows = options()
    fireEvent.click(rows[1])
    fireEvent.click(rows[1])
    fireEvent.click(rows[0])
    fireEvent.click(rows[2])
    expect(scoreValue()).toBe('10')
    expect(wrongValue()).toBe('0')
  })

  it('two clicks dispatched inside ONE React batch score once, not twice', async () => {
    // The case `picked !== null` cannot catch: inside one batch both handlers
    // run before React commits, so both read `picked === null`.
    //
    // Measured against the pre-extraction component, BOTH versions were wrong
    // here and neither was protection:
    //
    //   • before — functional updates (`setScore(s => s + gained)`,
    //     `setCorrect(c => c + 1)`), so both clicks APPLIED: one question
    //     landed as `correct: 1` AND `wrong: 1`, score 8;
    //   • after the extraction alone — the reducer reads the render's value, so
    //     the second write REPLACED the first and the correct answer vanished,
    //     score 0.
    //
    // Fixed properly rather than pinned: `pick()` now claims a synchronous ref
    // before touching state, so the second call is refused outright. First
    // answer wins, exactly as a learner would expect, and the question is
    // counted once.
    mountGame()
    startRound()
    const rows = options()
    act(() => {
      rows[1].click()
      rows[2].click()
    })
    expect(scoreValue()).toBe('10')
    expect(wrongValue()).toBe('0')
  })

  it('the synchronous guard releases for the NEXT question', async () => {
    // The other half of a lock: one that is never released turns the round into
    // a single-question game. The reveal beat is what advances the deck.
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    advancePastReveal()
    fireEvent.click(options()[2])
    expect(scoreValue()).toBe('20')
  })

  it('and it releases for a fresh round, not just a fresh question', async () => {
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    await runOutTheClock()
    fireEvent.click(screen.getByRole('button', { name: /play again/i }))
    fireEvent.click(options()[1])
    expect(scoreValue()).toBe('10')
  })

  // ── 2. the clock expiring on the final answer ──────────────────────────────

  it('an answer given just before the buzzer is counted in the saved round', async () => {
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    advancePastReveal()
    fireEvent.click(options()[2])
    await runOutTheClock()
    expect(saveScore).toHaveBeenCalledTimes(1)
    expect(saveScore.mock.calls[0][0]).toMatchObject({ score: 20, correct: 2, wrong: 0 })
  })

  it('the clock expiring with a reveal still on screen saves that answer too', async () => {
    // The tightest version: the buzzer lands while the last answer is still in
    // its 700ms reveal beat, so `finish()` runs without the deck having
    // advanced. Both the old five-state read and the one-value read take the
    // same render's numbers, so this was and is counted.
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    await runOutTheClock()
    expect(saveScore.mock.calls[0][0]).toMatchObject({ score: 10, correct: 1 })
  })

  // ── 3. unanswered questions ────────────────────────────────────────────────

  it('unanswered questions are not penalised — only answers count', async () => {
    // A timed round always ends with questions unseen. They must not enter
    // `wrong`, and they must not enter the accuracy denominator: this is a
    // sprint, not a paper, and there is no per-question penalty for running out
    // of clock.
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    await runOutTheClock()
    const saved = saveScore.mock.calls[0][0]
    expect(saved.wrong).toBe(0)
    expect(saved.correct).toBe(1)
    expect(saved.accuracy).toBe(100)
  })

  it('a round with no answers at all saves zeroes, not NaN', async () => {
    mountGame()
    startRound()
    await runOutTheClock()
    const saved = saveScore.mock.calls[0][0]
    expect(saved).toMatchObject({ score: 0, correct: 0, wrong: 0, accuracy: 0 })
    expect(Number.isFinite(saved.accuracy)).toBe(true)
  })

  // ── 4. rounding, and the penalty floor ─────────────────────────────────────

  it('accuracy rounds the way it always did — 2 of 3 is 67%', async () => {
    // `Math.round(66.66…)`. A change to `Math.floor` here would move every
    // learner's accuracy by a point and shift the badge thresholds with it.
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    advancePastReveal()
    fireEvent.click(options()[2])
    advancePastReveal()
    fireEvent.click(options()[1])
    await runOutTheClock()
    const saved = saveScore.mock.calls[0][0]
    expect(saved).toMatchObject({ correct: 2, wrong: 1, accuracy: 67 })
    // 10 + 10 − 2. `wrongPenalty(10)` is `max(2, floor(10/4))`.
    expect(saved.score).toBe(18)
  })

  it('the score floors at zero rather than going negative', async () => {
    mountGame()
    startRound()
    fireEvent.click(options()[0])
    advancePastReveal()
    fireEvent.click(options()[0])
    await runOutTheClock()
    expect(saveScore.mock.calls[0][0]).toMatchObject({ score: 0, wrong: 2, accuracy: 0 })
  })

  it('timeSpent is whole seconds, rounded', async () => {
    mountGame()
    startRound()
    await runOutTheClock()
    const { timeSpent } = saveScore.mock.calls[0][0]
    expect(Number.isInteger(timeSpent)).toBe(true)
    expect(timeSpent).toBeGreaterThan(0)
  })

  // ── 5. completion fires exactly once ───────────────────────────────────────

  it('the buzzer saves the round exactly once', async () => {
    // The countdown effect re-runs every tick; only the `timeLeft <= 0` tick may
    // finish, and `phase !== 'playing'` closes the door behind it.
    mountGame()
    startRound()
    await runOutTheClock()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(saveScore).toHaveBeenCalledTimes(1)
  })

  it('ending early saves once, and the expiring clock does not save again', async () => {
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    fireEvent.click(screen.getByRole('button', { name: /end round early/i }))
    await flushFinish()
    await runOutTheClock()
    expect(saveScore).toHaveBeenCalledTimes(1)
    expect(saveScore.mock.calls[0][0]).toMatchObject({ score: 10, correct: 1 })
  })

  it('a fresh round starts from zero and saves its own numbers', async () => {
    // "Play again" goes from `done` straight back to `playing`. A reducer that
    // failed to reset would carry the first round's score into the second — and
    // into the leaderboard.
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    await runOutTheClock()
    expect(saveScore.mock.calls[0][0]).toMatchObject({ score: 10 })

    fireEvent.click(screen.getByRole('button', { name: /play again/i }))
    expect(scoreValue()).toBe('0')
    expect(wrongValue()).toBe('0')
    fireEvent.click(options()[0])
    await runOutTheClock()
    expect(saveScore).toHaveBeenCalledTimes(2)
    expect(saveScore.mock.calls[1][0]).toMatchObject({ score: 0, correct: 0, wrong: 1 })
  })

  it('the round the leaderboard gets is the round the screen showed', async () => {
    // The end-to-end version of all of the above: whatever the score pill said
    // at the buzzer is what reaches `scores`.
    mountGame()
    startRound()
    fireEvent.click(options()[1])
    advancePastReveal()
    fireEvent.click(options()[2])
    const onScreen = scoreValue()
    await runOutTheClock()
    expect(String(saveScore.mock.calls[0][0].score)).toBe(onScreen)
  })
})
