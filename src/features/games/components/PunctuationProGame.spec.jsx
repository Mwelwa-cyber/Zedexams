/**
 * Behaviour tests for the prototype-v3 Punctuation Pro engine (learner
 * redesign step 4): the round starts on mount with the game doc's own
 * items (shuffled options), tapping the correct sentence locks it
 * green for 20 × combo and deals the next, a wrong tap shakes and
 * resets the combo with the item staying live, and finishing the fixed
 * set lands on the shared win screen with the round saved through the
 * KEPT backend plumbing (saveScore via useGameFinish).
 *
 * There is no countdown (PROMPT 7b), and the "no clock ever ends the
 * round" test is what pins it: ten minutes of fake time pass with the
 * round untouched. A clock creeping back in would have to survive that.
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
  isMuted: vi.fn(() => false),
  toggleMute: vi.fn(() => true),
}))

import PunctuationProGame from './PunctuationProGame'
import { saveScore, reportGameStart } from '../services/gamesService'
import { ROUND_ITEMS } from '../lib/punctuationCore'

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
      expect(screen.getByText(/Sentence 2 of 10 · combo ×2/)).toBeInTheDocument()
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

  it('no clock ever ends the round — a learner can sit on one sentence indefinitely', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      // Ten minutes reading the three versions. Under the old 60-second
      // countdown the round was over nine minutes ago; now nothing happens.
      await act(async () => { vi.advanceTimersByTime(600_000) })
      expect(screen.queryByText('Punctuation Pro done!')).not.toBeInTheDocument()
      expect(saveScore).not.toHaveBeenCalled()
      // And the answer given after all that thinking still scores.
      fireEvent.click(screen.getByRole('button', { name: 'Watch out!' }))
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('finishing the set lands on the win screen and saves the round through the kept backend', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      // One item in the doc, so the queue recycles the same sentence — which
      // is what lets the test name the button ROUND_ITEMS times.
      for (let i = 0; i < ROUND_ITEMS; i += 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Watch out!' }))
        await act(async () => { vi.advanceTimersByTime(550) })
      }
      expect(screen.getByText('Punctuation Pro done!')).toBeInTheDocument()
      expect(screen.getByText(/You punctuated 10 sentences correctly/)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0]).toMatchObject({
        // 20 × combo, combo climbing 1…10 across the set.
        game: GAME, score: 1100, correct: 10, wrong: 0, bestStreak: 10,
      })
      // MEASURED, not a fixed round length: the clock stopped when the round
      // ended — 500ms into the last item's reveal beat, not at the end of it.
      const endedAtMs = (ROUND_ITEMS - 1) * 550 + 500
      expect(saveScore.mock.calls[0][0].timeSpent).toBe(Math.round(endedAtMs / 1000))
    } finally {
      vi.useRealTimers()
    }
  })
})
