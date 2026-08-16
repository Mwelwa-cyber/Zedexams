/**
 * Behaviour tests for the prototype-v3 Meaning Match engine (learner
 * redesign step 4): the round starts on mount with the game doc's own
 * pairs (words left, meanings shuffled right and never self-solving),
 * tap word → tap meaning locks a match for 20 × combo, a wrong pairing
 * shakes and resets the combo, a cleared board deals the next, and the
 * countdown ending lands on the shared win screen with the round saved
 * through the KEPT backend plumbing (saveScore via useGameFinish).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Chanda' } }),
}))
vi.mock('../services/gamesService', () => ({
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
  playCorrect: vi.fn(),
  playWrong: vi.fn(),
  playWin: vi.fn(),
  primeSounds: vi.fn(),
}))

import MeaningMatchGame from './MeaningMatchGame'
import { saveScore, reportGameStart } from '../services/gamesService'
import { ROUND_SECONDS } from '../lib/meaningMatchCore'

// Two pairs → two-chip boards, so a test can name what is on screen.
const GAME = {
  id: 'math_memory_g6',
  title: 'Fraction Match',
  type: 'memory_match',
  grade: 6,
  subject: 'mathematics',
  questions: [
    { question: '1/2', answer: '50%' },
    { question: '1/4', answer: '25%' },
  ],
}

function renderGame() {
  return render(
    <MemoryRouter>
      <MeaningMatchGame game={GAME} />
    </MemoryRouter>,
  )
}

const wordsCol = () => screen.getByLabelText('Words')
const meaningsCol = () => screen.getByLabelText('Meanings')

function matchPair(word, meaning) {
  fireEvent.click(within(wordsCol()).getByRole('button', { name: word }))
  fireEvent.click(within(meaningsCol()).getByRole('button', { name: meaning }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MeaningMatchGame', () => {
  it('starts on mount: words left, meanings right, the funnel reported', () => {
    renderGame()
    expect(reportGameStart).toHaveBeenCalledWith(GAME)
    expect(screen.getByText('MATCH THE WORD TO ITS MEANING')).toBeInTheDocument()
    expect(within(wordsCol()).getAllByRole('button').map((b) => b.textContent).sort()).toEqual(['1/2', '1/4'])
    expect(within(meaningsCol()).getAllByRole('button').map((b) => b.textContent).sort()).toEqual(['25%', '50%'])
  })

  it('a correct pairing pays 20, locks both chips, and a cleared board deals the next', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      matchPair('1/2', '50%')
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
      expect(within(wordsCol()).getByText('1/2').className).toContain('is-matched')
      // Second pair clears the board — combo ×2 pays 40 more.
      matchPair('1/4', '25%')
      expect(screen.getByText('⭐ 60')).toBeInTheDocument()
      expect(screen.getByText(/2 matched · combo ×3/)).toBeInTheDocument()
      // 500ms later a fresh board is dealt, chips unlocked.
      await act(async () => { vi.advanceTimersByTime(550) })
      expect(within(wordsCol()).getAllByRole('button').every((b) => !b.disabled)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a wrong pairing shakes both chips, resets the combo, and clears for a retry', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      matchPair('1/2', '25%')
      expect(screen.getByText('⭐ 0')).toBeInTheDocument()
      expect(within(wordsCol()).getByText('1/2').className).toContain('is-wrong')
      expect(within(meaningsCol()).getByText('25%').className).toContain('is-wrong')
      await act(async () => { vi.advanceTimersByTime(550) })
      expect(within(wordsCol()).getByText('1/2').className).not.toContain('is-wrong')
      // The recovery still scores, at the restarted ×1 combo.
      matchPair('1/2', '50%')
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the countdown ending lands on the win screen and saves the round through the kept backend', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      matchPair('1/2', '50%')
      matchPair('1/4', '25%')
      await act(async () => { vi.advanceTimersByTime(ROUND_SECONDS * 1000 + 600) })
      expect(screen.getByText('Meaning Match done!')).toBeInTheDocument()
      expect(screen.getByText(/You matched 2 pairs/)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0]).toMatchObject({
        game: GAME, score: 60, correct: 2, wrong: 0, bestStreak: 2, timeSpent: ROUND_SECONDS,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
