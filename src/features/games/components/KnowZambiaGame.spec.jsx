/**
 * Behaviour tests for the Know Zambia map engine (`type: 'map_place'`).
 *
 * The rules under test are the ones the prototype argued for, and each of
 * them is invisible to a render test that only checks the map appears:
 *
 *   Tap a name, then tap the province — and tapping the map with no name
 *   chosen says so instead of scoring a miss.
 *   A wrong tap NAMES WHAT WAS TAPPED and then gives the positional hint
 *   for what was being placed, keeps the name selected, and takes nothing
 *   away.
 *   A placed province keeps its name on the map into the next round, as a
 *   grey anchor — that is what the next hint points at.
 *   The round grows 3 → 5 → 10 and ends by finishing the work, not on a
 *   clock, so the saved `timeSpent` is measured rather than a round length.
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

import KnowZambiaGame from './KnowZambiaGame'
import { saveScore, reportGameStart } from '../services/gamesService'
import { DEFAULT_WAVES } from '../lib/knowZambiaCore'

const GAME = { id: 'social_know_zambia_g7', title: 'Know Zambia', type: 'map_place', grade: 7, points: 15 }

const draw = () => render(<MemoryRouter><KnowZambiaGame game={GAME} /></MemoryRouter>)
const nameChip = (name) => screen.getByRole('button', { name: new RegExp(`^✓?\\s*${name}$`) })
const province = (name) => screen.getByRole('button', { name: new RegExp(`^${name} Province`) })

/** Place one province the way a learner does: tap the name, tap the map. */
function place(name) {
  fireEvent.click(nameChip(name))
  fireEvent.click(province(name))
}

beforeEach(() => { vi.clearAllMocks() })

describe('KnowZambiaGame', () => {
  it('opens on the first wave of three, with the whole map tappable', () => {
    draw()
    expect(reportGameStart).toHaveBeenCalledWith(GAME)
    expect(screen.getByText(/TAP A NAME, THEN TAP WHERE IT GOES/i)).toBeInTheDocument()
    for (const code of DEFAULT_WAVES[0]) expect(code).toBeTruthy()
    expect(nameChip('Lusaka')).toBeInTheDocument()
    expect(nameChip('Copperbelt')).toBeInTheDocument()
    expect(nameChip('Western')).toBeInTheDocument()
    // Round 2's names are not offered yet.
    expect(screen.queryByRole('button', { name: /^Southern$/ })).not.toBeInTheDocument()
    // Every province is on the map from the start — the ten are the board.
    expect(province('Muchinga')).toBeInTheDocument()
  })

  it('asks for a name before it accepts a tap on the map', () => {
    draw()
    fireEvent.click(province('Lusaka'))
    expect(screen.getByText('Pick a name first')).toBeInTheDocument()
  })

  it('names what was tapped, then gives the hint for what was being placed', () => {
    draw()
    fireEvent.click(nameChip('Lusaka'))
    fireEvent.click(province('Western'))

    expect(screen.getByText('That one is Western')).toBeInTheDocument()
    expect(screen.getByText(/Lusaka is the small one in the middle-south/)).toBeInTheDocument()
    // Nothing is taken away, and the name stays chosen so a retry is one tap.
    expect(nameChip('Lusaka')).toHaveAttribute('aria-pressed', 'true')
    expect(nameChip('Lusaka')).not.toBeDisabled()
  })

  it('a correct placement locks the name, marks the province and teaches a fact', () => {
    draw()
    place('Lusaka')
    expect(screen.getByText('Lusaka — correct')).toBeInTheDocument()
    expect(screen.getByText(/smallest province by area/i)).toBeInTheDocument()
    expect(nameChip('Lusaka')).toBeDisabled()
    expect(province('Lusaka')).toHaveAttribute('aria-label', expect.stringContaining('placed'))
  })

  it('grows 3 → 5 → 10, keeping placed provinces on the map as named anchors', async () => {
    vi.useFakeTimers()
    try {
      draw()
      for (const name of ['Lusaka', 'Copperbelt', 'Western']) place(name)
      await act(async () => { vi.advanceTimersByTime(1000) })

      // Round 2 is the two more, and the first three are anchors now.
      expect(screen.getByText(/Round 2 of 3/)).toBeInTheDocument()
      expect(nameChip('Southern')).toBeInTheDocument()
      expect(nameChip('Northern')).toBeInTheDocument()
      expect(screen.getByText(/Still on the map: Lusaka, Copperbelt, Western/)).toBeInTheDocument()
      expect(province('Lusaka')).toHaveAttribute('aria-label', expect.stringContaining('placed'))

      for (const name of ['Southern', 'Northern']) place(name)
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(screen.getByText(/Round 3 of 3/)).toBeInTheDocument()
      expect(nameChip('North-Western')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends by finishing the work — not on a clock — and saves the round', async () => {
    vi.useFakeTimers()
    try {
      draw()
      const names = {
        lu: 'Lusaka', cb: 'Copperbelt', we: 'Western', so: 'Southern', no: 'Northern',
        ce: 'Central', ea: 'Eastern', lp: 'Luapula', mu: 'Muchinga', nw: 'North-Western',
      }
      for (const wave of DEFAULT_WAVES) {
        for (const code of wave) place(names[code])
        await act(async () => { vi.advanceTimersByTime(1000) })
      }

      expect(screen.getByText('You know Zambia!')).toBeInTheDocument()
      expect(screen.getByText(/placed 10 of the ten provinces/i)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      const saved = saveScore.mock.calls[0][0]
      // Ten placements, each 20 × a combo that climbs from 1.
      expect(saved.score).toBe(20 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10))
      expect(saved.correct).toBe(10)
    } finally {
      vi.useRealTimers()
    }
  })
})
