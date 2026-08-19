/**
 * Behaviour tests for the prototype-v3 Number Path engine (learner
 * redesign step 4): the level path gates entry to the current level,
 * the tap-to-sum round scores 20 × combo through the pure core,
 * hitting the level's fixed set of targets ends the round into the win
 * screen, and the finished round flows through the KEPT backend
 * plumbing (saveScore via useGameFinish) with the path progress
 * persisted per game id in localStorage.
 *
 * There is no countdown (PROMPT 7b). The level used to end after
 * 55 − 2·level seconds, which is difficulty by stopwatch: the top of
 * the path was harder because a child had less time to think, not
 * because the sums were harder. The "no clock" test pins the removal.
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
import { LEVEL_TARGETS } from '../lib/numberPathCore'

const GAME = { id: 'math_number_target_g4', title: 'Number Path', type: 'number_target', grade: 4, subject: 'mathematics' }

function renderGame() {
  return render(
    <MemoryRouter>
      <NumberTargetGame game={GAME} />
    </MemoryRouter>,
  )
}

/**
 * Solve whatever target is currently on the board.
 *
 * The target is by construction a sum of board tiles, but ANY subset that
 * sums to it scores — so find one by brute force over the 16 tiles. Tiles
 * are all positive and clicked in index order, so no partial sum can
 * overshoot on the way, which would bust the selection.
 */
function solveCurrentTarget() {
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
    expect(screen.getByText(/Target 1 of 8 · your best: 0/)).toBeInTheDocument()
  })

  it('✕ leaves the round back to the path without saving anything', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Start level 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave the round' }))
    expect(screen.getByText('LEVELS DONE')).toBeInTheDocument()
    expect(saveScore).not.toHaveBeenCalled()
  })

  it('no clock ever ends the level — a learner can stare at one board indefinitely', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      fireEvent.click(screen.getByRole('button', { name: 'Start level 1' }))
      // Ten minutes of arithmetic. Level 1 used to run 53 seconds, so this
      // round ended nine minutes ago; now nothing at all has happened.
      await act(async () => { vi.advanceTimersByTime(600_000) })
      expect(screen.queryByText('Level 1 complete!')).not.toBeInTheDocument()
      expect(saveScore).not.toHaveBeenCalled()
      // And the sum worked out after all that thinking still scores.
      solveCurrentTarget()
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hitting the level\'s targets scores 20 × combo, lands on the win screen and saves through the kept backend', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      fireEvent.click(screen.getByRole('button', { name: 'Start level 1' }))

      solveCurrentTarget()
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
      expect(screen.getByText('Nice! +20')).toBeInTheDocument()

      // The rest of the level's fixed set — each match replaces its tiles and
      // draws a fresh target 320ms later.
      for (let hit = 1; hit < LEVEL_TARGETS; hit += 1) {
        await act(async () => { vi.advanceTimersByTime(350) })
        solveCurrentTarget()
      }
      await act(async () => { vi.advanceTimersByTime(350) })

      expect(screen.getByText('Level 1 complete!')).toBeInTheDocument()
      const scoreCard = screen.getByText('SCORE').closest('.lhx-win-stat')
      // 20 × combo, combo climbing 1…8 across the set.
      expect(within(scoreCard).getByText('720')).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0]).toMatchObject({
        game: GAME, score: 720, correct: LEVEL_TARGETS, wrong: 0,
      })
      // timeSpent is MEASURED now, where it used to be the level's countdown
      // length. The clock stopped when the round ended — 320ms into the last
      // match's replace beat, not at the end of it. Nothing scores on it.
      const endedAtMs = (LEVEL_TARGETS - 1) * 350 + 320
      expect(saveScore.mock.calls[0][0].timeSpent).toBe(Math.round(endedAtMs / 1000))

      // Continue returns to the path with level 1 cleared and 2 unlocked…
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /CONTINUE/ }))
      })
      expect(screen.getByRole('button', { name: 'Level 1 done' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start level 2' })).toBeEnabled()
      // …and the progress survived into localStorage under the game id.
      const stored = JSON.parse(window.localStorage.getItem('zx:number-path:math_number_target_g4'))
      expect(stored.completed).toBe(1)
      expect(stored.best).toBe(720)
    } finally {
      vi.useRealTimers()
    }
  })
})
