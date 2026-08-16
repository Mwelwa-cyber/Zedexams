/**
 * Behaviour tests for the prototype-v3 Number Path engine (learner
 * redesign step 4): the level path gates entry to the current level,
 * the tap-to-sum round scores 20 × combo through the pure core, the
 * countdown ends the round into the win screen, and the finished round
 * flows through the KEPT backend plumbing (saveScore via useGameFinish)
 * with the path progress persisted per game id in localStorage.
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

import NumberTargetGame from './NumberTargetGame'
import { saveScore, reportGameStart } from '../services/gamesService'
import { levelTimeMax } from '../lib/numberPathCore'

const GAME = { id: 'math_number_target_g4', title: 'Number Path', type: 'number_target', grade: 4, subject: 'mathematics' }

function renderGame() {
  return render(
    <MemoryRouter>
      <NumberTargetGame game={GAME} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('NumberTargetGame', () => {
  it('opens on the level path with only level 1 playable', () => {
    renderGame()
    expect(screen.getByText('LEVELS DONE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start level 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Level 2 locked/ })).toBeDisabled()
    expect(screen.getByText('START ▸')).toBeInTheDocument()
  })

  it('starting the current level opens the tap-to-sum board and reports the start', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Start level 1' }))
    expect(reportGameStart).toHaveBeenCalledWith(GAME)
    expect(screen.getByText('MAKE THIS NUMBER')).toBeInTheDocument()
    // 16 tiles + the ✕ control.
    expect(document.querySelectorAll('.lhx-nt-tile')).toHaveLength(16)
    expect(screen.getByText('Your best: 0')).toBeInTheDocument()
  })

  it('✕ leaves the round back to the path without saving anything', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Start level 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave the round' }))
    expect(screen.getByText('LEVELS DONE')).toBeInTheDocument()
    expect(saveScore).not.toHaveBeenCalled()
  })

  it('matching the target scores 20 and celebrates; the timer ending lands on the win screen and saves through the kept backend', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      fireEvent.click(screen.getByRole('button', { name: 'Start level 1' }))

      // Read the target and solve it from the rendered tiles: the target is
      // by construction a sum of board tiles, but any subset that sums to it
      // scores — find one by brute force over the 16 tiles.
      const target = Number(document.querySelector('.lhx-nt-goal-num').textContent)
      const tiles = [...document.querySelectorAll('.lhx-nt-tile')].map((el) => Number(el.textContent))
      let solution = null
      for (let mask = 1; mask < 1 << 16 && !solution; mask++) {
        let sum = 0
        for (let i = 0; i < 16; i++) if (mask & (1 << i)) sum += tiles[i]
        if (sum === target) {
          solution = []
          for (let i = 0; i < 16; i++) if (mask & (1 << i)) solution.push(i)
        }
      }
      expect(solution).not.toBeNull()

      const tileEls = document.querySelectorAll('.lhx-nt-tile')
      for (const i of solution) fireEvent.click(tileEls[i])
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
      expect(screen.getByText('Nice! +20')).toBeInTheDocument()

      // Run the whole countdown out (level 1 = 53s) plus the tile-replace tick.
      await act(async () => {
        vi.advanceTimersByTime((levelTimeMax(1) + 2) * 1000)
      })
      expect(screen.getByText('Level 1 complete!')).toBeInTheDocument()
      const scoreCard = screen.getByText('SCORE').closest('.lhx-win-stat')
      expect(within(scoreCard).getByText('20')).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0]).toMatchObject({ game: GAME, score: 20, correct: 1, wrong: 0 })

      // Continue returns to the path with level 1 cleared and 2 unlocked…
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /CONTINUE/ }))
      })
      expect(screen.getByRole('button', { name: 'Level 1 done' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start level 2' })).toBeEnabled()
      // …and the progress survived into localStorage under the game id.
      const stored = JSON.parse(window.localStorage.getItem('zx:number-path:math_number_target_g4'))
      expect(stored.completed).toBe(1)
      expect(stored.best).toBe(20)
    } finally {
      vi.useRealTimers()
    }
  })
})
