import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayUpgradePanel from './PlayUpgradePanel'
import {
  fetchPlayProducts,
  purchasePlaySubscription,
  verifyPlayPurchases,
  restorePlayPurchases,
  openPlaySubscriptionManagement,
} from '../../../utils/playBilling'

// The plugin wrapper is the only file importing @capgo/native-purchases —
// mock it wholesale so no Capacitor code loads in jsdom. classifyPurchaseError
// mirrors the real message buckets (see playBilling.js).
vi.mock('../../../utils/playBilling', () => ({
  fetchPlayProducts: vi.fn(),
  purchasePlaySubscription: vi.fn(),
  verifyPlayPurchases: vi.fn(),
  restorePlayPurchases: vi.fn(),
  openPlaySubscriptionManagement: vi.fn(),
  classifyPurchaseError: (err) => {
    const msg = String(err?.message || err || '')
    if (/pending/i.test(msg)) return 'pending'
    if (/not purchased/i.test(msg)) return 'not-completed'
    return 'unknown'
  },
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
import { capture } from '../../../utils/analytics'

let mockProfile = null
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: mockProfile, currentUser: { uid: 'u1' } }),
}))

const FUTURE = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString()

const PRODUCTS = [
  { planId: 'weekly', productId: 'learner_premium_weekly', priceString: '$0.99', price: 0.99, title: 'Weekly' },
  { planId: 'monthly', productId: 'learner_premium_monthly', priceString: '$2.99', price: 2.99, title: 'Monthly' },
]

function freeLearner() {
  return { role: 'learner', subscriptionPlan: 'free' }
}
function activePlayLearner() {
  return {
    role: 'learner',
    premium: true,
    subscriptionStatus: 'active',
    subscriptionPlan: 'monthly',
    subscriptionExpiry: FUTURE,
    subscriptionProvider: 'google_play',
    googlePlayProductId: 'learner_premium_monthly',
  }
}

function renderPanel(props = {}) {
  return render(
    <PlayUpgradePanel
      onClose={() => {}}
      portal="learner"
      planIds={['weekly', 'monthly']}
      defaultPlanId="monthly"
      {...props}
    />
  )
}

