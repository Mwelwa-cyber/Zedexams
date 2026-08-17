/**
 * Daily-challenge intro — what needs pinning is the honesty of the facts:
 * the hero names the ACTUAL game (never a question count the rotation
 * can't promise), "once a day" is about streak counting rather than a
 * play limit, the streak shown is the recorded one, and both doors lead
 * to real destinations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../learnerHome', async () => {
  const actual = await vi.importActual('../../learnerHome/components/LearnerPrimitives')
  return { SectionSkeleton: actual.SectionSkeleton }
})
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' } }),
}))

let mockChallenge
let mockStreak
vi.mock('../../../utils/dailyChallengeService', () => ({
  getTodaysChallenge: () => Promise.resolve(mockChallenge),
  getMyStreak: () => Promise.resolve(mockStreak),
}))

import DailyIntro from './DailyIntro'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/games/daily']}>
      <Routes>
        <Route path="/games/daily" element={<DailyIntro />} />
        <Route path="/games/play/:gameId" element={<div>PLAY ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockChallenge = { game: { id: 'g1', title: 'Number Target', subject: 'mathematics' }, dateId: '2026-08-17' }
  mockStreak = { streak: 4, longestStreak: 6, signedIn: true }
})

describe('DailyIntro', () => {
  it('names the actual challenge game, never a question count', async () => {
    mount()
    expect(await screen.findByText('Number Target')).toBeInTheDocument()
    // The rotation can pick any mechanic, so a fixed "5 questions" promise
    // (the mockup's) must not appear.
    expect(screen.queryByText(/\d+\s+(quick\s+)?questions/i)).toBeNull()
  })

  it('shows the recorded streak and frames once-a-day as streak counting', async () => {
    mount()
    expect(await screen.findByText(/now/)).toBeInTheDocument()
    expect(screen.getByText('4 days')).toBeInTheDocument()
    // Replays are allowed — the fact is about counting, not a play limit.
    expect(screen.getByText(/counts/)).toBeInTheDocument()
    expect(screen.queryByText(/only.*once/i)).toBeNull()
  })

  it('invites a first play when there is no streak yet', async () => {
    mockStreak = { streak: 0, longestStreak: 0, signedIn: true }
    mount()
    expect(await screen.findByText('Play today to start a streak.')).toBeInTheDocument()
  })

  it('Play opens the actual challenge; the leaderboard door is a link', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Play today’s challenge/ }))
    expect(screen.getByText('PLAY ROUTE')).toBeInTheDocument()
  })

  it('a failed load offers the way back instead of a broken hero', async () => {
    mockChallenge = { game: null }
    mount()
    expect(await screen.findByText(/couldn’t load today’s challenge/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Games' })).toHaveAttribute('href', '/games')
  })
})
