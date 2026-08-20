/**
 * PremiumCard — the Premium tile on the learner settings dashboard.
 *
 * This card had no spec at all while carrying a purchase CTA on a child's
 * screen. zedexams.com/child-safety promises an unapproved under-18 learner no
 * purchases, and `mayShowPrice` is the shared, fail-closed predicate five other
 * surfaces already use — this one simply did not call it.
 *
 * What the card may still show a child: the CURRENT PLAN. That is a fact about
 * their account, not an offer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// DashboardCards is one module for every settings tile, so importing it pulls
// in the progress/a11y/theme chain — which reaches Firebase Functions at module
// scope. None of it is what this card renders, so it is all stubbed.
vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../lib/useProgressData', () => ({ default: () => ({ loading: false, data: null }) }))
vi.mock('../lib/useA11y', () => ({ useA11y: () => ({}), updateA11y: vi.fn() }))
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'default', setTheme: vi.fn() }),
  DEFAULT_THEME: 'default',
}))
vi.mock('./SaveContext', () => ({ useSettingsSave: () => ({ markDirty: vi.fn(), save: vi.fn() }) }))

let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: mockProfile, currentUser: { uid: 'u1' } }),
}))

let mockSub
vi.mock('../../../hooks/useSubscription', () => ({ useSubscription: () => mockSub }))

vi.mock('../../subscription', () => ({
  UpgradeModal: () => <div data-testid="upgrade-modal" />,
}))

const { PremiumCard } = await import('./DashboardCards')

describe('PremiumCard', () => {
  beforeEach(() => {
    // isMinor:false is what makes a fixture an adult — resolveAgeBand fails
    // closed, so silence about age means child.
    mockProfile = { role: 'learner', isMinor: false }
    mockSub = { tierLabel: 'Premium', isPremium: false }
  })

  it('offers the upgrade to an adult', () => {
    render(<PremiumCard onOpen={() => {}} />)
    expect(screen.getByText(/Upgrade Now/i)).toBeTruthy()
  })

  for (const [label, profile] of [
    ['a known minor', { role: 'learner', isMinor: true }],
    ['an unknown age (fails closed)', { role: 'learner' }],
    ['no profile at all', null],
  ]) {
    it(`shows no purchase CTA to ${label}`, () => {
      mockProfile = profile
      render(<PremiumCard onOpen={() => {}} />)
      expect(screen.queryByText(/Upgrade Now/i)).toBeNull()
      expect(screen.queryByTestId('upgrade-modal')).toBeNull()
      // The card is not blanked — it still says which plan they are on.
      expect(screen.getByText(/Current Plan/i)).toBeTruthy()
    })
  }

  it('still lets an adult on Premium manage their plan', () => {
    mockSub = { tierLabel: 'Premium', isPremium: true }
    render(<PremiumCard onOpen={() => {}} />)
    expect(screen.getByText(/Manage plan/i)).toBeTruthy()
  })
})
