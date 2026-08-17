/**
 * Go Premium — the promises this screen makes are the point, so they are
 * pinned: every price is read from the checkout catalogue (never typed
 * here), the "Best value" badge appears only on the cycle it is true of,
 * and the two prototype rows the owner ruled out — "No ads" and the
 * monthly-only read-aloud claim — never come back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { role: 'learner' }, currentUser: { uid: 'u1' } }),
}))

let mockSub
vi.mock('../../../hooks/useSubscription', () => ({
  useSubscription: () => mockSub,
}))

let lastModalProps
vi.mock('../../subscription', () => ({
  UpgradeModal: (props) => {
    lastModalProps = props
    return <div data-testid="upgrade-modal" />
  },
}))

import { PLANS } from '../../../engines/payment-engine/subscriptionConfig'
import PremiumPanel from './PremiumPanel'

const section = { id: 'premium', label: 'Premium' }

beforeEach(() => {
  mockSub = { tierLabel: 'Free', isPremium: false }
  lastModalProps = null
})

describe('PremiumPanel', () => {
  it('prices the card and passes from the checkout catalogue', () => {
    render(<PremiumPanel section={section} />)
    // Monthly is the default cycle.
    expect(screen.getByText(`K${PLANS.monthly.priceZMW}`)).toBeInTheDocument()
    expect(screen.getByText('per month')).toBeInTheDocument()
    expect(screen.getByText(`K${PLANS.day_pass.priceZMW}`)).toBeInTheDocument()
    expect(screen.getByText(`K${PLANS.term_pass.priceZMW}`)).toBeInTheDocument()
  })

  it('switches price and period when the cycle toggles to Weekly', () => {
    render(<PremiumPanel section={section} />)
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByText(`K${PLANS.weekly.priceZMW}`)).toBeInTheDocument()
    expect(screen.getByText('per week')).toBeInTheDocument()
  })

  it('shows "Best value" only on the cycle it is true of', () => {
    render(<PremiumPanel section={section} />)
    expect(screen.getByText('Best value')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    // Pinned to the Weekly price the badge would be a false claim.
    expect(screen.queryByText('Best value')).toBeNull()
  })

  it('never claims "No ads" or a paid read-aloud', () => {
    // ZedExams shows no ads on any plan, and the reader's Listen button is
    // free everywhere — both prototype rows were ruled out.
    render(<PremiumPanel section={section} />)
    expect(screen.queryByText(/no ads/i)).toBeNull()
    expect(screen.queryByText(/read aloud/i)).toBeNull()
  })

  it('opens the checkout pre-selected on the tapped plan', () => {
    render(<PremiumPanel section={section} />)
    fireEvent.click(screen.getByRole('button', { name: /Day pass/ }))
    expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument()
    expect(lastModalProps.defaultPlanId).toBe('day_pass')
    expect(lastModalProps.planIds).toContain('term_pass')
  })

  it('opens the checkout on the CTA with the toggled cycle', () => {
    render(<PremiumPanel section={section} />)
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    fireEvent.click(screen.getByRole('button', { name: /Get Premium/ }))
    expect(lastModalProps.defaultPlanId).toBe('weekly')
  })
})
