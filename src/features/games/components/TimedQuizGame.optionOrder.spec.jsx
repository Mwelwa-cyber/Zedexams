/**
 * The option DEAL — the correct answer must not always render at slot A.
 *
 * The game banks (gamesSeed.js) list the correct answer as the FIRST option
 * on most questions, and the card used to render options in stored order —
 * so a learner could clear every round by tapping A without reading. The
 * card now draws options in a seeded per-question order
 * (`optionDisplayOrder`) and translates every index that leaves it back to
 * the stored option index.
 *
 * The recorded arithmetic specs (TimedQuizGame.legacy.spec.jsx /
 * .engine.spec.jsx) pin that helper to identity, because their picks were
 * recorded by position. This file runs the REAL deal and clicks by TEXT, so
 * it fails if the display-to-stored translation ever desyncs: clicking the
 * button that SHOWS the correct answer must score, wherever the deal put it.
 * (That the deal actually permutes is pinned in scripts/test-timed-quiz.mjs,
 * where the seed is controlled.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let engineOn = false
vi.mock('../../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => ({
    engine: engineOn, resolved: true, final: true, live: true, latched: false,
    runner: 'game', source: 'test',
  }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Chanda' } }),
}))
vi.mock('../services/gamesService', () => ({
  shuffle: (arr) => arr.slice(),
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
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
vi.mock('./SmartFeedback', () => ({ default: () => null }))

import TimedQuizGame from './TimedQuizGame'

// The seed-bank shape this exists for: the correct answer stored FIRST.
const GAME = Object.freeze({
  id: 'game-1',
  title: 'Grammar & Meaning',
  description: 'Answer as many as you can.',
  subject: 'english',
  grade: 7,
  type: 'timed_quiz',
  timer: 10,
  points: 10,
  questions: [
    { question: 'Pick the right spelling', options: ['necessary', 'neccessary', 'necesary'], answer: 'necessary' },
    { question: 'Synonym of enormous', options: ['huge', 'tiny', 'brief'], answer: 'huge' },
    { question: 'Opposite of scarce', options: ['plentiful', 'rare', 'costly'], answer: 'plentiful' },
  ],
})

function mountGame() {
  return render(<MemoryRouter><TimedQuizGame game={GAME} /></MemoryRouter>)
}
const startRound = () => fireEvent.click(screen.getByRole('button', { name: /start round/i }))
const scoreValue = () => screen.getByText('Score').parentElement.querySelector('.font-display').textContent
const optionButtonByText = (text) =>
  screen.getAllByRole('button').find((b) => b.textContent.includes(text))

beforeEach(() => {
  vi.clearAllMocks()
  engineOn = false
})

describe('TimedQuizGame — the option deal', () => {
  it('legacy path: clicking the option SHOWING the correct answer scores, wherever the deal put it', () => {
    mountGame()
    startRound()
    // All three options render, whatever their order…
    for (const text of GAME.questions[0].options) {
      expect(optionButtonByText(text)).toBeTruthy()
    }
    // …and the verdict follows the TEXT, not the slot.
    fireEvent.click(optionButtonByText('necessary'))
    expect(scoreValue()).toBe('10')
  })

  it('legacy path: clicking a wrong option is still wrong after the deal', () => {
    mountGame()
    startRound()
    fireEvent.click(optionButtonByText('neccessary'))
    expect(scoreValue()).toBe('0')
    expect(screen.getByText('Wrong').parentElement.querySelector('.font-display').textContent).toBe('1')
  })

  it('engine path: the permuted view translates taps back to canonical indices', () => {
    engineOn = true
    mountGame()
    startRound()
    // Prove the ENGINE card is the one on screen — were the engine mount to
    // fall back to the legacy card, this test would pass without exercising
    // the ChoiceQuestion translation at all.
    expect(document.querySelector('.opt-grid')).not.toBeNull()
    fireEvent.click(optionButtonByText('necessary'))
    expect(scoreValue()).toBe('10')
  })
})
