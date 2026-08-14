import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import LockedFeatureModal from './LockedFeatureModal'
import { lockedFeature } from '../lib/lockedFeature'
import { useAuth } from '../../../contexts/AuthContext'
import { capture } from '../../../utils/analytics'

// LockedFeatureModal is popup #1 — "Feature Locked" — shown the moment a Free /
// Expired user taps a Premium feature. Two behaviours matter most: it must
// NEVER nag a user who actually has access (a stale trigger after an upgrade
// must close silently), and tapping upgrade must fire the funnel event and
// swap in checkout. It's driven by the real lockedFeature bus and the real
// subscriptionStatus resolver (so the shouldRemind gate is genuinely
// exercised); only the presentational children + side-effects are mocked.

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
vi.mock('./UpgradeModal', () => ({
  default: (props) => <div data-testid="upgrade-modal" data-plan={props.defaultPlanId} />,
}))
// Presentational bits — render simple markers so we can assert selection wiring
// without pulling in the pricing config.
vi.mock('./PremiumUpgradeUI', () => ({
  BenefitChecklist: ({ items }) => <ul data-testid="benefits">{items.join('|')}</ul>,
  PlanPricingCards: ({ onSelect, popularPlanId }) => (
    <button data-testid="plan-card" onClick={() => onSelect(popularPlanId)}>plan</button>
  ),
  TrustRow: () => <div data-testid="trust" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  act(() => lockedFeature.hide()) // reset the shared singleton
  useAuth.mockReturnValue({ userProfile: { role: 'learner' } }) // free learner
})

describe('LockedFeatureModal — visibility', () => {
  it('renders nothing until the bus fires', () => {
    render(<LockedFeatureModal />)
    expect(screen.queryByText(/Premium Feature/)).not.toBeInTheDocument()
  })

  it('shows the popup for a free learner when triggered', () => {
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Exam mode' }))
    expect(screen.getByText(/Premium Feature/)).toBeInTheDocument()
    // Feature-specific hero copy.
    expect(screen.getByText(/Exam mode is part of Premium/)).toBeInTheDocument()
  })

  it('self-hides for a user who already has access (never nag a paying member)', () => {
    // Active premium learner → resolveSubscriptionStatus.shouldRemind === false.
    useAuth.mockReturnValue({
      userProfile: {
        role: 'learner',
        isPremium: true,
        subscriptionPlan: 'pro_monthly',
        subscriptionExpiry: new Date(Date.now() + 30 * 864e5),
      },
    })
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Exam mode' }))
    expect(screen.queryByText(/Premium Feature/)).not.toBeInTheDocument()
  })

  it('shows generic copy when no feature name is given', () => {
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show())
    expect(screen.getByText(/Unlock unlimited access/)).toBeInTheDocument()
  })
})

describe('LockedFeatureModal — audience-specific benefits', () => {
  it('shows teacher benefits when the audience resolves to teacher', () => {
    useAuth.mockReturnValue({ userProfile: { role: 'teacher' } })
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Assessments', audience: 'teacher' }))
    expect(screen.getByTestId('benefits').textContent).toMatch(/lesson plans/i)
  })

  it('shows learner benefits for a learner', () => {
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Past papers' }))
    expect(screen.getByTestId('benefits').textContent).toMatch(/Unlimited quizzes/)
  })
})

describe('LockedFeatureModal — upgrade + dismiss', () => {
  it('fires the funnel event and swaps in checkout on the primary CTA', async () => {
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Exam mode' }))

    fireEvent.click(screen.getByText(/Upgrade to Premium/))
    expect(capture).toHaveBeenCalledWith('paywall_upgrade_clicked', expect.objectContaining({
      reason: 'feature-locked',
      feature: 'Exam mode',
      via: 'primary',
    }))
    // UpgradeModal is lazy — findBy waits for the dynamic import to resolve.
    expect(await screen.findByTestId('upgrade-modal')).toBeInTheDocument()
  })

  it('records via "plan-card" when a pricing card is chosen', async () => {
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Exam mode' }))
    fireEvent.click(screen.getByTestId('plan-card'))
    expect(capture).toHaveBeenCalledWith('paywall_upgrade_clicked', expect.objectContaining({
      via: 'plan-card',
    }))
    expect(await screen.findByTestId('upgrade-modal')).toBeInTheDocument()
  })

  it('closes on "Maybe Later"', () => {
    render(<LockedFeatureModal />)
    act(() => lockedFeature.show({ feature: 'Exam mode' }))
    fireEvent.click(screen.getByText(/Maybe Later/))
    expect(screen.queryByText(/Premium Feature/)).not.toBeInTheDocument()
  })
})
