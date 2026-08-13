import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * GuardianConsentStep — the hand-off, after the account exists.
 *
 * The behaviour worth pinning is not the form. It is that NOTHING here can
 * cost the learner their account: a bad address, a failed send, a closed app
 * and an outright skip all leave a working limited-mode account behind. The
 * moment that stops being true, the flow starts deleting children's accounts
 * because a parent's inbox was full.
 */

const mockSend = vi.fn()
vi.mock('../../../utils/ageGateService', () => ({
  sendGuardianConsentRequest: (...a) => mockSend(...a),
  recordAgeGateAttempt: vi.fn(),
  getDeviceId: () => 'device-test',
}))

import GuardianConsentStep from './GuardianConsentStep'

const onSent = vi.fn()
const onSkip = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockSend.mockResolvedValue({ ok: true, sent: 'email' })
})

function setup(props = {}) {
  return render(<GuardianConsentStep onSent={onSent} onSkip={onSkip} {...props} />)
}

describe('GuardianConsentStep', () => {
  it('says what it needs and what already works', () => {
    setup()
    expect(screen.getByRole('heading', { name: /ask a parent or guardian/i })).toBeInTheDocument()
    expect(screen.getByText(/needs to approve your account/i)).toBeInTheDocument()
    // The learner must leave this screen knowing they can already use the app.
    expect(screen.getByText(/start practising right away in limited mode/i)).toBeInTheDocument()
  })

  it('states the purpose limitation where the address is asked for', () => {
    // Not in a policy page nobody opens — next to the field.
    setup()
    expect(screen.getByText(/only to ask for approval/i)).toBeInTheDocument()
  })

  it('sends the request and reports the address back', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/guardian's email/i), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send approval link/i }))

    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith({ contact: 'parent@example.com', method: 'email' }),
    )
    expect(onSent).toHaveBeenCalledWith({ guardianEmail: 'parent@example.com' })
  })

  it('will not send to something that is not an address', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/guardian's email/i), {
      target: { value: 'mum' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send approval link/i }))

    await waitFor(() =>
      expect(screen.getByText(/enter your parent or guardian's email/i)).toBeInTheDocument(),
    )
    expect(mockSend).not.toHaveBeenCalled()
    expect(onSent).not.toHaveBeenCalled()
  })

  it('keeps the learner moving when the send fails', async () => {
    // The account exists. A failed send is a message to retry from the
    // dashboard, not a dead end.
    mockSend.mockRejectedValue(new Error('smtp down'))
    setup()
    fireEvent.change(screen.getByLabelText(/guardian's email/i), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send approval link/i }))

    await waitFor(() =>
      expect(screen.getByText(/try again from your dashboard/i)).toBeInTheDocument(),
    )
    expect(onSent).not.toHaveBeenCalled()
  })

  it('names the once-a-day cooldown rather than blaming the network', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('rate'), {
      code: 'functions/resource-exhausted',
    }))
    setup()
    fireEvent.change(screen.getByLabelText(/guardian's email/i), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send approval link/i }))

    await waitFor(() =>
      expect(screen.getByText(/already sent a link today/i)).toBeInTheDocument(),
    )
  })

  it('can be skipped', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /i'll do this later/i }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('never offers to delete or abandon the account', () => {
    setup()
    expect(screen.queryByRole('button', { name: /cancel|delete|start over/i })).toBeNull()
  })
})
