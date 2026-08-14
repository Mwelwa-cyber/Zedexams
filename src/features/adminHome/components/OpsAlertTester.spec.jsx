/**
 * OpsAlertTester — the /admin "test the ops alarm" card. Guards the three
 * verdicts (both / one / none), that a silent channel's explanation reaches the
 * screen, that the button can't fire twice while in flight, and the error state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSendTestOpsAlert = vi.fn()
vi.mock('../../../utils/opsAlerts', () => ({
  sendTestOpsAlert: (...a) => mockSendTestOpsAlert(...a),
}))

import OpsAlertTester from './OpsAlertTester'

const bothDelivered = {
  verdict: 'both',
  delivered: true,
  slack: { status: 'sent', reason: null, detail: null },
  email: { status: 'sent', reason: null, detail: null },
}

describe('OpsAlertTester', () => {
  beforeEach(() => {
    mockSendTestOpsAlert.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports both channels delivered', async () => {
    mockSendTestOpsAlert.mockResolvedValue(bothDelivered)
    render(<OpsAlertTester />)

    await userEvent.click(screen.getByRole('button', { name: /send test alert/i }))

    await waitFor(() => expect(screen.getByText(/both channels delivered/i)).toBeInTheDocument())
    expect(screen.getAllByText('delivered')).toHaveLength(2)
  })

  it('calls one delivered channel out as amber, not a pass', async () => {
    mockSendTestOpsAlert.mockResolvedValue({
      verdict: 'one',
      delivered: true,
      slack: { status: 'sent', reason: null, detail: null },
      email: {
        status: 'not-configured',
        reason: 'smtp-unconfigured',
        detail: 'EMAIL_SMTP_USER / EMAIL_SMTP_PASSWORD are not bound to this function.',
      },
    })
    render(<OpsAlertTester />)

    await userEvent.click(screen.getByRole('button', { name: /send test alert/i }))

    await waitFor(() => expect(screen.getByText(/only one channel delivered/i)).toBeInTheDocument())
    // The whole point of the panel: the silent channel explains itself, and the
    // raw reason is shown so it can be searched for.
    expect(screen.getByText(/are not bound to this function/i)).toBeInTheDocument()
    expect(screen.getByText('smtp-unconfigured')).toBeInTheDocument()
    expect(screen.getByText('not configured')).toBeInTheDocument()
  })

  it('reports total silence as a failure', async () => {
    mockSendTestOpsAlert.mockResolvedValue({
      verdict: 'none',
      delivered: false,
      slack: { status: 'not-configured', reason: 'webhook-unconfigured', detail: 'Store the secret.' },
      email: { status: 'failed', reason: 'send-failed', detail: 'SMTP rejected the message.' },
    })
    render(<OpsAlertTester />)

    await userEvent.click(screen.getByRole('button', { name: /send test alert/i }))

    await waitFor(() => expect(screen.getByText(/nothing was delivered/i)).toBeInTheDocument())
    expect(screen.getByText(/would be silent/i)).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('passes the note through and sends only once per click', async () => {
    mockSendTestOpsAlert.mockResolvedValue(bothDelivered)
    render(<OpsAlertTester />)

    await userEvent.type(screen.getByPlaceholderText(/optional note/i), 'after rotating the webhook')
    await userEvent.click(screen.getByRole('button', { name: /send test alert/i }))

    await waitFor(() => expect(mockSendTestOpsAlert).toHaveBeenCalledTimes(1))
    expect(mockSendTestOpsAlert).toHaveBeenCalledWith({ note: 'after rotating the webhook' })
  })

  it('surfaces the throttle message instead of a silent no-op', async () => {
    mockSendTestOpsAlert.mockRejectedValue(new Error('One test alert every 5 minutes. Try again in 220s.'))
    render(<OpsAlertTester />)

    await userEvent.click(screen.getByRole('button', { name: /send test alert/i }))

    // Matched on the retry-after detail rather than "5 minutes", which the
    // card's own description also carries.
    await waitFor(() => expect(screen.getByText(/try again in 220s/i)).toBeInTheDocument())
    // A failed attempt must not leave a stale verdict on screen.
    expect(screen.queryByText(/channels delivered/i)).not.toBeInTheDocument()
  })

  it('shows no verdict before the first send', () => {
    render(<OpsAlertTester />)
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send test alert/i })).toBeEnabled()
  })
})
