/**
 * Sticker Collection — the chrome is the mockup's, the stickers are the
 * real award system. Pinned: earned state comes from the badges doc,
 * a locked sticker teaches its real unlock hint (never an invented
 * criterion), and the signed-out state invites rather than mislabels.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

// The learnerHome front door pulls the dashboard hook (and through it the
// Functions SDK); the page only needs the skeleton primitive.
vi.mock('../../learnerHome', async () => {
  const actual = await vi.importActual('../../learnerHome/components/LearnerPrimitives')
  return { SectionSkeleton: actual.SectionSkeleton }
})

let mockUser
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockUser }),
}))

let mockBadges
vi.mock('../../../utils/gameBadgesService', () => ({
  getMyGameBadges: () => Promise.resolve(mockBadges),
}))

import { GAME_BADGES } from '../../../data/gameBadges'
import StickerCollection from './StickerCollection'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/games/stickers']}>
      <StickerCollection />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUser = { uid: 'u1' }
  mockBadges = { byId: { 'first-game': { awardedAt: 1 } }, userId: 'u1' }
})

describe('StickerCollection', () => {
  it('renders every registry badge, earned from the badges doc', async () => {
    mount()
    expect(await screen.findByText(`🎁 1 of ${GAME_BADGES.length} collected — play games to unlock the rest!`)).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(GAME_BADGES.length)
    expect(items.filter((li) => li.className.includes('is-earned'))).toHaveLength(1)
  })

  it('an earned sticker shows its icon and description; a locked one its 🔒 and real hint', async () => {
    mount()
    await screen.findByText('First Game')
    const items = screen.getAllByRole('listitem')
    const earned = items.find((li) => li.className.includes('is-earned'))
    expect(earned.textContent).toContain('🌱')
    expect(earned.textContent).toContain('Played your very first learning game.')
    const locked = items.find((li) => li.className.includes('is-locked'))
    expect(locked.textContent).toContain('🔒')
    // The registry's own hint — an unlock the learner can actually perform.
    const hints = GAME_BADGES.map((b) => b.hint)
    expect(hints.some((h) => locked.textContent.includes(h))).toBe(true)
  })

  it('invites sign-in instead of claiming zero progress when signed out', async () => {
    mockUser = null
    mockBadges = { byId: {}, userId: null }
    mount()
    expect(await screen.findByText(/Sign in to start collecting/)).toBeInTheDocument()
    expect(screen.queryByText(/0 of/)).toBeNull()
  })
})
