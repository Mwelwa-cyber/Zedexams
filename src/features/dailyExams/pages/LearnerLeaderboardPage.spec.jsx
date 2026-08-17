/**
 * LearnerLeaderboardPage.spec — the prototype-v23 weekly board.
 *
 * The ordering maths is covered exhaustively under plain node in
 * learnerLeaderboardCore.test.js. What is pinned HERE is what only a
 * rendered DOM can answer: that the podium reaches the screen in the
 * medal order the core returns, that the sticky "you" row appears at the
 * ranks it should and nowhere else, that no learner's surname is printed,
 * and that an empty or failed week says so instead of rendering a board.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'me' }, userProfile: mockProfile }),
}))

vi.mock('../../../hooks/useLearnerStats', () => ({
  default: () => ({ stats: { currentStreak: 3 }, level: null, loading: false }),
}))

const mockFetch = vi.fn()
vi.mock('../services/weeklyLeaderboardService', () => ({
  fetchWeeklyBoardData: (...a) => mockFetch(...a),
  MAX_ATTEMPTS: 3000,
}))

import LearnerLeaderboardPage from './LearnerLeaderboardPage'
import { weekWindow } from '../lib/learnerLeaderboardCore'

/** One submitted attempt, shaped as the grader writes it. */
const at = (userId, displayName, score) => ({
  userId, displayName, score, percentage: score * 10, attemptDate: '2026-08-17',
})

function boardData(attempts, extra = {}) {
  return {
    window: weekWindow(new Date(2026, 7, 19, 15, 0)), // Wednesday
    attempts,
    truncated: false,
    previousAttempts: [],
    ...extra,
  }
}

function renderPage() {
  return render(<MemoryRouter><LearnerLeaderboardPage /></MemoryRouter>)
}

beforeEach(() => {
  mockProfile = { grade: '7', displayName: 'Mapalo Chanda', role: 'learner' }
  mockFetch.mockReset()
})

