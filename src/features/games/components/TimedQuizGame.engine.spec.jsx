/**
 * The games cutover: the flag selects the choice card and the verdict, and
 * nothing else.
 *
 * §5.1(6) of `docs/phase3-plan.md` — before a flip, a Vitest spec renders the
 * engine's version of the runner and asserts the §2 layout requirements. This
 * is that spec, plus the claims specific to the write-heaviest runner in the
 * phase:
 *
 *   • flag ON  → the ENGINE card serves: one vertical column of `.zx-opt` rows
 *     with letters that do not stop at D (D4), no verdict before the answer;
 *   • flag OFF → the game's own two-column card serves, unchanged;
 *   • the verdict comes from the engine's marking seam, proved by a wrong
 *     answer scoring the penalty rather than the points — a card swap that
 *     left the old comparison in place would pass every layout assertion;
 *   • a game the normaliser refuses is served ENTIRELY by the old card;
 *   • the rollback is not latched: flipping the flag off mid-round moves the
 *     learner back at once, because they are the population it is for.
 *
 * The cards are told apart by the engine's own class vocabulary (`.opt-grid`,
 * `.zx-opt`) rather than by appearance, because a control that could not
 * distinguish them would pass with the flag ignored — the one regression this
 * file exists to catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const flagState = {
  engine: true, resolved: true, final: true, live: true, latched: false,
  runner: 'game', source: 'rollout-all',
}

vi.mock('../../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => flagState,
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Chanda' } }),
}))
vi.mock('../services/gamesService', () => ({
  // Identity shuffle: the deck is then the pool in order, so a test knows which
  // question is on screen. Every other games behaviour under test is downstream
  // of the verdict, which the deck order does not touch.
  shuffle: (arr) => arr.slice(),
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
  // start() reports the round for the game_started/game_completed pair. Mocked
  // here because this factory REPLACES the module: a missing export is
  // undefined, and calling it throws inside start(), which unmounts the game
  // and surfaces as "container is null" rather than as a missing mock.
  reportGameStart: vi.fn(),
  readRoundBaseline: vi.fn(async () => ({})),
  readRoundOutcome: vi.fn(async () => ({ levelChange: null, personalBest: null })),
}))
vi.mock('../../../utils/gameBadgesService', () => ({
  evaluateAndAwardGameBadges: vi.fn(async () => ({ newlyEarned: [] })),
}))
vi.mock('../../../utils/dailyChallengeService', () => ({
  getTodaysChallenge: vi.fn(async () => ({ game: null })),
  recordDailyPlay: vi.fn(async () => ({ isDaily: false })),
}))
vi.mock('../lib/gameSounds', () => ({
  playCorrect: vi.fn(), playWrong: vi.fn(), playWin: vi.fn(),
  playStreak: vi.fn(), primeSounds: vi.fn(),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('./Leaderboard', () => ({ default: () => null }))
// Reaches the Firebase client at import time (via `gamesIntelligence`), which
// refuses to initialise in jsdom without a config. It draws the end-of-round
// coaching note and has nothing to do with the card or the verdict.
vi.mock('./SmartFeedback', () => ({ default: () => null }))

import TimedQuizGame from './TimedQuizGame'
import { capture } from '../../../utils/analytics'

/**
 * FIVE options on purpose: the D4 defect was `['A','B','C','D'][i]` yielding
 * undefined past D, and §2 requires letters from a rule that does not stop at
 * four. `timedQuizCore.optionLetter` already reaches E, so this asserts the
 * engine's shared `optionLabel` does too rather than regressing to the array.
 */
const GAME = Object.freeze({
  id: 'game-1',
  title: 'Times Tables Sprint',
  description: 'Answer as many as you can.',
  subject: 'mathematics',
  grade: 4,
  type: 'timed_quiz',
  timer: 60,
  points: 10,
  questions: [
    { question: '6 x 7', options: ['36', '40', '42', '48', '54'], answer: '42' },
    { question: '8 x 4', options: ['24', '28', '32', '36', '40'], answer: '32' },
  ],
})

