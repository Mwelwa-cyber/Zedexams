import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UpgradeModal from './UpgradeModal'
import { getUpgradeQuote, initiateLencoPayment } from '../../utils/lenco'
import { capture } from '../../utils/analytics'

// Behaviour contract of the Lenco checkout step (Phase 3 payment-window
// redesign): the server quote drives the displayed amount, Pay stays disabled
// until a valid number + supported network, the number formats as you type,
// the initiation payload carries bare digits + the displayed amount, and a
// server 'quote-changed' rejection refreshes the price instead of failing.

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { email: 'teacher@example.zm' },
    currentUser: { email: 'teacher@example.zm' },
  }),
}))
vi.mock('../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: true }),
}))

// utils/lenco imports firebase/config, so the module is mocked wholesale —
// the pure phone/operator helpers are reimplemented verbatim (same ZICTA
// prefixes as the real module) and the callables become spies.
vi.mock('../../utils/lenco', () => {
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

  it('flags an unsupported prefix and enables Pay only after a manual network choice', async () => {
    openCheckout()
    await waitFor(() => expect(getUpgradeQuote).toHaveBeenCalled())
    fireEvent.change(phoneInput(), { target: { value: '0881234567' } })
    expect(screen.getByText(/could not detect a supported mobile-money network/i)).toBeInTheDocument()
    expect(payButton()).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mtn' } })
    expect(payButton()).not.toBeDisabled()
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