describe('PlayUpgradePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProfile = freeLearner()
    fetchPlayProducts.mockResolvedValue(PRODUCTS)
  })

  it('renders Google Play store prices, never the ZMW web prices', async () => {
    renderPanel()
    expect(await screen.findByText('$2.99')).toBeInTheDocument()
    expect(screen.getByText('$0.99')).toBeInTheDocument()
    expect(screen.getAllByText('via Google Play').length).toBeGreaterThan(0)
    // K15/K50 are the Lenco web prices for weekly/monthly — forbidden here.
    expect(screen.queryByText(/K15|K50/)).toBeNull()
    expect(screen.queryByText(/Secured by Lenco/i)).toBeNull()
    expect(screen.queryByText(/mobile money/i)).toBeNull()
  })

  it('purchase → verify → success', async () => {
    const user = userEvent.setup()
    purchasePlaySubscription.mockResolvedValue({
      productId: 'learner_premium_monthly',
      purchaseToken: 'tok-1',
    })
    verifyPlayPurchases.mockResolvedValue({
      results: [{ status: 'active', planId: 'monthly', productId: 'learner_premium_monthly', expiryTime: FUTURE }],
    })
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Subscribe with Google Play/i }))
    expect(await screen.findByText(/Subscription active/i)).toBeInTheDocument()
    // uid is threaded through so it's stamped as the obfuscated account id.
    expect(purchasePlaySubscription).toHaveBeenCalledWith('monthly', 'u1')
    expect(verifyPlayPurchases).toHaveBeenCalledWith({
      purchases: [{ productId: 'learner_premium_monthly', purchaseToken: 'tok-1' }],
      source: 'purchase',
    })
  })

  it('a not-completed purchase returns to the plans with a calm notice, not an error screen', async () => {
    const user = userEvent.setup()
    purchasePlaySubscription.mockRejectedValue(new Error('Purchase is not purchased'))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Subscribe with Google Play/i }))
    expect(await screen.findByText(/you have not been charged/i)).toBeInTheDocument()
    // still on the plans phase — the buy button is back
    expect(screen.getByRole('button', { name: /Subscribe with Google Play/i })).toBeInTheDocument()
    expect(verifyPlayPurchases).not.toHaveBeenCalled()
  })

  it('verify failure retries with the SAME token — never re-purchases', async () => {
    const user = userEvent.setup()
    purchasePlaySubscription.mockResolvedValue({
      productId: 'learner_premium_monthly',
      purchaseToken: 'tok-once',
    })
    verifyPlayPurchases
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ results: [{ status: 'active', planId: 'monthly', expiryTime: FUTURE }] })
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Subscribe with Google Play/i }))
    expect(await screen.findByText(/verification pending/i)).toBeInTheDocument()
    expect(screen.getByText(/won’t be charged again/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Retry verification/i }))
    expect(await screen.findByText(/Subscription active/i)).toBeInTheDocument()
    expect(purchasePlaySubscription).toHaveBeenCalledTimes(1)
    expect(verifyPlayPurchases).toHaveBeenCalledTimes(2)
    expect(verifyPlayPurchases.mock.calls[1][0].purchases[0].purchaseToken).toBe('tok-once')
  })

  it('a server CONFIG error is honest — "on our side" copy, reason captured, retry kept', async () => {
    const user = userEvent.setup()
    purchasePlaySubscription.mockResolvedValue({
      productId: 'learner_premium_monthly',
      purchaseToken: 'tok-cfg',
    })
    // What the callable throws when GOOGLE_PLAY_SA_JSON / Play Console
    // linkage is broken — retrying cannot succeed until an admin fixes it.
    const err = new Error('Purchase verification is not configured yet.')
    err.code = 'functions/failed-precondition'
    err.details = { reason: 'play-api-rejected' }
    verifyPlayPurchases.mockRejectedValue(err)
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Subscribe with Google Play/i }))
    expect(await screen.findByText(/we’re on it/i)).toBeInTheDocument()
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument()
    // no "tap retry and it'll work" promise for a config failure
    expect(screen.queryByText(/Tap retry/i)).toBeNull()
    // …but the button stays: it succeeds the moment the config is fixed
    expect(screen.getByRole('button', { name: /Retry verification/i })).toBeInTheDocument()
    // analytics can now tell config stages apart without a server-log dive
    expect(capture).toHaveBeenCalledWith('play_verify_failed', expect.objectContaining({
      errorCode: 'functions/failed-precondition',
      errorReason: 'play-api-rejected',
    }))
  })

  it('restore purchases verifies owned purchases', async () => {
    const user = userEvent.setup()
    restorePlayPurchases.mockResolvedValue([
      { productId: 'learner_premium_monthly', purchaseToken: 'tok-r' },
    ])
    verifyPlayPurchases.mockResolvedValue({
      results: [{ status: 'active', planId: 'monthly', expiryTime: FUTURE }],
    })
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /Restore purchases/i }))
    expect(await screen.findByText(/Subscription active/i)).toBeInTheDocument()
    expect(verifyPlayPurchases).toHaveBeenCalledWith({
      purchases: [{ productId: 'learner_premium_monthly', purchaseToken: 'tok-r' }],
      source: 'restore',
    })
  })

  it('grade-pack plan ids (no Play product) fall back to the learner pair', async () => {
    renderPanel({ planIds: ['grade7_monthly', 'grade7_termly'] })
    await waitFor(() => expect(fetchPlayProducts).toHaveBeenCalled())
    expect(fetchPlayProducts).toHaveBeenCalledWith(['weekly', 'monthly'])
  })

  it('an already-active subscriber gets the managed panel, not a second checkout', async () => {
    mockProfile = activePlayLearner()
    renderPanel()
    expect(await screen.findByText(/renews through Google Play/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Manage Google Play Subscription/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Subscribe with Google Play/i })).toBeNull()
    expect(fetchPlayProducts).not.toHaveBeenCalled()
  })

  it('a web-subscribed user is pointed back to zedexams.com, with no Play manage button', async () => {
    mockProfile = { ...activePlayLearner(), subscriptionProvider: 'lenco' }
    renderPanel()
    expect(await screen.findByText(/purchased on zedexams\.com/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Manage Google Play Subscription/i })).toBeNull()
    expect(openPlaySubscriptionManagement).not.toHaveBeenCalled()
  })
})