const gameWith = (overrides) => ({ ...GAME, ...overrides })

function mountGame(game = GAME) {
  return render(
    <MemoryRouter>
      <TimedQuizGame game={game} />
    </MemoryRouter>,
  )
}

/** Start the round — every assertion below is about the playing card. */
function startRound() {
  fireEvent.click(screen.getByRole('button', { name: /start round/i }))
}

const engineCard = () => document.querySelector('.opt-grid')
const oldCard = () => document.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2')
const scoreValue = () => screen.getByText('Score').parentElement.querySelector('.font-display').textContent

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(flagState, {
    engine: true, resolved: true, final: true, live: true, latched: false,
    runner: 'game', source: 'rollout-all',
  })
})

describe('TimedQuizGame — Assessment Engine cutover', () => {
  it('serves the ENGINE card when the flag is on', () => {
    mountGame()
    startRound()
    expect(engineCard()).not.toBeNull()
    expect(oldCard()).toBeNull()
  })

  it('serves the OLD card when the flag is off', () => {
    flagState.engine = false
    mountGame()
    startRound()
    expect(engineCard()).toBeNull()
    expect(oldCard()).not.toBeNull()
  })

  it('does not decide until the flag has resolved', () => {
    // The hook's contract: acting on the provisional answer would swap the card
    // out from under a learner who has already answered.
    flagState.resolved = false
    mountGame()
    startRound()
    expect(engineCard()).toBeNull()
  })

  it('draws ONE vertical column of rows with letters past D', () => {
    mountGame()
    startRound()
    const rows = within(engineCard()).getAllByRole('button')
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.querySelector('.zx-opt-letter').textContent))
      .toEqual(['A', 'B', 'C', 'D', 'E'])
    // §4's layout contract lives in `.opt-grid`'s single-column CSS. The
    // assertion that matters here is that the game's two-column grid is NOT
    // what wraps them.
    expect(engineCard().className).toContain('opt-grid')
    expect(rows.every((r) => r.className.includes('zx-opt'))).toBe(true)
  })

  it('shows no verdict before the learner answers', () => {
    mountGame()
    startRound()
    expect(within(engineCard()).queryByLabelText('Correct')).toBeNull()
    expect(within(engineCard()).queryByLabelText('Incorrect')).toBeNull()
  })

  it('takes the verdict from the engine — a correct answer scores the points', () => {
    mountGame()
    startRound()
    // '42' is at index 2; the stored answer is the VALUE '42', which only the
    // normaliser's resolution turns into a position.
    fireEvent.click(within(engineCard()).getAllByRole('button')[2])
    expect(within(engineCard()).getByLabelText('Correct')).toBeTruthy()
    expect(scoreValue()).toBe('10')
  })

  it('and a wrong answer takes the penalty, not the points', () => {
    // This is the assertion that would still pass if the card were swapped but
    // the verdict left behind: the layout is identical either way, the score is
    // not. `wrongPenalty(10)` is 2, floored at 0 from a score of 0.
    mountGame()
    startRound()
    fireEvent.click(within(engineCard()).getAllByRole('button')[0])
    expect(within(engineCard()).getByLabelText('Incorrect')).toBeTruthy()
    // Re-queried, not reused: a wrong answer flips the card's `key` to drive
    // the shake animation, which remounts the rows and detaches the nodes read
    // before the click.
    const revealed = within(engineCard()).getAllByRole('button')
    // The correct row is still revealed as the answer, exactly as the old card
    // did — a learner who got it wrong is shown what was right.
    expect(revealed[2].getAttribute('data-correct')).toBe('true')
    expect(scoreValue()).toBe('0')
  })

  it('refuses a game whose stored answer matches no option, and serves the old card', () => {
    // `fromGame` reports this honestly as `correctIndex: null`. The old card is
    // no better at it — but refusing keeps every report about the new card
    // attributable to the new card.
    mountGame(gameWith({
      questions: [{ question: '6 x 7', options: ['36', '40', '48'], answer: '42' }],
    }))
    startRound()
    expect(engineCard()).toBeNull()
    expect(oldCard()).not.toBeNull()
  })

  it('non-text options reach NEITHER card — the engine refusal is a tripwire, not a rescue', () => {
    // The refusal in `TimedQuizGame` exists for a games schema that grows
    // picture options: `String({…})` is '[object Object]', so the engine would
    // draw rows that look answerable and are not. What it does NOT do is
    // rescue such a document — the old card renders `{opt}` directly and React
    // refuses an object child, which is why no `timed_quiz` game has one today.
    //
    // Asserted rather than left as a claim in a comment, because the value of
    // the refusal depends on this: if the fallback worked, refusing would be a
    // fix; since it does not, refusing is what makes the engine fail in the
    // same visible place instead of silently drawing five dead rows.
    const withObjectOptions = gameWith({
      questions: [{
        question: 'Which shape is a triangle?',
        options: [{ imageUrl: 'a.png' }, { imageUrl: 'b.png' }],
        answer: 'a.png',
      }],
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => {
        mountGame(withObjectOptions)
        startRound()
      }).toThrow(/not valid as a React child/)
    } finally {
      errors.mockRestore()
    }
  })

  it('reports which card actually served, once per round', () => {
    mountGame()
    startRound()
    const events = capture.mock.calls.filter(([name]) => name === 'assessment_engine_path')
    expect(events).toHaveLength(1)
    expect(events[0][1]).toMatchObject({
      runner: 'game', engine: true, flagSource: 'rollout-all', live: true, latched: false,
    })
  })

  it('reports again for the NEXT round, not once per mount', () => {
    // "Play again" re-decides the latch, so a report keyed to the mount would
    // attribute a whole sitting to the first round's card — and under a ramp
    // that lands mid-sitting, to the wrong one.
    mountGame()
    startRound()
    fireEvent.click(screen.getByRole('button', { name: /end round early/i }))
    fireEvent.click(screen.getByRole('button', { name: /play again/i }))
    expect(capture.mock.calls.filter(([name]) => name === 'assessment_engine_path')).toHaveLength(2)
  })

  it('reports engine:false when the flag said yes but normalisation refused', () => {
    // `engine` records what the LEARNER met, not what the flag said — otherwise
    // the refusal rate, which is the input to the ramp decision, reads as the
    // flag's coverage.
    mountGame(gameWith({
      questions: [{ question: '6 x 7', options: ['36', '40'], answer: '42' }],
    }))
    startRound()
    const [, props] = capture.mock.calls.find(([name]) => name === 'assessment_engine_path')
    expect(props.engine).toBe(false)
  })

  it('applies a ROLLBACK mid-round rather than latching it', () => {
    // §4.2.2 and flags.js's own rule: a ramp-up never moves a learner
    // mid-question, a rollback always does — a latch that spared the learners
    // already on the engine would leave the failure running for exactly the
    // population the rollback is for.
    const { rerender } = mountGame()
    startRound()
    expect(engineCard()).not.toBeNull()
    flagState.engine = false
    rerender(<MemoryRouter><TimedQuizGame game={GAME} /></MemoryRouter>)
    expect(engineCard()).toBeNull()
    expect(oldCard()).not.toBeNull()
  })

  it('holds an UPGRADE that lands mid-round until the next round', () => {
    // The other half of the asymmetry: an answer held in one card's state does
    // not survive into the other's, so a round that began on the old card
    // finishes there. "Play again" re-decides, which is why the latch is keyed
    // on the round rather than on the ready card.
    flagState.engine = false
    const { rerender } = mountGame()
    startRound()
    expect(oldCard()).not.toBeNull()
    flagState.engine = true
    rerender(<MemoryRouter><TimedQuizGame game={GAME} /></MemoryRouter>)
    expect(engineCard()).toBeNull()
    expect(oldCard()).not.toBeNull()
  })
})
