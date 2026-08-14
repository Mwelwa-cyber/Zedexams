import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PlanUsageCard from './PlanUsageCard'
import { capture } from '../../../utils/analytics'

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
// The lazy-loaded full breakdown pulls in Firebase hooks — stub it.
vi.mock('./UsageMeter', () => ({ default: () => <div data-testid="usage-meter" /> }))

function usage(overrides = {}) {
  return {
    plan: 'max',
    planLabel: 'Max',
    used: {},
    caps: {},
    credits: 0,
    daily: 30,
    today: 0,
    resetDays: 12,
    ...overrides,
  }
}

function renderCard(props) {
  return render(
    <MemoryRouter>
      <PlanUsageCard {...props} />
    </MemoryRouter>,
  )
}

describe('PlanUsageCard', () => {
  it('shows an accessible skeleton while loading', () => {
    renderCard({ loading: true, usage: null })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('Max plan: full allowance remaining, reset countdown, Manage plan', () => {
    renderCard({ loading: false, usage: usage() })
    expect(screen.getByText(/max plan/i)).toBeInTheDocument()
    // The remaining count renders twice on purpose: inside the ring gauge
    // and as the headline figure.
    expect(screen.getAllByText('30')).toHaveLength(2)
    expect(screen.getByText('of 30')).toBeInTheDocument()
    expect(screen.getByText(/ai generations remaining today/i)).toBeInTheDocument()
    // Countdown + the exact reset time converted to the device's local
    // clock (the server boundary is UTC midnight ≈ 02:00 in Zambia) —
    // and never the word "midnight".
    expect(screen.getByText(/resets in .+ · at \d{2}:\d{2} local time/i)).toBeInTheDocument()
    expect(screen.queryByText(/midnight/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manage plan/i })).toHaveAttribute('href', '/teacher/subscription')
    expect(screen.queryByRole('link', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  it('Free plan: remaining count, Upgrade action, top-up credits shown', () => {
    renderCard({ loading: false, usage: usage({ plan: 'free', planLabel: 'Free', daily: 2, today: 1, credits: 3 }) })
    expect(screen.getByText(/free plan/i)).toBeInTheDocument()
    expect(screen.getAllByText('1')).toHaveLength(2)
    expect(screen.getByText('of 2')).toBeInTheDocument()
    expect(screen.getByText(/3 top-up credits/i)).toBeInTheDocument()
    const upgrade = screen.getByRole('link', { name: /upgrade/i })
    expect(upgrade).toHaveAttribute('href', '/teacher/subscription')
    fireEvent.click(upgrade)
    expect(capture).toHaveBeenCalledWith('plan_upgrade_clicked', expect.objectContaining({ source: 'dashboard-plan-card' }))
  })

  it('admin sentinel caps read as Unlimited', () => {
    renderCard({ loading: false, usage: usage({ planLabel: 'Admin', daily: 99999 }) })
    expect(screen.getByText('Unlimited')).toBeInTheDocument()
  })

  it('View details lazily expands the full breakdown and announces state', async () => {
    renderCard({ loading: false, usage: usage() })
    const toggle = screen.getByRole('button', { name: /view details/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(capture).toHaveBeenCalledWith('usage_details_expanded', { placement: 'dashboard-bottom' })
    expect(await screen.findByTestId('usage-meter')).toBeInTheDocument()
  })
})
