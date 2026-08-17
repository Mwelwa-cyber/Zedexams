/**
 * Behaviour tests for the guardian checkout.
 *
 * One property matters more than the rest: **every initiation carries
 * `beneficiaryUid`**. Without it the server credits the payer, which is
 * the bug this whole path exists to fix (PAY-001) — and it is invisible
 * from the parent's side, because the payment succeeds and the receipt
 * arrives. Only the child stays locked.
 *
 * The others are about not lying to somebody who has just moved money: a
 * failed POLL is not a failed payment, and the confirmation names the
 * account that was actually unlocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
// lenco.js builds its callables at module load. The real module is imported
// below (for `detectOperator`/`looksLikeZambianPhone`, which are pure and
// which this component's validation genuinely depends on), so the Functions
// SDK has to be inert rather than absent.
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn(),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))

const initiateLencoPayment = vi.fn()
const pollLencoStatus = vi.fn()
vi.mock('../../../utils/lenco', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    initiateLencoPayment: (...a) => initiateLencoPayment(...a),
    pollLencoStatus: (...a) => pollLencoStatus(...a),
    submitLencoOtp: vi.fn(() => Promise.resolve({})),
  }
})

import GuardianCheckout from './GuardianCheckout'

const plan = { id: 'monthly', name: 'Monthly', priceZMW: 50, features: [] }

function renderCheckout(props = {}) {
  return render(
    <GuardianCheckout
      plan={plan}
      childUid="kid-1"
      childName="Milton"
      {...props}
    />,
  )
}

const typeNumber = () => {
  fireEvent.change(screen.getByLabelText(/mobile money number/i), {
    target: { value: '0977740465' },
  })
}

describe('GuardianCheckout', () => {
  beforeEach(() => {
    initiateLencoPayment.mockReset()
    initiateLencoPayment.mockResolvedValue({ paymentId: 'pay1', requiresOtp: false })
    pollLencoStatus.mockReset()
    pollLencoStatus.mockResolvedValue({ status: 'successful' })
  })

  it('ALWAYS sends beneficiaryUid — without it the parent is credited', async () => {
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))

    await waitFor(() => expect(initiateLencoPayment).toHaveBeenCalled())
    expect(initiateLencoPayment.mock.calls[0][0]).toMatchObject({
      beneficiaryUid: 'kid-1',
      planId: 'monthly',
    })
  })

  it('carries the request id when a child’s ask prompted the payment', async () => {
    renderCheckout({ guardianRequestId: 'req-9' })
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    await waitFor(() => expect(initiateLencoPayment).toHaveBeenCalled())
    expect(initiateLencoPayment.mock.calls[0][0].guardianRequestId).toBe('req-9')
  })

  it('omits the request id entirely when there is none', async () => {
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    await waitFor(() => expect(initiateLencoPayment).toHaveBeenCalled())
    expect('guardianRequestId' in initiateLencoPayment.mock.calls[0][0]).toBe(false)
  })

  it('says whose account the money unlocks, before and after', async () => {
    renderCheckout()
    expect(screen.getByText(/pays for Milton's account, not yours/i)).toBeInTheDocument()

    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    expect(await screen.findByText(/Milton is unlocked/i)).toBeInTheDocument()
  })

  it('refuses an invalid number without calling the payment API', async () => {
    renderCheckout()
    fireEvent.change(screen.getByLabelText(/mobile money number/i), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid Zambian mobile number/i)
    expect(initiateLencoPayment).not.toHaveBeenCalled()
  })

  it('a failed POLL is not reported as a failed payment', async () => {
    // The webhook is what settles a payment. Telling a parent their money
    // is gone because our poll dropped would be a lie, and an expensive one.
    pollLencoStatus.mockRejectedValue(new Error('network'))
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))

    expect(await screen.findByText(/it will still go through/i)).toBeInTheDocument()
    expect(screen.queryByText(/did not go through/i)).not.toBeInTheDocument()
  })

  it('a genuinely declined payment says nothing was charged', async () => {
    pollLencoStatus.mockResolvedValue({ status: 'failed' })
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    expect(await screen.findByText(/Nothing has been charged/i)).toBeInTheDocument()
  })

  it('is disabled offline — the charge is server-side', () => {
    renderCheckout({ disabled: true })
    expect(screen.getByRole('button', { name: /pay k50/i })).toBeDisabled()
  })

  it('surfaces a server refusal rather than swallowing it', async () => {
    // e.g. a co-guardian, whom the server refuses by design.
    initiateLencoPayment.mockRejectedValue(new Error('Only the account owner can pay for this child.'))
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/account owner/i)
  })
})
