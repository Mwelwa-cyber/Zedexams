import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UpgradeModal from './UpgradeModal'
import { getUpgradeQuote, initiateLencoPayment, pollLencoStatus } from '../../../utils/lenco'
import { resolveInvoicePdfUrl } from '../../../utils/invoices'
import { capture } from '../../../utils/analytics'
import { peekPremiumAction, rememberPremiumAction } from '../lib/pendingPremiumAction'

// The success screen navigates back to the interrupted studio — mock the
// router hooks so the spec doesn't need a <Router> around every render.
const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigateSpy,
  useLocation: () => ({ pathname: '/pricing', search: '' }),
}))
// utils/invoices imports firebase/config — stub the receipt-URL resolver.
vi.mock('../../../utils/invoices', () => ({ resolveInvoicePdfUrl: vi.fn(async () => null) }))

// Behaviour contract of the Lenco checkout step (Phase 3 payment-window
// redesign): the server quote drives the displayed amount, Pay stays disabled
// until a valid number + supported network, the number formats as you type,
// the initiation payload carries bare digits + the displayed amount, and a
// server 'quote-changed' rejection refreshes the price instead of failing.

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { email: 'teacher@example.zm' },
    currentUser: { uid: 'u1', email: 'teacher@example.zm' },
  }),
}))
vi.mock('../../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: true }),
}))

// utils/lenco imports firebase/config, so the module is mocked wholesale —
// the pure phone/operator helpers are reimplemented verbatim (same ZICTA
// prefixes as the real module) and the callables become spies.
vi.mock('../../../utils/lenco', () => {
  const OPERATORS = [
    { id: 'mtn', label: 'MTN MoMo', prefixes: ['096', '076'] },
    { id: 'airtel', label: 'Airtel Money', prefixes: ['097', '077'] },
    { id: 'zamtel', label: 'Zamtel Kwacha', prefixes: ['095', '075'] },
  ]
  const nat = (p) => {
    let d = String(p || '').replace(/\D/g, '')
    if (d.startsWith('260')) d = d.slice(3)
    if (d.length === 9 && /^[79]/.test(d)) d = '0' + d
    return d.length === 10 && d.startsWith('0') ? d : ''
  }
  const detectOperator = (p) => {
    const n = nat(p)
    if (!n) return null
    const prefix = n.slice(0, 3)
    return OPERATORS.find((o) => o.prefixes.includes(prefix))?.id || null
  }
  return {
    OPERATORS,
    TERMINAL_STATUSES: ['successful', 'failed'],
    PAY_OFFLINE_STATUS: 'pay-offline',
    detectOperator,
    looksLikeZambianPhone: (p) => nat(p) !== '',
    resolveOperator: ({ phone, operator, operatorTouched } = {}) =>
      (operatorTouched ? operator || '' : detectOperator(phone) || operator || ''),
    getUpgradeQuote: vi.fn(),
    initiateLencoPayment: vi.fn(),
    submitLencoOtp: vi.fn(),
    pollLencoStatus: vi.fn(async () => 'pending'),
    recoverMyPendingPayments: vi.fn(),
  }
})

const QUOTE = {
  planId: 'pro_monthly',
  currency: 'ZMW',
  amountZMW: 59,
  fullPriceZMW: 59,
  isUpgrade: false,
  daysRemaining: 0,
  renewalDate: '2026-08-12T00:00:00.000Z',
  quotedAt: '2026-07-13T12:00:00.000Z',
}

function openCheckout() {
  render(
    <UpgradeModal
      portal="teacher"
      planIds={['pro_monthly', 'pro_yearly']}
      defaultPlanId="pro_monthly"
      onClose={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Continue to Payment/i }))
}

const phoneInput = () => screen.getByPlaceholderText('0977 740 465')
const payButton = () => screen.getByRole('button', { name: /Pay K\d+/ })

