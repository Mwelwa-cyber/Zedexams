/**
 * GamesLeaderboard.spec — what needs a DOM.
 *
 * The ranking, podium and reset arithmetic are covered pure by
 * `test:games-leaderboard`. What can only be checked here is that the page
 * DRAWS the real data rather than the prototype's — the specific failure
 * this redesign is guarding against is a leaderboard that matches the
 * mockup screenshot and shows made-up learners.
 *
 * So every assertion below is either "this came from the service" or "this
 * never reaches the screen".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

const mocks = vi.hoisted(() => ({
  user: { currentUser: { uid: 'me' }, userProfile: { grade: 7 } },
  board: { entries: [], error: null },
  mine: null,
  rank: null,
  lastWeek: [],
  streak: 0,
}))

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mocks.user }))

vi.mock('../../../utils/dailyChallengeService', () => ({
  getMyStreak: () => Promise.resolve({ streak: mocks.streak }),
}))

vi.mock('../services/gamesLeaderboardService', () => ({
  subscribeToWeeklyBoard: (_args, cb) => { cb(mocks.board); return () => {} },
  subscribeToMyWeekEntry: (_args, cb) => { cb({ entry: mocks.mine, error: null }); return () => {} },
  getMyWeeklyRank: () => Promise.resolve(mocks.rank),
  getLastWeekTop: () => Promise.resolve(mocks.lastWeek),
}))

import GamesLeaderboard from './GamesLeaderboard'

const entry = (uid, points, displayName, extra = {}) => ({
  uid, points, displayName, plays: 3, lastPlayedAt: { seconds: 1000 }, ...extra,
})

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/games/leaderboard']}>
      <Routes>
        <Route path="/games/leaderboard" element={<GamesLeaderboard />} />
        <Route path="/games" element={<div>GAMES HUB</div>} />
        <Route path="/games/daily" element={<div>DAILY ROUTE</div>} />
        <Route path="/login" element={<div>LOGIN ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.user = { currentUser: { uid: 'me' }, userProfile: { grade: 7 } }
  mocks.board = { entries: [], error: null }
  mocks.mine = null
  mocks.rank = null
  mocks.lastWeek = []
  mocks.streak = 0
})

describe('GamesLeaderboard', () => {
  it('names the learner’s OWN grade, never a hard-coded one', async () => {
    mocks.user = { currentUser: { uid: 'me' }, userProfile: { grade: 5 } }
    mocks.board = { entries: [entry('a', 10, 'Chanda M.')], error: null }
    renderBoard()
    expect(await screen.findByText('Grade 5 · This week')).toBeInTheDocument()
    expect(screen.queryByText('Grade 7 · This week')).not.toBeInTheDocument()
  })

  it('shows the learner’s real rank, points and streak in the header', async () => {
    mocks.mine = entry('me', 96, 'Me M.')
    mocks.streak = 3
    mocks.board = {
      entries: [entry('a', 198, 'Chanda M.'), entry('b', 186, 'Taonga B.'), entry('me', 96, 'Me M.')],
      error: null,
    }
    const { container } = renderBoard()
    await screen.findByText('Your rank')
    // Scoped to the hero: "#3" and "96 pts" legitimately appear again on the
    // pinned card at the bottom, which is the reference design's shape.
    const hero = container.querySelector('.lhx-lb-hero')
    const stats = [...hero.querySelectorAll('.lhx-lb-stat-v')].map((n) => n.textContent.trim())
    expect(stats).toEqual(['#3', '96', '🔥 3'])
  })

  it('puts the top three on the podium and ranks four onward in the list', async () => {
    mocks.board = {
      entries: [
        entry('a', 198, 'Chanda M.'), entry('b', 186, 'Taonga B.'), entry('c', 172, 'Mutale K.'),
        entry('d', 161, 'Luyando S.'), entry('e', 151, 'Mapalo C.'),
      ],
      error: null,
    }
    renderBoard()
    const podium = await screen.findByRole('list', { name: 'Top three this week' })
    expect(podium.textContent).toContain('Chanda M.')
    expect(podium.textContent).toContain('Taonga B.')
    expect(podium.textContent).toContain('Mutale K.')
    expect(podium.textContent).not.toContain('Luyando S.')

    expect(screen.getByText('Everyone else')).toBeInTheDocument()
    expect(screen.getByText(/Rank 4, Luyando S\., 161 points/)).toBeInTheDocument()
    expect(screen.getByText(/Rank 5, Mapalo C\., 151 points/)).toBeInTheDocument()
  })

  it('draws first place taller than second and third, so rank survives without colour', async () => {
    mocks.board = {
      entries: [entry('a', 198, 'Chanda M.'), entry('b', 186, 'Taonga B.'), entry('c', 172, 'Mutale K.')],
      error: null,
    }
    const { container } = renderBoard()
    await screen.findByRole('list', { name: 'Top three this week' })
    // Visual order is 2 · 1 · 3, and the tall block is the middle one.
    const blocks = [...container.querySelectorAll('.lhx-lb-pod')]
    expect(blocks.map((b) => b.className)).toEqual([
      expect.stringContaining('lhx-lb-pod-2'),
      expect.stringContaining('lhx-lb-pod-1'),
      expect.stringContaining('lhx-lb-pod-3'),
    ])
  })

  it('highlights the learner’s row and calls them "You", not their name', async () => {
    mocks.mine = entry('me', 96, 'Me M.')
    mocks.board = {
      entries: [
        entry('a', 198, 'Chanda M.'), entry('b', 186, 'Taonga B.'), entry('c', 172, 'Mutale K.'),
        entry('me', 96, 'Me M.'),
      ],
      error: null,
    }
    const { container } = renderBoard()
    await screen.findByText('Everyone else')
    const viewerRows = container.querySelectorAll('.lhx-lb-row.is-viewer')
    expect(viewerRows.length).toBeGreaterThan(0)
    expect(screen.getByText('You — that’s you!')).toBeInTheDocument()
    // The page never renders the viewer's own display name back at them.
    expect(container.textContent).not.toContain('Me M.')
  })

  it('pins the learner’s position when they are below the visible board', async () => {
    // 47th, and the board only fetched the top rows — the pinned card is the
    // only way they can see where they are, and it must not require
    // rendering 47 rows to produce it.
    mocks.mine = entry('me', 24, 'Me M.')
    mocks.rank = 47
    mocks.board = {
      entries: [entry('a', 198, 'Chanda M.'), entry('b', 186, 'Taonga B.'), entry('c', 172, 'Mutale K.')],
      error: null,
    }
    const { container } = renderBoard()
    await waitFor(() => expect(container.querySelector('.lhx-lb-pinned')).toBeTruthy())
    expect(screen.getByText(/Your position\. Rank 47, You, 24 points/)).toBeInTheDocument()
    expect(container.querySelectorAll('.lhx-lb-row').length).toBeLessThan(10)
  })

  it('shows last week’s winner when there is one', async () => {
    mocks.lastWeek = [entry('a', 300, 'Chanda M.'), entry('b', 120, 'Taonga B.')]
    mocks.board = { entries: [entry('x', 10, 'Bwalya P.')], error: null }
    renderBoard()
    expect(await screen.findByText('Chanda M.')).toBeInTheDocument()
    expect(screen.getByText(/Last week:/)).toBeInTheDocument()
  })

  it('shows NO crown line at all when there is no previous winner', async () => {
    mocks.lastWeek = []
    mocks.board = { entries: [entry('x', 10, 'Bwalya P.')], error: null }
    const { container } = renderBoard()
    await screen.findByText(/Resets Monday/)
    expect(container.textContent).not.toContain('Last week')
  })

  it('never prints an email address, even from a legacy row', async () => {
    mocks.board = { entries: [entry('a', 10, 'elisha.c@zedexams.com')], error: null }
    const { container } = renderBoard()
    await screen.findByRole('list', { name: 'Top three this week' })
    expect(container.textContent).not.toContain('@')
    expect(container.textContent).not.toContain('zedexams.com')
    expect(container.textContent).toContain('Learner')
  })

  it('reports a failed read as an error with a retry, never as an empty board', async () => {
    mocks.board = { entries: null, error: new Error('permission-denied') }
    renderBoard()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('We couldn’t load the board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // The learner is never shown "the board is waiting for its first scores"
    // for a query that failed, and never shown the raw Firestore code.
    expect(screen.queryByText(/waiting for its first scores/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('permission-denied')
  })

  it('offers today’s challenge from the empty state', async () => {
    mocks.board = { entries: [], error: null }
    renderBoard()
    expect(await screen.findByText(/waiting for its first scores/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /Play today’s challenge/ }))
    expect(await screen.findByText('DAILY ROUTE')).toBeInTheDocument()
  })

  it('asks a signed-out visitor to sign in rather than showing an empty grade board', async () => {
    mocks.user = { currentUser: null, userProfile: null }
    renderBoard()
    expect(await screen.findByText(/Sign in to see your grade’s board/)).toBeInTheDocument()
  })

  it('shows a skeleton, not a blank page, while the board loads', () => {
    mocks.board = { entries: null, error: null }
    const { container } = renderBoard()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.lhx-lb-skel').length).toBeGreaterThan(3)
  })

  it('carries none of the old board’s per-row metadata', async () => {
    mocks.board = {
      entries: [
        entry('a', 198, 'Chanda M.', { accuracy: 97, bestStreak: 26 }),
        entry('b', 186, 'Taonga B.'), entry('c', 172, 'Mutale K.'), entry('d', 161, 'Luyando S.'),
      ],
      error: null,
    }
    const { container } = renderBoard()
    await screen.findByText('Everyone else')
    expect(container.textContent).not.toMatch(/accuracy/i)
    expect(container.textContent).not.toMatch(/\d+d ago/)
    expect(container.textContent).not.toMatch(/Streak \d+/)
    // …and none of the old hero copy.
    expect(container.textContent).not.toMatch(/climbing fastest|LIVE SCORES|TOP 25|ALL TIME/i)
  })

  it('states the grade in the footer note and promises a Monday reset', async () => {
    mocks.board = { entries: [entry('a', 10, 'Chanda M.')], error: null }
    renderBoard()
    expect(await screen.findByText(/Everyone in Grade 7 gets the same challenge each day\./))
      .toBeInTheDocument()
    expect(screen.getByText(/resets every Monday/)).toBeInTheDocument()
  })

  it('a one-learner board renders a podium of one rather than breaking', async () => {
    mocks.board = { entries: [entry('a', 10, 'Chanda M.')], error: null }
    const { container } = renderBoard()
    await screen.findByRole('list', { name: 'Top three this week' })
    expect(container.querySelectorAll('.lhx-lb-pod').length).toBe(1)
    expect(screen.queryByText('Everyone else')).not.toBeInTheDocument()
  })

  it('goes back to the games hub', async () => {
    mocks.board = { entries: [entry('a', 10, 'Chanda M.')], error: null }
    renderBoard()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Games' }))
    expect(await screen.findByText('GAMES HUB')).toBeInTheDocument()
  })
})
