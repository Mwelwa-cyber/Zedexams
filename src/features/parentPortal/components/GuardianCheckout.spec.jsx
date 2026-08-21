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
 *
 * These mocks used to resolve `pollLencoStatus` as `{ status: 'successful' }`,
 * which is not what the real function returns — it resolves a STATUS STRING.
 * The suite was green while every real guardian payment, successful ones
 * included, reported failure to the parent. So the mocks now speak the real
 * contract, and one test below pins that contract against the real module
 * rather than against this file's idea of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
// lenco.js builds its callables at module load. The real module is imported
// below (for `detectOperator`/`looksLikeZambianPhone`, which are pure and
// which this component's validation genuinely depends on), so the Functions
// SDK has to be inert rather than absent.
const statusCallable = vi.fn()
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  // Named, so the contract test below can drive the real pollLencoStatus
  // through the real getLencoPaymentStatus wrapper.
  httpsCallable: (_fns, name) => (payload) => (
    name === 'getLencoPaymentStatus' ? statusCallable(payload) : Promise.resolve({ data: {} })
  ),
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
    pollLencoStatus.mockResolvedValue('successful')
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

  it('a poll that resolves "successful" unlocks the child', async () => {
    // The regression. `pollLencoStatus` resolves a STRING; reading
    // `.status` off it sent every outcome — this one included — down the
    // failure arm, so a parent who had just paid was told they had not.
    const onPaid = vi.fn()
    renderCheckout({ onPaid })
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))

    expect(await screen.findByText(/Milton is unlocked/i)).toBeInTheDocument()
    expect(screen.queryByText(/did not go through/i)).not.toBeInTheDocument()
    await waitFor(() => expect(onPaid).toHaveBeenCalled())
  })

  it('a failed POLL is not reported as a failed payment', async () => {
    // The webhook is what settles a payment. Telling a parent their money
    // is gone because our poll dropped would be a lie, and an expensive one.
    pollLencoStatus.mockRejectedValue(new Error('network'))
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))

    expect(await screen.findByText(/will still go through/i)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing has been charged/i)).not.toBeInTheDocument()
  })

  it('a poll window that closes unanswered is unsettled, not declined', async () => {
    // Two minutes is shorter than a mobile-money prompt often takes. The
    // parent must not be told nothing was charged — that is how a payment
    // that went through gets made twice.
    pollLencoStatus.mockResolvedValue('pending')
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))

    expect(await screen.findByText(/will still go through/i)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing has been charged/i)).not.toBeInTheDocument()
  })

  it('re-checking an unsettled payment re-reads the SAME reference and never re-initiates', async () => {
    pollLencoStatus.mockResolvedValue('pending')
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))

    const recheck = await screen.findByRole('button', { name: /check payment status/i })
    expect(initiateLencoPayment).toHaveBeenCalledTimes(1)

    pollLencoStatus.mockResolvedValue('successful')
    fireEvent.click(recheck)

    expect(await screen.findByText(/Milton is unlocked/i)).toBeInTheDocument()
    // The re-check polls; it does not start a second collection.
    expect(initiateLencoPayment).toHaveBeenCalledTimes(1)
    expect(pollLencoStatus.mock.calls.every(([ref]) => ref === 'pay1')).toBe(true)
  })

  it('typing a corrected number clears the refusal it was shown for', async () => {
    renderCheckout()
    fireEvent.change(screen.getByLabelText(/mobile money number/i), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: /pay k50/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid Zambian mobile number/i)

    typeNumber()
    await waitFor(() => {
      expect(screen.queryByText(/valid Zambian mobile number/i)).not.toBeInTheDocument()
    })
  })

  it('a genuinely declined payment says nothing was charged', async () => {
    pollLencoStatus.mockResolvedValue('failed')
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

  /* ── Choosing a network ──────────────────────────────────────────── */

  it('offers the three networks as one radio group, each named in full', () => {
    // The tile shows a short label under a coloured mark; the accessible
    // name has to stay the full product name, or a screen reader is left
    // with "Zamtel" for a control whose job is to say "Zamtel Kwacha".
    renderCheckout()
    const group = screen.getByRole('radiogroup', { name: /network/i })
    expect(group).toBeInTheDocument()
    for (const name of ['MTN MoMo', 'Airtel Money', 'Zamtel Kwacha']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
  })

  it('says out loud which network the number resolved to', () => {
    // It has always auto-detected from the prefix. It never said so, so a
    // parent who tapped nothing had no way to know a network had been
    // chosen for them — or which one was about to be charged.
    renderCheckout()
    typeNumber()
    // By text rather than by role: the secured-by-Lenco note at the foot
    // of the form is also a live region, so `getByRole('status')` matches
    // two nodes here.
    expect(screen.getByText(/Charging/)).toHaveTextContent(/Airtel Money/)
    expect(screen.getByRole('radio', { name: 'Airtel Money' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('an explicit tap outranks the number, and stops explaining itself', () => {
    renderCheckout()
    typeNumber()
    fireEvent.click(screen.getByRole('radio', { name: 'MTN MoMo' }))
    expect(screen.getByRole('radio', { name: 'MTN MoMo' }))
      .toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Airtel Money' }))
      .toHaveAttribute('aria-checked', 'false')
    // The detected-network line is about a choice we made for the parent.
    // Once they have made their own it would be describing nothing.
    expect(screen.queryByText(/Charging/)).not.toBeInTheDocument()
  })

  it('a network mark is decoration — never a second copy of the name', () => {
    // The mark repeats the brand the label already carries, so it must
    // stay out of the accessibility tree: "MTN MTN MoMo" is worse than
    // the label on its own.
    const { container } = renderCheckout()
    const marks = container.querySelectorAll('svg.zx-momo-mark')
    expect(marks.length).toBe(3)
    for (const mark of marks) expect(mark).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('pollLencoStatus contract', () => {
  // Every test above this line runs against a MOCK of pollLencoStatus, so
  // none of them can see the shape the real one returns. That is exactly
  // how the checkout came to read `.status` off a string with a green
  // suite. This one drives the real module.
  beforeEach(() => { statusCallable.mockReset() })

  it('resolves a status STRING, not an object', async () => {
    statusCallable.mockResolvedValue({ data: { status: 'successful' } })
    const { pollLencoStatus: real } = await vi.importActual('../../../utils/lenco')
    await expect(real('pay1')).resolves.toBe('successful')
  })

  it('resolves "pending" — never a rejection — when the status call keeps failing', async () => {
    // Which is why the checkout's catch arm cannot be the only place that
    // handles an unanswered payment.
    statusCallable.mockRejectedValue(new Error('offline'))
    const { pollLencoStatus: real } = await vi.importActual('../../../utils/lenco')
    await expect(real('pay1', { maxAttempts: 2, intervalMs: 0 })).resolves.toBe('pending')
  })
})