describe('Lenco checkout step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    getUpgradeQuote.mockResolvedValue({ ...QUOTE })
  })

  it('fetches the server quote on entry and shows the confirmed renewal date', async () => {
    openCheckout()
    expect(getUpgradeQuote).toHaveBeenCalledWith('pro_monthly')
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
  })

  it('shows a price-confirmation state while the quote loads and a retry on failure', async () => {
    let reject
    getUpgradeQuote.mockImplementation(() => new Promise((_, rej) => { reject = rej }))
    openCheckout()
    expect(screen.getByText(/Confirming price…/)).toBeInTheDocument()
    reject(new Error('offline'))
    await waitFor(() => expect(screen.getByText(/could not confirm the price/i)).toBeInTheDocument())
    // Retry refetches
    getUpgradeQuote.mockResolvedValue({ ...QUOTE })
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
  })

  it('formats the number as you type and detects the network', async () => {
    openCheckout()
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    expect(phoneInput().value).toBe('0977 740 465')
    expect(screen.getByText('Airtel Money')).toBeInTheDocument()
  })

  it('keeps Pay disabled until the number is valid and a network is resolved', async () => {
    openCheckout()
    await waitFor(() => expect(getUpgradeQuote).toHaveBeenCalled())
    expect(payButton()).toBeDisabled()
    fireEvent.change(phoneInput(), { target: { value: '0123' } })
    expect(payButton()).toBeDisabled()
    expect(screen.getByText(/Enter a valid Zambian mobile number/)).toBeInTheDocument()
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    expect(payButton()).not.toBeDisabled()
  })

  it('submits bare digits, the operator and the displayed amount', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'pending' })
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '+260 977 740 465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(initiateLencoPayment).toHaveBeenCalledWith({
      planId: 'pro_monthly',
      method: 'mobile_money',
      phone: '0977740465',
      operator: 'airtel',
      expectedAmountZMW: 59,
    }))
  })

  it('recovers from a quote-changed rejection: new amount + notice, no failure screen', async () => {
    const err = new Error('The amount for this purchase has changed.')
    err.details = { code: 'quote-changed', amountZMW: 64, fullPriceZMW: 64, isUpgrade: false, daysRemaining: 0, renewalDate: '2026-08-12T00:00:00.000Z' }
    initiateLencoPayment.mockRejectedValue(err)
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/amount has been updated/i)).toBeInTheDocument())
    // Amount refreshed, checkout still usable — not the failed screen.
    expect(screen.getByRole('button', { name: /Pay K64/ })).toBeInTheDocument()
    expect(screen.queryByText(/Payment not completed/)).toBeNull()
    expect(capture).toHaveBeenCalledWith('lenco_quote_changed', { planId: 'pro_monthly' })
  })

  it('ignores a double-click on Pay: exactly one initiation request', async () => {
    let resolveInitiate
    initiateLencoPayment.mockImplementation(() => new Promise((res) => { resolveInitiate = res }))
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    const btn = payButton()
    fireEvent.click(btn)
    fireEvent.click(btn) // second tap while the first is in flight
    expect(initiateLencoPayment).toHaveBeenCalledTimes(1)
    // The button reflects the in-flight state and is disabled.
    expect(screen.getByRole('button', { name: /Starting…/ })).toBeDisabled()
    resolveInitiate({ paymentId: 'p1', status: 'pending' })
  })

  it('shows success (not a second charge) when the server reports already-paid', async () => {
    initiateLencoPayment.mockResolvedValue({
      paymentId: 'p0',
      status: 'successful',
      reused: true,
      alreadyPaid: true,
      amountZMW: 59,
    })
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/Payment successful!/)).toBeInTheDocument())
  })

  it('flags an unsupported prefix and enables Pay only after a manual network choice', async () => {
    openCheckout()
    await waitFor(() => expect(getUpgradeQuote).toHaveBeenCalled())
    fireEvent.change(phoneInput(), { target: { value: '0881234567' } })
    expect(screen.getByText(/could not detect a supported mobile-money network/i)).toBeInTheDocument()
    expect(payButton()).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mtn' } })
    expect(payButton()).not.toBeDisabled()
  })

  it('shows Check your phone (reference, network, amount) while the prompt is pending', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'pending' })
    pollLencoStatus.mockImplementation(() => new Promise(() => {})) // prompt stays live
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText('Check your phone')).toBeInTheDocument())
    expect(screen.getByText('0977 740 465')).toBeInTheDocument()
    expect(screen.getByText('p1')).toBeInTheDocument()
    expect(screen.getByText('Airtel Money')).toBeInTheDocument()
    expect(screen.getByText('K59', { selector: 'dd' })).toBeInTheDocument()
    expect(pollLencoStatus).toHaveBeenCalledWith('p1', expect.anything())
    // "I have approved" advances to the verifying view — verification itself
    // stays automatic (the poll keeps running).
    fireEvent.click(screen.getByRole('button', { name: 'I have approved' }))
    expect(screen.getByText('Verifying your payment')).toBeInTheDocument()
    expect(screen.getByText(/do not close this window/i)).toBeInTheDocument()
  })

  it('shows the pay-offline screen (not "Check your phone") when the network never pushes a prompt', async () => {
    initiateLencoPayment.mockResolvedValue({
      paymentId: 'p1',
      status: 'pay-offline',
      message: 'Dial *115# and choose Pay Bill, then enter merchant code 4521.',
    })
    pollLencoStatus.mockImplementation(() => new Promise(() => {})) // still pending
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText('Complete the payment on your phone')).toBeInTheDocument())
    expect(screen.getByText(/Dial \*115# and choose Pay Bill/)).toBeInTheDocument()
    expect(screen.queryByText('Check your phone')).toBeNull()
  })

  it('picks up a pay-offline status reported later, from the poll', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'pending' })
    let tick
    pollLencoStatus.mockImplementation((_ref, { onTick }) => {
      tick = onTick
      return new Promise(() => {})
    })
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText('Check your phone')).toBeInTheDocument())
    tick('pay-offline', 1, { message: 'Open the Airtel Money app and approve the pending request.' })
    await waitFor(() => expect(screen.getByText('Complete the payment on your phone')).toBeInTheDocument())
    expect(screen.getByText(/Open the Airtel Money app/)).toBeInTheDocument()
  })

  it('times out into "still waiting" and re-checks the SAME transaction only', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'pending' })
    pollLencoStatus.mockResolvedValue('pending') // poll window elapses
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/still waiting for confirmation/i)).toBeInTheDocument())
    expect(screen.getByText(/Do not make another payment yet/)).toBeInTheDocument()
    pollLencoStatus.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }))
    await waitFor(() => expect(pollLencoStatus).toHaveBeenCalledWith('p1', expect.anything()))
    // Re-check polls the existing reference — no new initiation.
    expect(initiateLencoPayment).toHaveBeenCalledTimes(1)
  })

  it('failed payment offers Try again, a different number, and Cancel — work preserved', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'pending' })
    pollLencoStatus.mockResolvedValue('failed')
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText('Payment was not completed')).toBeInTheDocument())
    expect(screen.getByText(/provider did not confirm the payment/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use a different number' }))
    // Back on the form with the number cleared, ready for a new attempt.
    expect(phoneInput().value).toBe('')
    expect(screen.getByRole('button', { name: /Pay K59/ })).toBeDisabled()
  })

  it('cancelling a pending payment warns first, then closes without a new charge', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'pending' })
    pollLencoStatus.mockImplementation(() => new Promise(() => {}))
    const onClose = vi.fn()
    render(
      <UpgradeModal portal="teacher" planIds={['pro_monthly']} defaultPlanId="pro_monthly" onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Continue to Payment/i }))
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText('Check your phone')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' }))
    expect(screen.getByText(/will not automatically reverse a payment already approved/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' })) // confirm
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(initiateLencoPayment).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('lenco_payment_cancelled', { planId: 'pro_monthly', via: 'pending-screen' })
  })

  it('success screen shows plan, amount, date, masked number and receipt confirmation', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'successful' })
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/Payment successful!/)).toBeInTheDocument())
    expect(screen.getByText(/Pro · Monthly plan is now active/)).toBeInTheDocument()
    expect(screen.getByText(/work has been preserved/)).toBeInTheDocument()
    expect(screen.getByText('K59', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('12 August 2026')).toBeInTheDocument()
    // Full number never shown on the receipt view — middle digits masked.
    expect(screen.getByText('0977 ••• 465')).toBeInTheDocument()
    expect(screen.getByText(/Receipt sent to/)).toBeInTheDocument()
    expect(screen.getByText('teacher@example.zm')).toBeInTheDocument()
  })

  it('Continue to my work returns to the interrupted studio and marks the action paid', async () => {
    rememberPremiumAction({ sourceRoute: '/teacher/generate/worksheet', tool: 'worksheet', reason: 'monthly-limit' })
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'successful' })
    const onClose = vi.fn()
    render(
      <UpgradeModal portal="teacher" planIds={['pro_monthly']} defaultPlanId="pro_monthly" onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Continue to Payment/i }))
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/Payment successful!/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Continue to my work' }))
    expect(navigateSpy).toHaveBeenCalledWith('/teacher/generate/worksheet')
    expect(onClose).toHaveBeenCalledTimes(1)
    // The record survives as 'paid' so the studio's continuation card can
    // offer the next step — that card (not the checkout) consumes it.
    expect(peekPremiumAction()).toMatchObject({ status: 'paid', tool: 'worksheet' })
    expect(capture).toHaveBeenCalledWith('paywall_return_to_work', {
      tool: 'worksheet',
      reason: 'monthly-limit',
      navigated: true,
    })
  })

  it('Continue with no pending action just closes in place (studio still mounted behind)', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'successful' })
    const onClose = vi.fn()
    render(
      <UpgradeModal portal="teacher" planIds={['pro_monthly']} defaultPlanId="pro_monthly" onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Continue to Payment/i }))
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/Payment successful!/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Continue to my work' }))
    expect(navigateSpy).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('View receipt opens the PDF when ready, or explains it is on its way', async () => {
    initiateLencoPayment.mockResolvedValue({ paymentId: 'p1', status: 'successful' })
    openCheckout()
    await waitFor(() => expect(screen.getByText(/until 12 August 2026/)).toBeInTheDocument())
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    fireEvent.click(payButton())
    await waitFor(() => expect(screen.getByText(/Payment successful!/)).toBeInTheDocument())
    // Not generated yet → reassurance, no crash.
    resolveInvoicePdfUrl.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }))
    await waitFor(() => expect(screen.getByText(/still being prepared/)).toBeInTheDocument())
    // Ready → opens in a new tab from the owner-scoped Storage path.
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    resolveInvoicePdfUrl.mockResolvedValueOnce('https://storage.example/receipt.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }))
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://storage.example/receipt.pdf', '_blank', 'noopener'))
    expect(resolveInvoicePdfUrl).toHaveBeenCalledWith('invoices/u1/p1.pdf')
    openSpy.mockRestore()
  })

  it('captures number-entered and network-detected funnel events without the number', async () => {
    openCheckout()
    fireEvent.change(phoneInput(), { target: { value: '0977740465' } })
    await waitFor(() => expect(capture).toHaveBeenCalledWith('lenco_number_entered', { planId: 'pro_monthly' }))
    expect(capture).toHaveBeenCalledWith('lenco_network_detected', { planId: 'pro_monthly', operator: 'airtel' })
    const payloads = capture.mock.calls.map(([, props]) => JSON.stringify(props || {}))
    expect(payloads.some((p) => p.includes('0977'))).toBe(false)
  })
})
