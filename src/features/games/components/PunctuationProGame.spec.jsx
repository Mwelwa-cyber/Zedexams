/**
 * Behaviour tests for the prototype-v3 Punctuation Pro engine (learner
 * redesign step 4): the round starts on mount with the game doc's own
 * items (shuffled options), tapping the correct sentence locks it
 * green for 20 × combo and deals the next, a wrong tap shakes and
 * resets the combo with the item staying live, and the countdown
 * ending lands on the shared win screen with the round saved through
 * the KEPT backend plumbing (saveScore via useGameFinish).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

import PunctuationProGame from './PunctuationProGame'
import { saveScore, reportGameStart } from '../services/gamesService'
import { ROUND_SECONDS } from '../lib/punctuationCore'

// One item, so the on-screen sentences are known and the recycle runs.
const GAME = {
  id: 'english_punctuation_g4',
  title: 'Punctuation Pro',
  type: 'punctuation',
  grade: 4,
  subject: 'english',
  questions: [
    { question: '', options: ['Watch out!', 'Watch out.', 'watch out!'], answer: 'Watch out!' },
  ],
}

function renderGame() {
  return render(
    <MemoryRouter>
      <PunctuationProGame game={GAME} />
    </MemoryRouter>,
  )
}

const opts = () => [...document.querySelectorAll('.lhx-pn-opt')]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PunctuationProGame', () => {
  it('starts on mount: the item deals all its sentence versions, the funnel reported', () => {
    renderGame()
    expect(reportGameStart).toHaveBeenCalledWith(GAME)
    expect(screen.getByText('TAP THE CORRECTLY PUNCTUATED SENTENCE')).toBeInTheDocument()
    expect(opts().map((o) => o.textContent).sort()).toEqual(['Watch out!', 'Watch out.', 'watch out!'])
  })

  it('the correct pick pays 20, locks green, and deals the next item', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      fireEvent.click(screen.getByRole('button', { name: 'Watch out!' }))
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Watch out!' }).className).toContain('is-ok')
      // Once locked, further taps on the wrong options score nothing.
      fireEvent.click(screen.getByRole('button', { name: 'Watch out.' }))
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
      // 500ms later the (recycled) next item deals, unlocked.
      await act(async () => { vi.advanceTimersByTime(550) })
      expect(opts().every((o) => !o.className.includes('is-ok'))).toBe(true)
      expect(screen.getByText(/1 correct · combo ×2/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a wrong pick shakes, resets the combo, and the item stays live for a retry', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      fireEvent.click(screen.getByRole('button', { name: 'watch out!' }))
      expect(screen.getByText('⭐ 0')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'watch out!' }).className).toContain('is-no')
      await act(async () => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('button', { name: 'watch out!' }).className).not.toContain('is-no')
      // The recovery on the SAME item still scores at the restarted ×1 combo.
      fireEvent.click(screen.getByRole('button', { name: 'Watch out!' }))
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the countdown ending lands on the win screen and saves the round through the kept backend', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      fireEvent.click(screen.getByRole('button', { name: 'Watch out!' }))
      await act(async () => { vi.advanceTimersByTime(600) })
      await act(async () => { vi.advanceTimersByTime(ROUND_SECONDS * 1000) })
      expect(screen.getByText('Punctuation Pro done!')).toBeInTheDocument()
      expect(screen.getByText(/You punctuated 1 sentence correctly/)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0]).toMatchObject({
        game: GAME, score: 20, correct: 1, wrong: 0, bestStreak: 1, timeSpent: ROUND_SECONDS,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
