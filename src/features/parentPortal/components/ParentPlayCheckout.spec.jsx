/**
 * Behaviour tests for the Android parent checkout.
 *
 * Three properties carry this component, and each is invisible from the
 * outside when it breaks:
 *
 *   1. **The purchase names the child.** `beneficiaryUid` must reach
 *      `verifyPlayPurchases`, or the server credits the payer and the
 *      parent gets a receipt while the child they chose stays locked —
 *      the same PAY-001 failure the web rail was built to fix.
 *   2. **No ZMW price is ever rendered.** Play sets the price on this
 *      rail; printing our own figure beside Play's is a policy problem
 *      and a promise we cannot keep.
 *   3. **No steering copy.** Nothing may mention Lenco, mobile money,
 *      Airtel, MTN, or the website. Anti-steering rules apply here.
 *
 * The first two are asserted directly. The third is asserted over the
 * component's whole rendered text, because a steering sentence is the
 * kind of thing that gets added to a notice string later without anyone
 * thinking of it as a payments change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))

const fetchPlayProducts = vi.fn()
const purchasePlayProduct = vi.fn()
const restorePlayPurchases = vi.fn()
const verifyPlayPurchases = vi.fn()
vi.mock('../../../utils/playBilling', () => ({
  fetchPlayProducts: (...a) => fetchPlayProducts(...a),
  purchasePlayProduct: (...a) => purchasePlayProduct(...a),
  restorePlayPurchases: (...a) => restorePlayPurchases(...a),
  verifyPlayPurchases: (...a) => verifyPlayPurchases(...a),
  classifyPurchaseError: (err) => (
    /not purchased/i.test(String(err?.message || '')) ? 'not-completed' : 'unknown'
  ),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'parent-1' } }),
}))

import ParentPlayCheckout from './ParentPlayCheckout'

// Play's own localized strings. Deliberately NOT "K50" — the point of the
// rail is that the store quotes the price, and a fixture that echoed our
// config would let a ZMW literal through the assertions below.
const PRODUCTS = [
  { planId: 'monthly', productId: 'learner_premium_monthly', priceString: 'ZMW 50.00', title: 'Monthly', renews: true, type: 'subs' },
  { planId: 'term_pass', productId: 'learner_premium_term_pass', priceString: 'ZMW 120.00', title: 'Term Pass', renews: false, type: 'inapp' },
]

function renderCheckout(props = {}) {
  return render(
    <ParentPlayCheckout
      childUid="child-1"
      childName="Mutinta"
      {...props}
    />,
  )
}

describe('ParentPlayCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchPlayProducts.mockResolvedValue(PRODUCTS)
    purchasePlayProduct.mockResolvedValue({
      productId: 'learner_premium_monthly', purchaseToken: 'tok-1',
    })
    verifyPlayPurchases.mockResolvedValue({
      results: [{ status: 'active', planId: 'monthly' }],
    })
    restorePlayPurchases.mockResolvedValue([])
  })

  it('offers the four learner rungs to Play, not just subscriptions', async () => {
    renderCheckout()
    await waitFor(() => expect(fetchPlayProducts).toHaveBeenCalled())
    expect(fetchPlayProducts).toHaveBeenCalledWith(['weekly', 'monthly', 'day_pass', 'term_pass'])
  })

  it('renders Play’s price string and never a ZMW literal of our own', async () => {
    const { container } = renderCheckout()
    await screen.findByText('ZMW 50.00')
    // K-prefixed figures are how the web screen prints our config prices.
    expect(container.textContent).not.toMatch(/K\d/)
  })

  it('says which plans renew and which do not', async () => {
    renderCheckout()
    expect(await screen.findByText('Renews automatically')).toBeInTheDocument()
    expect(screen.getByText('One-off — does not renew')).toBeInTheDocument()
  })

  it('sends beneficiaryUid so the child is credited, not the payer', async () => {
    renderCheckout({ guardianRequestId: 'req-7' })
    fireEvent.click(await screen.findByRole('button', { name: /unlock for Mutinta/i }))
    await waitFor(() => expect(verifyPlayPurchases).toHaveBeenCalled())
    expect(verifyPlayPurchases).toHaveBeenCalledWith({
      purchases: [{ productId: 'learner_premium_monthly', purchaseToken: 'tok-1' }],
      source: 'purchase',
      beneficiaryUid: 'child-1',
      guardianRequestId: 'req-7',
    })
  })

  it('binds the purchase to the PARENT’s uid, not the child’s', async () => {
    // Google records the buyer. Binding the child would make every
    // guardian purchase look like a cross-account replay to the server.
    renderCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /unlock for Mutinta/i }))
    await waitFor(() => expect(purchasePlayProduct).toHaveBeenCalled())
    expect(purchasePlayProduct).toHaveBeenCalledWith('monthly', 'parent-1')
  })

  it('confirms by naming the child that was unlocked', async () => {
    const onPaid = vi.fn()
    renderCheckout({ onPaid })
    fireEvent.click(await screen.findByRole('button', { name: /unlock for Mutinta/i }))
    expect(await screen.findByText(/Mutinta is unlocked/i)).toBeInTheDocument()
    expect(onPaid).toHaveBeenCalled()
  })

  it('a cancelled purchase is not reported as a charge', async () => {
    purchasePlayProduct.mockRejectedValue(new Error('Purchase is not purchased'))
    renderCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /unlock for Mutinta/i }))
    expect(await screen.findByText(/you have not been charged/i)).toBeInTheDocument()
    expect(verifyPlayPurchases).not.toHaveBeenCalled()
  })

  it('a restore names no child — it cannot know who each purchase was for', async () => {
    restorePlayPurchases.mockResolvedValue([
      { productId: 'learner_premium_monthly', purchaseToken: 'tok-old' },
    ])
    renderCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /Restore purchases/i }))
    await waitFor(() => expect(verifyPlayPurchases).toHaveBeenCalled())
    expect(verifyPlayPurchases).toHaveBeenCalledWith({
      purchases: [{ productId: 'learner_premium_monthly', purchaseToken: 'tok-old' }],
      source: 'restore',
    })
  })

  it('retrying a failed verification never re-launches the purchase sheet', async () => {
    verifyPlayPurchases
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ results: [{ status: 'active', planId: 'monthly' }] })
    renderCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /unlock for Mutinta/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }))
    await screen.findByText(/Mutinta is unlocked/i)
    // One charge, two verifications — the retry re-sends the token.
    expect(purchasePlayProduct).toHaveBeenCalledTimes(1)
    expect(verifyPlayPurchases).toHaveBeenCalledTimes(2)
  })

  it('a server config failure is not offered as something to retry', async () => {
    const err = new Error('config')
    err.code = 'functions/failed-precondition'
    verifyPlayPurchases.mockRejectedValue(err)
    renderCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /unlock for Mutinta/i }))
    await screen.findByText(/temporarily unavailable/i)
    expect(screen.queryByRole('button', { name: /Try again/i })).not.toBeInTheDocument()
  })

  it('contains no steering copy anywhere it renders', async () => {
    const { container } = renderCheckout()
    await screen.findByText('ZMW 50.00')
    const banned = /lenco|mobile money|airtel|mtn|zamtel|zedexams\.com|on the web|cheaper/i
    expect(container.textContent).not.toMatch(banned)
    // …and again once a purchase has completed, since the success panel is
    // a different subtree with its own copy.
    fireEvent.click(screen.getByRole('button', { name: /unlock for Mutinta/i }))
    await screen.findByText(/Mutinta is unlocked/i)
    expect(container.textContent).not.toMatch(banned)
  })
})