describe('LearnerLeaderboardPage', () => {
  it('renders the podium in medal order: silver, gold, bronze', async () => {
    mockFetch.mockResolvedValue(boardData([
      at('u1', 'Chanda Mwale', 20),
      at('u2', 'Taonga Banda', 18),
      at('u3', 'Mutale Kunda', 16),
    ]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelectorAll('.lhx-pod')).toHaveLength(3))
    // The winner stands in the MIDDLE — the podium is a physical metaphor,
    // so DOM order must be 2nd · 1st · 3rd, not 1st · 2nd · 3rd.
    const names = [...container.querySelectorAll('.lhx-pod-name')].map((n) => n.textContent)
    expect(names).toEqual(['Taonga B.', 'Chanda M.', 'Mutale K.'])
  })

  it('never prints a learner surname anywhere on the board', async () => {
    mockFetch.mockResolvedValue(boardData([
      at('u1', 'Chanda Mwale', 20),
      at('u2', 'Taonga Banda', 18),
      at('u3', 'Mutale Kunda', 16),
      at('u4', 'Natasha Zulu', 14),
    ]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-podium')).toBeInTheDocument())
    // The board is readable by every learner in the grade, so a full name
    // here would be child PII on a shared screen.
    for (const surname of ['Mwale', 'Banda', 'Kunda', 'Zulu']) {
      expect(container.textContent).not.toContain(surname)
    }
    expect(container.textContent).toContain('Chanda M.')
  })

  it('pins the "you" row when the learner is below the podium', async () => {
    mockFetch.mockResolvedValue(boardData([
      at('u1', 'Chanda Mwale', 20),
      at('u2', 'Taonga Banda', 18),
      at('u3', 'Mutale Kunda', 16),
      at('me', 'Mapalo Chanda', 9),
    ]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-lb-pin')).toBeInTheDocument())
    const pin = container.querySelector('.lhx-lb-pin')
    expect(pin.textContent).toContain('#4')
    expect(pin.textContent).toContain('9 pts')
    // The pin repeats the learner's own list row; the two must agree, or
    // the screen is telling a child two different ranks at once.
    const meRow = container.querySelector('.lhx-board-row.is-me')
    expect(meRow.textContent).toContain('9 pts')
  })

  it('does not pin the row when the learner is ON the podium', async () => {
    mockFetch.mockResolvedValue(boardData([
      at('me', 'Mapalo Chanda', 30),
      at('u1', 'Chanda Mwale', 20),
      at('u2', 'Taonga Banda', 18),
    ]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-podium')).toBeInTheDocument())
    expect(container.querySelector('.lhx-lb-pin')).toBeNull()
  })

  it('shows a learner who has not played yet at the bottom, not missing', async () => {
    mockFetch.mockResolvedValue(boardData([
      at('u1', 'Chanda Mwale', 20),
      at('u2', 'Taonga Banda', 18),
      at('u3', 'Mutale Kunda', 16),
    ]))
    const { container } = renderPage()

    // "You are not on this list" is the one message this screen must never
    // send a child — they appear at 0 points instead.
    await waitFor(() => expect(container.querySelector('.lhx-lb-pin')).toBeInTheDocument())
    expect(container.querySelector('.lhx-lb-pin').textContent).toContain('#4')
    expect(container.querySelector('.lhx-lb-pin').textContent).toContain('0 pts')
  })

  it('reports the learner rank, points and streak in the header', async () => {
    mockFetch.mockResolvedValue(boardData([
      at('u1', 'Chanda Mwale', 20),
      at('me', 'Mapalo Chanda', 12),
    ]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-podium')).toBeInTheDocument())
    const stats = container.querySelector('.lhx-lb-stats').textContent
    expect(stats).toContain('#2')
    expect(stats).toContain('12')
    expect(stats).toContain('3') // streak, from learnerStats
  })

  it('scopes the board to the learner grade, with no grade picker', async () => {
    mockFetch.mockResolvedValue(boardData([at('u1', 'Chanda Mwale', 20)]))
    renderPage()

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ grade: '7' }))
    expect(screen.getByText(/Grade 7 · This week/)).toBeInTheDocument()
    // Grade browsing is not offered on the child UI.
    expect(document.querySelector('select')).toBeNull()
  })

  it('counts down to the Monday reset', async () => {
    mockFetch.mockResolvedValue(boardData([at('u1', 'Chanda Mwale', 20)]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-lb-strip')).toBeInTheDocument())
    expect(container.querySelector('.lhx-lb-strip').textContent).toMatch(/Resets\s*Monday/)
  })

  it('shows last week\'s champion only when there was one', async () => {
    mockFetch.mockResolvedValue(boardData(
      [at('u1', 'Chanda Mwale', 20)],
      { previousAttempts: [at('u2', 'Taonga Banda', 30)] },
    ))
    const { container } = renderPage()

    await waitFor(() => expect(container.textContent).toContain('Last week'))
    expect(container.textContent).toContain('Taonga B.')
  })

  it('omits the champion chip when nobody played last week', async () => {
    mockFetch.mockResolvedValue(boardData([at('u1', 'Chanda Mwale', 20)]))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-lb-strip')).toBeInTheDocument())
    // An empty crown chip is worse than no chip.
    expect(container.textContent).not.toContain('Last week')
  })

  it('invites the first player when the week is empty', async () => {
    mockFetch.mockResolvedValue(boardData([]))
    const { container } = renderPage()

    await waitFor(() => expect(container.textContent).toMatch(/Nobody in Grade 7/))
    expect(container.querySelector('.lhx-podium')).toBeNull()
    expect(container.textContent).toMatch(/you'll be first/i)
  })

  it('reports a read failure instead of rendering an empty board', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockRejectedValue(new Error('offline'))
    const { container } = renderPage()

    // Falling back to an empty board would tell the learner nobody played
    // this week — a different, and wrong, statement about their classmates.
    await waitFor(() => expect(container.textContent).toMatch(/could not load/i))
    expect(container.querySelector('.lhx-podium')).toBeNull()
    expect(container.textContent).not.toMatch(/Nobody in Grade/)
  })

  it('asks a learner with no grade to finish setup, and reads nothing', async () => {
    mockProfile = { role: 'learner' }
    const { container } = renderPage()

    await waitFor(() => expect(container.textContent).toMatch(/Finish setting up/))
    // Guessing a grade would put the learner on strangers' board.
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('discloses a truncated week rather than ranking it silently', async () => {
    mockFetch.mockResolvedValue(boardData(
      [at('u1', 'Chanda Mwale', 20), at('u2', 'Taonga Banda', 10)],
      { truncated: true },
    ))
    const { container } = renderPage()

    await waitFor(() => expect(container.querySelector('.lhx-podium')).toBeInTheDocument())
    expect(container.textContent).toMatch(/busiest part of a very active week/i)
  })
})
