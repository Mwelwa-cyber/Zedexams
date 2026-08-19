/**
 * One finished round writes one score — audit H-01.
 *
 * `saveScore` is an `addDoc`: it mints a fresh document per call, so unlike an
 * id-keyed write it cannot converge if it runs twice. The only thing standing
 * between a round and a second write was `setPhase('done')` at the top of
 * `finish()`, and that is React state — applied on the NEXT render. A second
 * call arriving inside the same frame (the "End" button double-tapped before
 * it unmounts) passes straight through it.
 *
 * Two rows for one round inflate the public leaderboard, the windowed level
 * total and the personal-best comparison, and `scores` is append-only for
 * learners in `firestore.rules`, so nothing the learner does removes the
 * duplicate.
 *
 * These tests drive the hook directly rather than a game engine, because the
 * defect is in the shared plumbing every engine calls and pinning it against
 * one engine's UI would leave the other seven unproven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { uid: 'learner-1', role: 'learner', grade: 7 } }),
}))
vi.mock('../services/gamesService', () => ({
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
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

import { useGameFinish } from './useGameFinish'
import { saveScore } from '../services/gamesService'

const ROUND = {
  game: { id: 'game-1', type: 'timed_quiz', grade: 7, subject: 'Mathematics' },
  score: 120,
  correct: 8,
  wrong: 2,
  accuracy: 80,
  bestStreak: 5,
  timeSpent: 64,
}

/** Renders the hook and hands its API back through a mutable box. */
function mountHook() {
  const api = {}
  function Probe() {
    Object.assign(api, useGameFinish())
    return null
  }
  render(<Probe />)
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGameFinish — one round, one score', () => {
  it('writes one score when finish() is called twice in the same tick', async () => {
    const api = mountHook()

    // Both calls are made before either can settle and before React can
    // re-render — the double-tap, reproduced. Awaited together so the test
    // does not accidentally serialise what the bug needs to overlap.
    await act(async () => {
      await Promise.all([api.finish(ROUND), api.finish(ROUND)])
    })

    expect(saveScore).toHaveBeenCalledTimes(1)
  })

  it('writes one score when the second call lands mid-flight', async () => {
    // The slow-network shape: the first save is still in the air when the
    // learner taps again. `setPhase('done')` may well have rendered by now,
    // which is exactly why the guard cannot be state the caller reads.
    let release
    saveScore.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, id: 'score-1' })
    }))

    const api = mountHook()
    let first
    await act(async () => {
      first = api.finish(ROUND)
      await Promise.resolve()
    })
    await act(async () => {
      await api.finish(ROUND)
      release()
      await first
    })

    expect(saveScore).toHaveBeenCalledTimes(1)
  })

  it('still writes a score for a normal single finish', async () => {
    const api = mountHook()
    await act(async () => { await api.finish(ROUND) })

    expect(saveScore).toHaveBeenCalledTimes(1)
    expect(saveScore).toHaveBeenCalledWith(expect.objectContaining({
      game: ROUND.game,
      score: 120,
      correct: 8,
      wrong: 2,
      accuracy: 80,
      bestStreak: 5,
      timeSpent: 64,
    }))
  })

  it('lets the NEXT round save after reset()', async () => {
    // "Play again" re-enters without remounting the hook, so a guard that was
    // never released would silently stop every subsequent round from scoring —
    // a worse bug than the one being fixed, and the reason reset() clears it.
    const api = mountHook()

    await act(async () => { await api.finish(ROUND) })
    await act(async () => { api.reset() })
    await act(async () => { await api.finish(ROUND) })

    expect(saveScore).toHaveBeenCalledTimes(2)
  })
})
