/**
 * /family/plan renders a different RAIL on each platform, and this suite
 * exists because the difference is a compliance boundary rather than a
 * styling one.
 *
 * On the web a guardian pays through Lenco: mobile-money networks, a
 * phone number, and our own ZMW prices. Inside the Android app every one
 * of those is a Google Play policy violation — digital subscriptions must
 * sell through Play Billing, the price shown must be Play's, and no copy
 * may steer a buyer to another payment method.
 *
 * The trap this catches: the branch is easy to write as "swap the pay
 * button" and leave the plan CARDS printing `K{priceZMW}` above it. That
 * renders a native screen quoting our price over a Play sheet charging
 * Play's — which looks fine in review and is exactly what gets an app
 * rejected. So the assertion is about the whole rendered page, not the
 * button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'parent-1' } }),
}))

const isNativePlatform = vi.fn()
vi.mock('../../../utils/runtime', () => ({
  isNativePlatform: (...a) => isNativePlatform(...a),
}))

const childRow = {
  childUid: 'child-1', displayName: 'Mutinta Banda', firstName: 'Mutinta',
  role: 'owner', premium: false,
}
let children = [childRow]
vi.mock('../hooks/useGuardianChildren', () => ({
  default: () => ({ loading: false, error: null, children }),
}))

// The Play rail's own dependencies — this suite is about which rail
// renders, not about how either one behaves.
vi.mock('../../../utils/playBilling', () => ({
  fetchPlayProducts: vi.fn().mockResolvedValue([
    { planId: 'monthly', productId: 'learner_premium_monthly', priceString: 'ZMW 50.00', title: 'Monthly', renews: true, type: 'subs' },
  ]),
  purchasePlayProduct: vi.fn(),
  restorePlayPurchases: vi.fn().mockResolvedValue([]),
  verifyPlayPurchases: vi.fn(),
  classifyPurchaseError: () => 'unknown',
}))
vi.mock('../../../utils/lenco', () => ({
  OPERATORS: [
    { id: 'mtn', label: 'MTN MoMo' },
    { id: 'airtel', label: 'Airtel Money' },
  ],
  detectOperator: () => '',
  looksLikeZambianPhone: () => true,
  initiateLencoPayment: vi.fn(),
  pollLencoStatus: vi.fn(),
  submitLencoOtp: vi.fn(),
}))

import ParentPlan from './ParentPlan'

function renderPlan() {
  return render(<MemoryRouter><ParentPlan /></MemoryRouter>)
}

afterEach(() => {
  vi.clearAllMocks()
  children = [childRow]
})

describe('/family/plan — web (Lenco rail)', () => {
  beforeEach(() => { isNativePlatform.mockReturnValue(false) })

  // Anchored on the network picker rather than on a heading string. The
  // Lenco rail is the only one that asks which network to charge, so the
  // radiogroup identifies the rail; the heading above it is copy, and
  // pinning copy here made this spec fail when that copy was clarified.
  const mobileMoneyForm = () => screen.findByRole('radiogroup', { name: /network/i })

  it('shows our ZMW prices and the mobile-money form', async () => {
    const { container } = renderPlan()
    expect(await mobileMoneyForm()).toBeInTheDocument()
    expect(container.textContent).toMatch(/K50/)
  })

  it('does not load Google Play products', async () => {
    const { fetchPlayProducts } = await import('../../../utils/playBilling')
    renderPlan()
    await mobileMoneyForm()
    expect(fetchPlayProducts).not.toHaveBeenCalled()
  })
})

describe('/family/plan — Android (Play rail)', () => {
  beforeEach(() => { isNativePlatform.mockReturnValue(true) })

  it('renders the Play checkout instead of the mobile-money form', async () => {
    renderPlan()
    expect(await screen.findByText('ZMW 50.00')).toBeInTheDocument()
    expect(screen.queryByText('Pay with mobile money')).not.toBeInTheDocument()
  })

  it('prints no ZMW price of our own anywhere on the page', async () => {
    // The whole page, not just the checkout — the plan cards are the half
    // that is easy to leave behind when branching only the pay button.
    const { container } = renderPlan()
    await screen.findByText('ZMW 50.00')
    expect(container.textContent).not.toMatch(/K\d/)
  })

  it('offers no mobile-money network buttons', async () => {
    renderPlan()
    await screen.findByText('ZMW 50.00')
    expect(screen.queryByText('MTN MoMo')).not.toBeInTheDocument()
    expect(screen.queryByText('Airtel Money')).not.toBeInTheDocument()
  })

  it('never starts a Lenco payment', async () => {
    const { initiateLencoPayment } = await import('../../../utils/lenco')
    renderPlan()
    await screen.findByText('ZMW 50.00')
    await waitFor(() => expect(initiateLencoPayment).not.toHaveBeenCalled())
  })

  it('carries no steering copy', async () => {
    const { container } = renderPlan()
    await screen.findByText('ZMW 50.00')
    expect(container.textContent).not.toMatch(/lenco|mobile money|airtel|mtn|zamtel|on the web/i)
  })

  it('still lets the guardian choose which child they are paying for', async () => {
    // Choosing a child is rail-independent. If the native branch swallowed
    // it, a parent with two children could only ever pay for the first.
    renderPlan()
    expect(await screen.findByText(/For Mutinta/i)).toBeInTheDocument()
  })
})

describe('a household already paying on the other rail', () => {
  // The single most expensive failure in this whole feature: the rails
  // cannot see each other, so a Buy button shown to somebody already
  // paying is a second charge that nothing in either system notices — and
  // on Play it repeats every month, because a subscription renews itself.
  const covered = (provider, plan) => [{
    ...childRow,
    premium: true,
    premiumExpiresAt: Date.now() + 20 * 24 * 3600 * 1000,
    subscriptionProvider: provider,
    subscriptionPlan: plan,
  }]

  it('a Lenco payer opening Android sees status, not a Play checkout', async () => {
    isNativePlatform.mockReturnValue(true)
    children = covered('lenco', 'monthly')
    const { fetchPlayProducts } = await import('../../../utils/playBilling')
    renderPlan()
    expect(await screen.findByText(/Mutinta is on Premium/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /unlock for/i })).not.toBeInTheDocument()
    expect(fetchPlayProducts).not.toHaveBeenCalled()
  })

  it('a Play payer opening the web sees status, not a mobile-money form', async () => {
    isNativePlatform.mockReturnValue(false)
    children = covered('google_play', 'monthly')
    renderPlan()
    expect(await screen.findByText(/Mutinta is on Premium/i)).toBeInTheDocument()
    expect(screen.queryByText('Pay with mobile money')).not.toBeInTheDocument()
  })

  it('a Play payer on the web is not offered an in-app cancel', async () => {
    isNativePlatform.mockReturnValue(false)
    children = covered('google_play', 'monthly')
    renderPlan()
    await screen.findByText(/Mutinta is on Premium/i)
    expect(screen.getByRole('link', { name: /Manage in Google Play/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^cancel/i })).not.toBeInTheDocument()
  })
})
