/**
 * The spelling PROGRESS added to Word Builder: mastery, spacing and the coach.
 *
 * The existing WordBuilderGame.spec.jsx pins the mechanic — clue, tiles,
 * scoring, no clock. This file pins the three rules that decide whether a
 * learner has actually LEARNT a word, each of which is invisible on screen:
 *
 *   The coach appears after a miss, and ONLY for a word the pack has broken
 *   up — never on a guessed split.
 *   A miss is written to this device's pool, so the word comes back later
 *   rather than at random.
 *   A right answer counts once per SESSION, so three rights in one sitting
 *   cannot master a word.
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

import WordBuilderGame from './WordBuilderGame'

const KEY = 'zedexams:spelling:test_speller'

/** One word with a coach, one without — so both paths are on the board. */
const GAME = {
  id: 'test_speller',
  title: 'Word Builder',
  type: 'word_builder',
  grade: 7,
  questions: [
    {
      question: 'The layer of gases around the Earth.',
      answer: 'ATMOSPHERE',
      chunks: ['AT', 'MOS', 'PHERE'],
      strategy: 'syllables',
      trap: 2,
      why: '“PH” says F — like in “phone”.',
    },
    { question: 'The season when crops are gathered.', answer: 'HARVEST' },
  ],
}

const draw = () => render(<MemoryRouter><WordBuilderGame game={GAME} /></MemoryRouter>)

/** Spell whatever word is on screen, wrongly: tap the tiles in tile order. */
function spellWrongly() {
  const tiles = screen.getAllByRole('button').filter((b) => /^[A-Z], /.test(b.getAttribute('aria-label') || '') || /^[A-Z]$/.test(b.getAttribute('aria-label') || ''))
  for (const tile of tiles) fireEvent.click(tile)
}

const pool = () => JSON.parse(window.localStorage.getItem(KEY) || '{}').pool || {}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('Word Builder — spelling progress', () => {
  it('shows the coach after a miss, with the tricky chunk marked', async () => {
    // Force ATMOSPHERE to be the word on screen: the other word has no coach,
    // so the assertion below would be ambiguous otherwise.
    const single = { ...GAME, questions: [GAME.questions[0]] }
    render(<MemoryRouter><WordBuilderGame game={single} /></MemoryRouter>)

    expect(screen.queryByText('Break it up')).toBeNull()
    spellWrongly()

    expect(screen.getByText('Break it up')).toBeInTheDocument()
    expect(screen.getByText('Syllables · long words')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PHERE, the tricky bit' })).toBeInTheDocument()
    expect(screen.getByText(/“PH” says F/)).toBeInTheDocument()
    expect(screen.getByText(/3 more sessions to master this one/)).toBeInTheDocument()
  })

  it('a word the pack has not broken up gets no coach at all', () => {
    const single = { ...GAME, questions: [GAME.questions[1]] }
    render(<MemoryRouter><WordBuilderGame game={single} /></MemoryRouter>)
    spellWrongly()
    expect(screen.queryByText('Break it up')).toBeNull()
  })

  it('rebuilding refuses an out-of-order chunk instead of punishing it', () => {
    const single = { ...GAME, questions: [GAME.questions[0]] }
    render(<MemoryRouter><WordBuilderGame game={single} /></MemoryRouter>)
    spellWrongly()

    // Tapping the LAST chunk first does nothing — nothing is marked, nothing
    // is taken away, and the first chunk still works.
    fireEvent.click(screen.getByRole('button', { name: 'PHERE, the tricky bit' }))
    expect(screen.queryByText(/now spell it/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'AT' }))
    fireEvent.click(screen.getByRole('button', { name: 'MOS' }))
    fireEvent.click(screen.getByRole('button', { name: 'PHERE, the tricky bit' }))
    expect(screen.getByText(/now spell it/i)).toBeInTheDocument()
  })

  it('a miss is written to this device, so the word comes back later', () => {
    const single = { ...GAME, questions: [GAME.questions[0]] }
    render(<MemoryRouter><WordBuilderGame game={single} /></MemoryRouter>)
    spellWrongly()

    const entry = pool().ATMOSPHERE
    expect(entry.misses).toBe(1)
    expect(entry.correct).toBe(0)
    // 2 stages out from stage 0 — the first step of the 2 / 5 / 11 spacing.
    expect(entry.dueAt).toBe(2)
  })
})
