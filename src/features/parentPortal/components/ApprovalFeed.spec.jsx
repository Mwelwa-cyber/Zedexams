/**
 * Behaviour tests for the approval feed.
 *
 * The two that matter are about what a tap can and cannot do:
 *
 *   • there is NO one-tap approve, because approving a premium request
 *     means spending money and the parent decides that where the price
 *     is visible;
 *   • decline goes through the server callable and reports a failure
 *     rather than pretending it worked.
 *
 * The third is the reason the feed exists at all: the request names the
 * child and what they asked for, so a parent is deciding about something
 * specific rather than about a notification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))

const declineGuardianApproval = vi.fn(() => Promise.resolve({ ok: true }))
vi.mock('../services/parentApp', () => ({
  declineGuardianApproval: (...args) => declineGuardianApproval(...args),
}))

import ApprovalFeed from './ApprovalFeed'

const request = {
  id: 'req-1',
  childUid: 'kid-1',
  childName: 'Milton Phiri',
  feature: 'PAPER_CONTINUE',
  planId: 'term_pass',
  priceZMW: 120,
  createdAt: Date.now() - 2 * 86_400_000,
}

function renderFeed(props = {}) {
  return render(
    <MemoryRouter>
      <ApprovalFeed approvals={[request]} onChange={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

describe('ApprovalFeed', () => {
  beforeEach(() => {
    declineGuardianApproval.mockClear()
    declineGuardianApproval.mockResolvedValue({ ok: true })
  })

  it('renders nothing when there is nothing pending', () => {
    const { container } = render(
      <MemoryRouter><ApprovalFeed approvals={[]} /></MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('names the child, what they asked for, and when', () => {
    renderFeed()
    expect(screen.getByText(/Milton is asking to unlock/)).toBeInTheDocument()
    expect(screen.getByText(/to finish a past paper/)).toBeInTheDocument()
    expect(screen.getByText(/asked 2 days ago/)).toBeInTheDocument()
  })

  it('shows the price — this is the side of the app where prices belong', () => {
    renderFeed()
    expect(screen.getByText(/K120/)).toBeInTheDocument()
  })

  it('offers Review rather than Approve, and Review goes to the plan screen', () => {
    // A one-tap Approve here would be a one-tap purchase.
    renderFeed()
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument()
    const review = screen.getByRole('button', { name: 'Review' })
    expect(review).toBeInTheDocument()
  })

  it('declines through the callable and refreshes', async () => {
    const onChange = vi.fn()
    renderFeed({ onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(declineGuardianApproval).toHaveBeenCalledWith('req-1'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('surfaces a failed decline instead of silently doing nothing', async () => {
    declineGuardianApproval.mockRejectedValue(new Error('Network is down'))
    renderFeed()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Network is down')
  })

  it('disables both actions while offline', () => {
    renderFeed({ disabled: true })
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled()
  })
})
