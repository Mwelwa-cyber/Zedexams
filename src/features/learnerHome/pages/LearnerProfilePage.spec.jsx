/**
 * LearnerProfilePage.spec — the prototype-v6 "My Profile" view (step 10).
 * Pins: real-data hero (name, grade · term · school), the guardian chip
 * only when a guardian actually approved, the level/streak/badges tiles,
 * the XP bar maths, the earned-then-locked badge shelf, the this-week
 * tiles, and the settings/sign-out actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))

const logout = vi.fn().mockResolvedValue()
let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: mockProfile, logout }),
}))

vi.mock('../../../hooks/useLearnerStats', () => ({
  default: () => ({
    stats: { xp: 520, currentStreak: 12 },
    // levelFromXp(520): Level 4 (450) → next Level 5 at 700
    level: {
      level: 4, title: 'Achiever', totalXp: 520,
      nextLevel: { level: 5, threshold: 700 },
      xpInLevel: 70, xpToNext: 250, xpRemaining: 180, progress: 28,
    },
    loading: false,
  }),
}))

vi.mock('../hooks/useWeeklySummary', () => ({
  default: () => ({ quizzes: 5, games: 9, topics: 7, loading: false }),
}))

vi.mock('../../../utils/gameBadgesService', () => ({
  getMyGameBadges: vi.fn().mockResolvedValue({
    byId: { 'first-game': { awardedAt: 1 }, 'on-fire': { awardedAt: 2 } },
    userId: 'u1',
  }),
}))

// The page reads `getMostRecentTerm`, not `getActiveTerm`: the latter
// reports nothing between terms, which is what used to label every
// learner "Term 1" through the holidays.
vi.mock('../../../utils/moeCalendar', () => ({
  getActiveTerm: () => ({ term: { number: 2 } }),
  getMostRecentTerm: () => ({ term: { number: 2 }, phase: 'in-term' }),
}))

import LearnerProfilePage from './LearnerProfilePage'
import { GAME_BADGES } from '../../../data/gameBadges'

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<LearnerProfilePage />} />
        <Route path="/settings" element={<div>SETTINGS ROUTE</div>} />
        <Route path="/login" element={<div>LOGIN ROUTE</div>} />
        <Route path="/dashboard" element={<div>HOME ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  logout.mockClear()
  mockProfile = {
    role: 'learner',
    displayName: 'Milton Phiri',
    grade: '7',
    school: 'Kabulonga Primary',
    guardian: { consentStatus: 'granted' },
  }
})

describe('LearnerProfilePage (prototype-v6)', () => {
  it('renders the hero from real profile data, with the guardian chip when approved', async () => {
    renderProfile()
    expect(screen.getByText('Milton Phiri')).toBeInTheDocument()
    expect(screen.getByText('Grade 7 · Term 2 · Kabulonga Primary')).toBeInTheDocument()
    expect(screen.getByText('✅ Guardian verified')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument()) // badge count
  })

  it('never claims guardian verification it does not have', () => {
    mockProfile = { ...mockProfile, guardian: null }
    renderProfile()
    expect(screen.queryByText('✅ Guardian verified')).not.toBeInTheDocument()
  })

  it('shows the learner ladder: level tile, streak tile and the XP bar maths', () => {
    renderProfile()
    expect(screen.getByText('LEVEL')).toBeInTheDocument()
    expect(screen.getByText('🔥 12')).toBeInTheDocument()
    expect(screen.getByText('Level 4 · Achiever')).toBeInTheDocument()
    expect(screen.getByText('520 / 700 XP')).toBeInTheDocument()
    expect(screen.getByText('180 XP to Level 5 🚀')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /next level/i })).toHaveAttribute('aria-valuenow', '28')
  })

  it('the achievements shelf lists the whole catalogue, earned first, locked greyed', async () => {
    renderProfile()
    await waitFor(() => {
      // Every catalogue badge is on the shelf by name.
      for (const b of GAME_BADGES) expect(screen.getByText(b.name)).toBeInTheDocument()
    })
    const medals = document.querySelectorAll('.lhx-badge-medal')
    expect(medals.length).toBe(GAME_BADGES.length)
    expect(document.querySelectorAll('.lhx-badge-medal.is-locked').length).toBe(GAME_BADGES.length - 2)
    // Earned come first.
    expect(medals[0].classList.contains('is-locked')).toBe(false)
    expect(medals[1].classList.contains('is-locked')).toBe(false)
  })

  it('shows the this-week tiles from the weekly summary', () => {
    renderProfile()
    expect(screen.getByText('QUIZZES')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('GAMES')).toBeInTheDocument()
    expect(screen.getByText('TOPICS')).toBeInTheDocument()
  })

  it('Settings navigates and Sign out logs out then lands on /login', async () => {
    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: '⚙️ Settings' }))
    expect(screen.getByText('SETTINGS ROUTE')).toBeInTheDocument()

    renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(screen.getByText('LOGIN ROUTE')).toBeInTheDocument())
    expect(logout).toHaveBeenCalled()
  })
})
