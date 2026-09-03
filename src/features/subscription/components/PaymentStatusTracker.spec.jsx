import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaymentStatusTracker from './PaymentStatusTracker'

// Presentational contract of the pending-payment lifecycle: waiting
// ("Check your phone") → verifying → timeout, plus the cancel-confirmation
// gate that warns an approved prompt cannot be reversed by closing.

const BASE = {
  stage: 'waiting',
  timedOut: false,
  checking: false,
  phoneDisplay: '0977 740 465',
  reference: 'pay_abc123',
  operatorLabel: 'Airtel Money',
  amountZMW: 57,
}

function renderTracker(overrides = {}) {
  const handlers = {
    onApproved: vi.fn(),
    onCheckStatus: vi.fn(),
    onCancelPayment: vi.fn(),
  }
  render(<PaymentStatusTracker {...BASE} {...handlers} {...overrides} />)
  return handlers
}

describe('PaymentStatusTracker — waiting (check your phone)', () => {
  it('shows the number, reference, network, amount and waiting status', () => {
    renderTracker()
    expect(screen.getByText('Check your phone')).toBeInTheDocument()
    expect(screen.getByText('0977 740 465')).toBeInTheDocument()
    expect(screen.getByText(/mobile-money PIN/)).toBeInTheDocument()
    expect(screen.getByText('pay_abc123')).toBeInTheDocument()
    expect(screen.getByText('Airtel Money')).toBeInTheDocument()
    expect(screen.getByText('K57')).toBeInTheDocument()
    expect(screen.getByText('Waiting for approval', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText(/Secure payments by Lenco/)).toBeInTheDocument()
    // Auto-verification is stated — the button is not the confirmation path.
    expect(screen.getByText(/We confirm automatically/)).toBeInTheDocument()
  })

  it('advances the visual stage via "I have approved"', () => {
    const h = renderTracker()
    fireEvent.click(screen.getByRole('button', { name: 'I have approved' }))
    expect(h.onApproved).toHaveBeenCalledTimes(1)
  })
})

describe('PaymentStatusTracker — pay-offline (no automatic prompt for this network)', () => {
  it('says the phone will not receive a prompt, and shows Lenco\'s own instructions', () => {
    renderTracker({ payOffline: true, instructions: 'Dial *115# and choose Pay Bill, then enter merchant code 4521.' })
    expect(screen.getByText('Complete the payment on your phone')).toBeInTheDocument()
    expect(screen.getByText(/will not receive an automatic PIN prompt/)).toBeInTheDocument()
    expect(screen.getByText(/Dial \*115# and choose Pay Bill/)).toBeInTheDocument()
    expect(screen.getByText('Waiting for you to pay', { selector: 'dd' })).toBeInTheDocument()
    // The misleading "Check your phone" / "prompt has been sent" copy must
    // not appear alongside this — nothing was sent.
    expect(screen.queryByText('Check your phone')).toBeNull()
    expect(screen.queryByText(/A payment prompt has been sent/)).toBeNull()
  })

  it('falls back to generic self-service instructions when Lenco sent none', () => {
    renderTracker({ payOffline: true, instructions: '' })
    expect(screen.getByText(/dial your network.s mobile money menu/i)).toBeInTheDocument()
  })

  it('"I have paid" advances the visual stage, same as the pushed-prompt flow', () => {
    const h = renderTracker({ payOffline: true })
    fireEvent.click(screen.getByRole('button', { name: 'I have paid' }))
    expect(h.onApproved).toHaveBeenCalledTimes(1)
  })

  it('defers to the verifying screen once approved, even though payOffline is still true', () => {
    renderTracker({ payOffline: true, stage: 'verifying' })
    expect(screen.getByText('Verifying your payment')).toBeInTheDocument()
    expect(screen.queryByText('Complete the payment on your phone')).toBeNull()
  })

  it('defers to the timeout screen once the poll window elapses', () => {
    renderTracker({ payOffline: true, timedOut: true })
    expect(screen.getByText(/still waiting for confirmation/i)).toBeInTheDocument()
    expect(screen.queryByText('Complete the payment on your phone')).toBeNull()
  })
})

describe('PaymentStatusTracker — verifying', () => {
  it('shows the progress timeline and the do-not-close warning', () => {
    renderTracker({ stage: 'verifying' })
    expect(screen.getByText('Verifying your payment')).toBeInTheDocument()
    expect(screen.getByText(/usually takes a few seconds/)).toBeInTheDocument()
    expect(screen.getByText('Payment request sent')).toBeInTheDocument()
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('Verifying payment')).toBeInTheDocument()
    expect(screen.getByText(/do not close this window/i)).toBeInTheDocument()
  })

  it('conveys step state in text, not colour alone', () => {
    renderTracker({ stage: 'verifying' })
    expect(screen.getAllByText(/— completed/).length).toBe(2)
    expect(screen.getAllByText(/— in progress/).length).toBe(1)
  })
})

describe('PaymentStatusTracker — timeout', () => {
  it('warns against a second payment and offers a status re-check', () => {
    const h = renderTracker({ timedOut: true })
    expect(screen.getByText(/still waiting for confirmation/i)).toBeInTheDocument()
    expect(screen.getByText(/Do not make another payment yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }))
    expect(h.onCheckStatus).toHaveBeenCalledTimes(1)
  })

  it('offers support contacts and disables re-check while checking', () => {
    renderTracker({ timedOut: true, checking: true })
    expect(screen.getByRole('link', { name: /Email support/ })).toHaveAttribute('href', 'mailto:support@zedexams.com')
    expect(screen.getByRole('link', { name: /WhatsApp us/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Checking…/ })).toBeDisabled()
  })
})

describe('PaymentStatusTracker — cancel confirmation', () => {
  it('warns before cancelling and lets the buyer keep waiting', () => {
    const h = renderTracker()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' }))
    expect(screen.getByText(/will not automatically reverse a payment already approved/)).toBeInTheDocument()
    expect(h.onCancelPayment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }))
    expect(screen.getByText('Check your phone')).toBeInTheDocument()
  })

  it('cancels only after explicit confirmation', () => {
    const h = renderTracker()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' })) // the confirm button
    expect(h.onCancelPayment).toHaveBeenCalledTimes(1)
  })
})
