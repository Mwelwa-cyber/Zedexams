/**
 * Behaviour tests for the fraction ladder engine.
 *
 * The rules here are the ones a rendering test would happily pass while the
 * game taught the wrong thing:
 *
 *   Only level 1 opens on a fresh device, and a locked level SAYS WHAT OPENS
 *   IT rather than showing a padlock and nothing else.
 *   An equivalent fraction is accepted — 2/4 for 1/2 — with the line that
 *   says how it simplifies, which is the reason it is accepted.
 *   A wrong answer comes back with the misconception behind it.
 *   Passing writes the level to this device and opens the next one.
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
  playCorrect: vi.fn(), playWrong: vi.fn(), playWin: vi.fn(), primeSounds: vi.fn(),
  isMuted: vi.fn(() => false),
  toggleMute: vi.fn(() => true),
}))

import FractionLadderGame from './FractionLadderGame'
import { saveScore } from '../services/gamesService'

const GAME = {
  id: 'test_fraction_ladder',
  title: 'Fraction Ladder',
  type: 'fraction_ladder',
  grade: 7,
  questions: [
    {
      level: 'basics',
      question: 'Half of a bun. Write it.',
      answer: '1/2',
      value: { n: 1, d: 2 },
      traps: { '2/1': 'That is two wholes. The bottom holds how many pieces the bun was cut into.' },
    },
    { level: 'basics', question: 'Three quarters. Write it.', answer: '3/4', value: { n: 3, d: 4 } },
    { level: 'equal', question: 'Write 6/8 in its lowest terms.', answer: '3/4', value: { n: 3, d: 4 }, form: 'lowest' },
  ],
}

const draw = () => render(<MemoryRouter><FractionLadderGame game={GAME} /></MemoryRouter>)
const key = (label) => screen.getByRole('button', { name: label })

/** Type a fraction on the keypad the way a learner does. */
function type(num, den) {
  fireEvent.click(screen.getByRole('button', { name: /^Top number/ }))
  for (const digit of String(num)) fireEvent.click(key(digit))
  fireEvent.click(screen.getByRole('button', { name: /^Bottom number/ }))
  for (const digit of String(den)) fireEvent.click(key(digit))
  fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('FractionLadderGame', () => {
  it('opens on the ladder with only level 1 playable, and says what opens the rest', () => {
    draw()
    expect(screen.getByRole('button', { name: 'Level 1: What a fraction is' })).not.toBeDisabled()
    expect(screen.getByRole('button', {
      name: 'Level 3: Which one is bigger?, locked — opens after Level 2 — Equal fractions & simplifying',
    })).toBeDisabled()
    // Level 9 names ALL of its prerequisites, earliest first, so the lock
    // points at the next thing to do rather than the furthest.
    expect(screen.getByRole('button', {
      name: /^Level 9: Fractions in real life, locked — opens after Level 4 — Adding fractions,.*and Level 8 — Fractions, decimals & percentages$/,
    })).toBeInTheDocument()
  })

  it('a level with no questions in the pack says so instead of opening on nothing', () => {
    // Levels 1 and 2 already passed on this device, so level 3 is OPEN — and
    // this pack has no level 3 questions. An open level that opens on nothing
    // is the failure; it must say so and stay shut.
    window.localStorage.setItem('zedexams:fraction-ladder:test_fraction_ladder', JSON.stringify(['basics', 'equal']))
    draw()
    const compare = screen.getByRole('button', { name: 'Level 3: Which one is bigger?, no questions in this pack yet' })
    expect(compare).toBeDisabled()
  })

  it('accepts an equivalent fraction and says how it simplifies', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Level 1: What a fraction is' }))
    type(2, 4)
    expect(screen.getByText("That's right")).toBeInTheDocument()
    expect(screen.getByText(/simplifies to one half/)).toBeInTheDocument()
  })

  it('a wrong answer comes back with the misconception behind it', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Level 1: What a fraction is' }))
    type(2, 1)
    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByText(/The bottom holds how many pieces/)).toBeInTheDocument()
  })

  it('passing the level records it on this device and opens the next one', async () => {
    vi.useFakeTimers()
    try {
      draw()
      fireEvent.click(screen.getByRole('button', { name: 'Level 1: What a fraction is' }))
      type(1, 2)
      await act(async () => { vi.advanceTimersByTime(1600) })
      type(3, 4)
      await act(async () => { vi.advanceTimersByTime(1600) })

      expect(screen.getByText('Level passed!')).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0].correct).toBe(2)

      fireEvent.click(screen.getByRole('button', { name: /BACK TO THE LEVELS/ }))
      // Level 2 is open now, and level 1 is done.
      expect(screen.getByRole('button', { name: 'Level 2: Equal fractions & simplifying' })).not.toBeDisabled()
      expect(window.localStorage.getItem('zedexams:fraction-ladder:test_fraction_ladder')).toContain('basics')
    } finally {
      vi.useRealTimers()
    }
  })
})
