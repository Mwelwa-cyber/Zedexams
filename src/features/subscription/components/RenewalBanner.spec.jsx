import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RenewalBanner from './RenewalBanner'
import { useAuth } from '../../../contexts/AuthContext'
import { daysUntilExpiry } from '../../../engines/payment-engine/subscriptionConfig'
import { isNativePlatform } from '../../../utils/runtime'

// RenewalBanner is the soft renewal nudge shown to learners within 7 days of
// expiry. The logic that matters: it only shows inside the 7-day window (and
// never once expired or renewed), it escalates tone as expiry nears, and it
// dismisses per session keyed on the expiry timestamp (so a renewal that moves
// expiry forward re-shows it). useAuth + the platform flag are mocked;
// daysUntilExpiry is mocked for deterministic windows while the real PLANS
// config supplies the plan name/price.

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
vi.mock('../../../engines/payment-engine/subscriptionConfig', async (importActual) => {
  const actual = await importActual()
  return { ...actual, daysUntilExpiry: vi.fn() }
})

const expiry = new Date('2026-08-01T00:00:00Z')

function setProfile(overrides = {}) {
  useAuth.mockReturnValue({
    userProfile: { subscriptionPlan: 'monthly', subscriptionExpiry: expiry, ...overrides },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  try { sessionStorage.clear() } catch { /* jsdom */ }
  isNativePlatform.mockReturnValue(false)
  setProfile()
})

describe('RenewalBanner — visibility window', () => {
  it('renders nothing when there is no expiry (daysLeft null)', () => {
    daysUntilExpiry.mockReturnValue(null)
    const { container } = render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing more than 7 days out', () => {
    daysUntilExpiry.mockReturnValue(8)
    const { container } = render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once already expired (daysLeft <= 0)', () => {
    daysUntilExpiry.mockReturnValue(0)
    const { container } = render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the nudge inside the window with the plan name', () => {
    daysUntilExpiry.mockReturnValue(5)
    render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(screen.getByText(/Monthly expires in 5 days/)).toBeInTheDocument()
  })
})

describe('RenewalBanner — tone escalation', () => {
  it('says "expires today" with "Renew now" at 1 day', () => {
    daysUntilExpiry.mockReturnValue(1)
    render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(screen.getByText(/Monthly expires today/)).toBeInTheDocument()
    expect(screen.getByText('Renew now')).toBeInTheDocument()
  })

  it('uses "Renew now" in the urgent (<=3 day) band', () => {
    daysUntilExpiry.mockReturnValue(3)
    render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(screen.getByText(/expires in 3 days/)).toBeInTheDocument()
    expect(screen.getByText('Renew now')).toBeInTheDocument()
  })

  it('uses the softer "Renew" label further out', () => {
    daysUntilExpiry.mockReturnValue(6)
    render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(screen.getByText('Renew')).toBeInTheDocument()
  })
})

describe('RenewalBanner — copy + actions', () => {
  it('shows the Mobile Money top-up price on web', () => {
    daysUntilExpiry.mockReturnValue(4)
    render(<RenewalBanner onRenewClick={vi.fn()} />)
    // monthly.priceZMW === 50
    expect(screen.getByText(/Top up K50 via Mobile Money/)).toBeInTheDocument()
  })

  it('omits the ZMW price on native', () => {
    isNativePlatform.mockReturnValue(true)
    daysUntilExpiry.mockReturnValue(4)
    render(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(screen.queryByText(/K50/)).not.toBeInTheDocument()
    expect(screen.getByText(/Renew your plan to keep your access/)).toBeInTheDocument()
  })

  it('fires onRenewClick from the renew button', () => {
    const onRenewClick = vi.fn()
    daysUntilExpiry.mockReturnValue(2)
    render(<RenewalBanner onRenewClick={onRenewClick} />)
    fireEvent.click(screen.getByText('Renew now'))
    expect(onRenewClick).toHaveBeenCalledTimes(1)
  })

  it('dismisses for the session and self-suppresses on the next render', () => {
    daysUntilExpiry.mockReturnValue(5)
    const { rerender } = render(<RenewalBanner onRenewClick={vi.fn()} />)
    fireEvent.click(screen.getByText('Later'))
    expect(screen.queryByText(/Monthly expires/)).not.toBeInTheDocument()

    // A fresh mount in the same session stays suppressed (keyed on expiry).
    rerender(<RenewalBanner onRenewClick={vi.fn()} />)
    expect(screen.queryByText(/Monthly expires/)).not.toBeInTheDocument()
  })
})
