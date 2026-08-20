/**
 * Behaviour tests for Race Zed! (learner redesign step 7): the VS
 * screen presents Zed honestly (ROBOT COACH tag + the no-other-players
 * line) and counts down into the race, the race scores answers by the
 * quiz family's 20 × combo against a five-question draw from a real
 * timed_quiz doc, the result compares the learner to Zed's precomputed
 * timeline, only the LEARNER'S half is saved through the kept backend,
 * and rematch starts a fresh race.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'learner-1', displayName: 'Mahenga' },
    userProfile: { displayName: 'Mahenga', grade: 4 },
  }),
}))
vi.mock('../services/gamesService', () => ({
  listGames: vi.fn(),
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
  reportGameStart: vi.fn(),
  readRoundBaseline: vi.fn(async () => ({})),
  readRoundOutcome: vi.fn(async () => ({ levelChange: null, personalBest: null })),
}))
// The deletion list the seed fallback is filtered by. Mocked for the same
// reason as the services around it — the real module reaches Firestore —
// and empty here, so the fallback behaviour these tests assert is unchanged.
vi.mock('../../../utils/gameTombstones', () => ({
  loadDeletedGameIds: () => Promise.resolve(new Set()),
  resetDeletedGameCache: () => {},
  isDeletedGame: () => false,
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

import DuelRace from './DuelRace'
import { listGames, saveScore, reportGameStart } from '../services/gamesService'

// One eligible quiz: every question's first option is correct, so a test
// can race perfectly (or miss deliberately) by position.
const QUIZ = {
  id: 'math_quiz_g4',
  title: 'Quick Maths',
  subject: 'mathematics',
  grade: 4,
  type: 'timed_quiz',
  questions: Array.from({ length: 6 }, (_, i) => ({
    question: `Q${i}: ${i} + 1 = ?`,
    options: [String(i + 1), String(i + 2), String(i + 3)],
    answer: String(i + 1),
  })),
}

function renderDuel() {
  return render(
    <MemoryRouter initialEntries={['/games/duel']}>
      <DuelRace />
    </MemoryRouter>,
  )
}

/** Flush the load effect's promises — findBy* polls hang under fake
 * timers, so the mocked listGames resolves through act instead. */
async function settleLoad() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

/** VS → race: run the 3-2-1-GO! countdown out. Each tick schedules the
 * next from its own effect re-run, so the clock advances stepwise (the
 * same idiom as the legacy TimedQuiz spec's runOutTheClock). */
async function throughCountdown() {
  await settleLoad()
  screen.getByText('🤖 ROBOT COACH')
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { vi.advanceTimersByTime(900) })
  }
}

/** Answer the current question by option position, through the reveal beat. */
async function answerAt(position) {
  const options = document.querySelectorAll('.lhx-opt')
  fireEvent.click(options[position])
  await act(async () => { vi.advanceTimersByTime(750) })
}

beforeEach(() => {
  vi.clearAllMocks()
  listGames.mockResolvedValue([QUIZ])
})

describe('DuelRace', () => {
  it('presents Zed honestly on the VS screen and counts down into the race', async () => {
    vi.useFakeTimers()
    try {
      renderDuel()
      await settleLoad()
      expect(screen.getByText('🤖 ROBOT COACH')).toBeInTheDocument()
      expect(screen.getByText(/no other players involved/)).toBeInTheDocument()
      expect(screen.getByText(/CHALLENGE MODE · GRADE 4/)).toBeInTheDocument()
      for (let i = 0; i < 6; i += 1) {
        await act(async () => { vi.advanceTimersByTime(900) })
      }
      expect(reportGameStart).toHaveBeenCalledWith(QUIZ)
      expect(screen.getByText(/QUESTION 1 OF 5/)).toBeInTheDocument()
      // Both racers on the strip, Zed as the robot.
      expect(screen.getByLabelText('Zed the robot')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('scores 20 × combo on correct answers and shows the verdict colours', async () => {
    vi.useFakeTimers()
    try {
      renderDuel()
      await throughCountdown()
      const strip = () => screen.getByLabelText('Race scores')
      // First correct: +20.
      fireEvent.click(document.querySelectorAll('.lhx-opt')[0])
      expect(document.querySelector('.lhx-opt.is-correct')).not.toBeNull()
      await act(async () => { vi.advanceTimersByTime(750) })
      expect(within(strip()).getByText('20')).toBeInTheDocument()
      // Second correct: +40 → 60.
      await answerAt(0)
      expect(within(strip()).getByText('60')).toBeInTheDocument()
      // A miss paints the pick red and the right answer green, resets combo.
      fireEvent.click(document.querySelectorAll('.lhx-opt')[1])
      expect(document.querySelector('.lhx-opt.is-wrong')).not.toBeNull()
      expect(document.querySelector('.lhx-opt.is-correct')).not.toBeNull()
      await act(async () => { vi.advanceTimersByTime(750) })
      expect(screen.getByText('🔥 x1')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a finished race lands on the result, saving ONLY the learner half against the source game', async () => {
    vi.useFakeTimers()
    try {
      renderDuel()
      await throughCountdown()
      // Perfect run: 20+40+60+80+100 = 300.
      for (let i = 0; i < 5; i += 1) await answerAt(0)
      expect(screen.getByText(/YOU/)).toBeInTheDocument()
      const youCard = screen.getByText('YOU').closest('.lhx-win-stat')
      expect(within(youCard).getByText('300')).toBeInTheDocument()
      expect(screen.getByText(/only your score counts on the leaderboard/)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      const saved = saveScore.mock.calls[0][0]
      expect(saved).toMatchObject({ game: QUIZ, score: 300, correct: 5, wrong: 0, bestStreak: 5 })
      expect('zed' in saved).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rematch returns to the countdown and a fresh race saves a second round', async () => {
    vi.useFakeTimers()
    try {
      renderDuel()
      await throughCountdown()
      for (let i = 0; i < 5; i += 1) await answerAt(0)
      fireEvent.click(screen.getByRole('button', { name: /REMATCH/ }))
      expect(screen.getByText('🤖 ROBOT COACH')).toBeInTheDocument()
      for (let i = 0; i < 6; i += 1) {
        await act(async () => { vi.advanceTimersByTime(900) })
      }
      expect(screen.getByText(/QUESTION 1 OF 5/)).toBeInTheDocument()
      for (let i = 0; i < 5; i += 1) await answerAt(0)
      expect(saveScore).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('with no quiz able to field a race, says so instead of inventing content', async () => {
    listGames.mockResolvedValue([{ id: 'tiny', type: 'timed_quiz', grade: 4, questions: [] }])
    renderDuel()
    expect(await screen.findByText(/No race can start right now/)).toBeInTheDocument()
    expect(saveScore).not.toHaveBeenCalled()
  })
})
