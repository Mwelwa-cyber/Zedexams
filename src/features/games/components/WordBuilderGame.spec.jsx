/**
 * Behaviour tests for the prototype-v3 Word Builder engine (learner
 * redesign step 4): the round starts on mount with the game doc's own
 * words, tapping letters fills the slots, a full set auto-checks —
 * correct pays 20 × combo and advances, wrong shakes and clears for a
 * retry — ⌫ takes back the last letter, and finishing the fixed set
 * lands on the shared win screen with the round saved through the KEPT
 * backend plumbing (saveScore via useGameFinish).
 *
 * There is no countdown (PROMPT 7b). The "no clock ever ends the round"
 * test pins the case this engine existed to fix: a learner mid-way
 * through building a word used to have the round taken off them, and
 * their spelling scored as nothing.
 *
 * jsdom has no speechSynthesis, so listen mode never triggers here and
 * every word deterministically shows its clue.
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

import WordBuilderGame from './WordBuilderGame'
import { saveScore, reportGameStart } from '../services/gamesService'
import { ROUND_WORDS } from '../lib/wordBuilderCore'

// One word, so the on-screen clue is known and the queue recycle path runs.
const GAME = {
  id: 'english_word_builder_g3',
  title: 'Spell the Animal',
  type: 'word_builder',
  grade: 3,
  subject: 'english',
  questions: [{ question: '🦁 King of the jungle.', answer: 'LION' }],
}

function renderGame() {
  return render(
    <MemoryRouter>
      <WordBuilderGame game={GAME} />
    </MemoryRouter>,
  )
}

const tiles = () => [...document.querySelectorAll('.lhx-wb-tile')]
const slots = () => [...document.querySelectorAll('.lhx-wb-slot')]

/** Tap the (first unused) tile carrying each letter, in order. */
function spell(word) {
  for (const letter of word) {
    const tile = tiles().find((t) => !t.disabled && t.textContent === letter)
    fireEvent.click(tile)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WordBuilderGame', () => {
  it('starts on mount: clue, one slot and tile per letter, the funnel reported', () => {
    renderGame()
    expect(reportGameStart).toHaveBeenCalledWith(GAME)
    expect(screen.getByText('SPELL THE WORD')).toBeInTheDocument()
    expect(screen.getByText('🦁 King of the jungle.')).toBeInTheDocument()
    expect(slots()).toHaveLength(4)
    expect(tiles().map((t) => t.textContent).sort().join('')).toBe('ILNO')
    // jsdom has no TTS — the hear-the-word button stays absent.
    expect(screen.queryByText(/Hear the word/)).toBeNull()
  })

  it('spelling the word correctly pays 20, marks the slots and advances to a fresh word', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      spell('LION')
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
      expect(slots().every((s) => s.className.includes('is-ok'))).toBe(true)
      // 650ms later the next word arrives (the one-word queue recycles).
      await act(async () => { vi.advanceTimersByTime(700) })
      expect(slots().every((s) => !s.className.includes('is-ok'))).toBe(true)
      expect(tiles().every((t) => !t.disabled)).toBe(true)
      expect(screen.getByText(/Word 2 of 8 · combo ×2/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a wrong spelling shakes, resets the combo and clears for a retry — and ⌫ takes back a letter', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      // Place one letter, delete it, then misspell.
      spell('L')
      expect(slots()[0].textContent).toBe('L')
      fireEvent.click(screen.getByRole('button', { name: '⌫ Delete' }))
      expect(slots()[0].textContent).toBe('')
      spell('LINO')
      expect(slots().every((s) => s.className.includes('is-no'))).toBe(true)
      expect(screen.getByText('⭐ 0')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(650) })
      // Cleared for another try on the SAME word.
      expect(slots().every((s) => s.textContent === '')).toBe(true)
      expect(screen.getByText('🦁 King of the jungle.')).toBeInTheDocument()
      // The recovery still scores (combo restarted at ×1).
      spell('LION')
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no clock ever ends the round, and a half-built word is never cut off', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      // Three letters placed, then ten minutes of thinking about the fourth.
      // Under the old 60-second countdown the round ended mid-word and this
      // spelling was scored as nothing. Now the learner simply finishes it.
      spell('LIO')
      await act(async () => { vi.advanceTimersByTime(600_000) })
      expect(screen.queryByText('Word Builder done!')).not.toBeInTheDocument()
      expect(saveScore).not.toHaveBeenCalled()
      spell('N')
      expect(screen.getByText('⭐ 20')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('finishing the set lands on the win screen and saves the round through the kept backend', async () => {
    vi.useFakeTimers()
    try {
      renderGame()
      // One word in the doc, so the queue recycles it — which is what lets the
      // test spell the same word ROUND_WORDS times.
      for (let i = 0; i < ROUND_WORDS; i += 1) {
        spell('LION')
        await act(async () => { vi.advanceTimersByTime(700) })
      }
      expect(screen.getByText('Word Builder done!')).toBeInTheDocument()
      expect(screen.getByText(/You spelt 8 words correctly/)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      expect(saveScore.mock.calls[0][0]).toMatchObject({
        // 20 × combo, combo climbing 1…8 across the set.
        game: GAME, score: 720, correct: 8, wrong: 0, bestStreak: 8,
      })
      // MEASURED, not a fixed round length: the clock stopped when the round
      // ended — 650ms into the last word's reveal beat, not at the end of it.
      // Spelling is the engine where this matters most; a careful speller's
      // round is simply longer, and nothing about the result penalises that.
      const endedAtMs = (ROUND_WORDS - 1) * 700 + 650
      expect(saveScore.mock.calls[0][0].timeSpent).toBe(Math.round(endedAtMs / 1000))
    } finally {
      vi.useRealTimers()
    }
  })
})
