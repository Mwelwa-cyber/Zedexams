/**
 * GuardianHomePage — /for-guardians
 *
 * Lists the guardian's own links and offers the one remaining action:
 * withdrawing consent, confirmed in-line, with a result that is honest about a
 * second guardian's approval still standing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../shared/styles/learnerTheme.css', () => ({}))
vi.mock('../styles/parentApp.css', () => ({}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))

const logout = vi.fn()
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'g1' }, logout }),
}))

const listMyLinks = vi.fn()
const withdrawGuardianConsent = vi.fn()
vi.mock('../services/guardianActions', () => ({
  listMyLinks: (...a) => listMyLinks(...a),
  withdrawGuardianConsent: (...a) => withdrawGuardianConsent(...a),
}))

import GuardianHomePage from './GuardianHomePage'

const link = (over = {}) => ({
  id: 'g1_c1', childUid: 'c1', childName: 'Mwila', grade: 7,
  raw: { status: 'active', consent: { state: 'approved' } }, ...over,
})

const renderPage = () => render(<MemoryRouter><GuardianHomePage /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  listMyLinks.mockResolvedValue([link()])
  withdrawGuardianConsent.mockResolvedValue({ ok: true, childStillApproved: false })
})

describe('GuardianHomePage', () => {
  it('lists only the signed-in guardian\'s links', async () => {
    renderPage()
    expect(await screen.findByText('Mwila')).toBeInTheDocument()
    expect(listMyLinks).toHaveBeenCalledWith('g1')
    expect(screen.getByText(/You have approved/)).toBeInTheDocument()
  })

  it('says so when no children are linked', async () => {
    listMyLinks.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No children are linked/i)).toBeInTheDocument()
  })

  it('needs a confirming tap before withdrawing, then reports the outcome', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /withdraw my consent/i }))
    expect(withdrawGuardianConsent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /yes, withdraw my consent/i }))
    await waitFor(() => expect(withdrawGuardianConsent).toHaveBeenCalledWith('c1'))
    expect(await screen.findByRole('status')).toHaveTextContent(/paused until a guardian approves again/i)
  })

  it('is honest when another guardian still approves the child', async () => {
    withdrawGuardianConsent.mockResolvedValue({ ok: true, childStillApproved: true })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /withdraw my consent/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, withdraw my consent/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/still covered by another guardian/i)
  })

  it('offers nothing to withdraw on a link that is already withdrawn', async () => {
    listMyLinks.mockResolvedValue([link({ raw: { status: 'active', consent: { state: 'withdrawn' } } })])
    renderPage()
    expect(await screen.findByText(/You withdrew your consent/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw my consent/i })).not.toBeInTheDocument()
  })

  it('shows the server\'s refusal and keeps the page usable', async () => {
    withdrawGuardianConsent.mockRejectedValue(new Error('You are not linked to this child.'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /withdraw my consent/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, withdraw my consent/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not linked/i)
  })

  it('shows Childline and can sign out', async () => {
    renderPage()
    expect(await screen.findByText(/116/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(logout).toHaveBeenCalled()
  })
})
