import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UpgradeModal from './UpgradeModal'
import { isNativePlatform } from '../../../utils/runtime'

// The regression lock for the platform dispatcher: on web the Lenco checkout
// renders byte-for-byte as before; inside the Capacitor Android shell the
// Google Play panel renders instead and NO mobile-money surface exists.

vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
// Marker for the lazy native branch — the real panel is covered by its own spec.
vi.mock('./PlayUpgradePanel', () => ({
  default: () => <div data-testid="play-upgrade-panel" />,
}))
// The Lenco client + invoice reader reach for firebase/config at import
// time — stub them.
vi.mock('../../../utils/lenco', () => ({
  OPERATORS: [],
  initiateLencoPayment: vi.fn(),
  submitLencoOtp: vi.fn(),
  pollLencoStatus: vi.fn(),
  getUpgradeQuote: vi.fn(async () => ({})),
  looksLikeZambianPhone: () => false,
  resolveOperator: () => '',
}))
vi.mock('../../../utils/invoices', () => ({ resolveInvoicePdfUrl: vi.fn(async () => null) }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { role: 'learner', subscriptionPlan: 'free', referralCredits: 0 },
    currentUser: { uid: 'u1', email: 'l@x.zm' },
  }),
}))

describe('UpgradeModal platform dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('web renders the existing Lenco mobile-money checkout', async () => {
    isNativePlatform.mockReturnValue(false)
    render(<MemoryRouter><UpgradeModal onClose={() => {}} portal="learner" planIds={['weekly', 'monthly']} /></MemoryRouter>)
    // Plans step of the Lenco flow, with its mobile-money promise + ZMW price.
    expect(await screen.findByText(/Secure payments with Lenco Mobile Money/i)).toBeInTheDocument()
    expect(screen.getByText('K50')).toBeInTheDocument()
    expect(screen.queryByTestId('play-upgrade-panel')).toBeNull()
  })

  it('native renders the Google Play panel and zero Lenco/mobile-money UI', async () => {
    isNativePlatform.mockReturnValue(true)
    render(<MemoryRouter><UpgradeModal onClose={() => {}} portal="learner" planIds={['weekly', 'monthly']} /></MemoryRouter>)
    expect(await screen.findByTestId('play-upgrade-panel')).toBeInTheDocument()
    expect(screen.queryByText(/Mobile Money/i)).toBeNull()
    expect(screen.queryByText(/Secured by Lenco/i)).toBeNull()
    expect(screen.queryByText('K50')).toBeNull()
    expect(document.querySelector('input[type="tel"]')).toBeNull()
  })
})
