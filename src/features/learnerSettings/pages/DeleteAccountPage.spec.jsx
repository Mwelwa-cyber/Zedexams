/**
 * The child's side of deleting an account.
 *
 * Four things are pinned, and every one of them is a promise to a child rather
 * than a layout detail:
 *
 *   • **The off-ramps come first, and the real action is still on screen.**
 *     Ordering the gentler options first is help; hiding the delete button
 *     would be the dark pattern that ordering is usually used for.
 *   • **The escape hatch reaches support and NEVER the guardian.** A child who
 *     needs out of a link with the wrong adult must not be made to ask that
 *     adult — and must not have that adult told they asked.
 *   • **The screen renders the state the SERVER opened.** It never predicts
 *     whether a guardian will be asked. Guessing wrong means telling a child
 *     "we'll ask your mum" when nobody was asked.
 *   • **Childline 116 is on every step from the point of no return onwards.**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../shared/components/PageLoader', () => ({ default: () => <div>loading</div> }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'kid1', email: 'lydia@example.com' },
    userProfile: { displayName: 'Lydia Banda', role: 'learner', grade: 7 },
  }),
}))
vi.mock('../../marketing', () => ({
  ContactDialog: ({ open, source }) => (open ? <div data-testid="contact">{source}</div> : null),
}))
vi.mock('../panels/AccountPanel', () => ({ downloadMyData: vi.fn() }))

const getDeletionRequest = vi.fn()
const requestAccountDeletion = vi.fn()
const cancelDeletionRequest = vi.fn(() => Promise.resolve({ ok: true }))
const reportWrongGuardian = vi.fn(() => Promise.resolve({ ok: true }))
// States written out rather than imported — the real module reaches
// `firebase/functions` at load, and `test:deletion-state-mirror` is what stops
// this copy drifting from the server's.
vi.mock('../../../services/accountDeletion/deletionRequestService', () => ({
  DELETION_STATE: {
    PENDING_GUARDIAN: 'pending_guardian',
    SCHEDULED: 'scheduled',
    DECLINED: 'declined',
    ESCALATED_SUPPORT: 'escalated_support',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
  },
  OPEN_STATES: ['pending_guardian', 'scheduled', 'escalated_support'],
  getDeletionRequest: (...a) => getDeletionRequest(...a),
  requestAccountDeletion: (...a) => requestAccountDeletion(...a),
  cancelDeletionRequest: (...a) => cancelDeletionRequest(...a),
  reportWrongGuardian: (...a) => reportWrongGuardian(...a),
}))

import DeleteAccountPage from './DeleteAccountPage'

const META = {
  request: null,
  deletedSummary: ['Your profile and picture', 'Your notes and saved work'],
  graceDays: 30,
  guardianResponseDays: 7,
}

const renderPage = () => render(<MemoryRouter><DeleteAccountPage /></MemoryRouter>)

beforeEach(() => {
  getDeletionRequest.mockReset()
  requestAccountDeletion.mockReset()
  cancelDeletionRequest.mockClear()
  reportWrongGuardian.mockClear()
  getDeletionRequest.mockResolvedValue(META)
  requestAccountDeletion.mockResolvedValue({ requestId: 'req1', state: 'pending_guardian' })
})

describe('DeleteAccountPage', () => {
  it('offers the lighter exits first — AND keeps the delete action on screen', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Turn off notifications/)).toBeInTheDocument())
    expect(screen.getByText(/Take a break/)).toBeInTheDocument()
    expect(screen.getByText(/Download my work first/)).toBeInTheDocument()
    // One tap away, in the same view. Not behind a menu, not below a fold we
    // control — the off-ramps are help, not concealment.
    expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument()
  })

  it('shows what goes and what stays before it will send anything', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continue to delete/ }))

    expect(screen.getByText('Deleted')).toBeInTheDocument()
    expect(screen.getByText('Your profile and picture')).toBeInTheDocument()
    expect(screen.getByText('Kept')).toBeInTheDocument()
    expect(screen.getByText(/30 days to change your mind/)).toBeInTheDocument()
    expect(requestAccountDeletion).not.toHaveBeenCalled()
  })

  it('does not promise a guardian it has not asked yet', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continue to delete/ }))
    // "If you have a grown-up" — conditional, because the server decides.
    expect(screen.getByText(/If you have a grown-up/)).toBeInTheDocument()
    expect(screen.getByText(/our team takes over/)).toBeInTheDocument()
  })

  it('renders the state the SERVER opened, not one it predicted', async () => {
    requestAccountDeletion.mockResolvedValue({ requestId: 'req1', state: 'escalated_support' })
    getDeletionRequest
      .mockResolvedValueOnce(META)
      .mockResolvedValue({
        ...META,
        request: { id: 'req1', state: 'escalated_support', learnerId: 'kid1' },
        banner: { kind: 'escalated_support', daysLeft: null, canRestore: false },
      })

    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continue to delete/ }))
    fireEvent.click(screen.getByRole('button', { name: /Ask to delete my account/ }))

    // A child with no guardian is told a person has it — never that we asked
    // somebody who does not exist.
    await waitFor(() => expect(screen.getByText(/A person is handling this/)).toBeInTheDocument())
    expect(screen.queryByText(/We asked your grown-up/)).toBeNull()
  })

  it('tells a waiting child that NOTHING has been deleted, and when we step in', async () => {
    getDeletionRequest.mockResolvedValue({
      ...META,
      request: { id: 'req1', state: 'pending_guardian', learnerId: 'kid1', requestedAt: Date.now() },
      banner: { kind: 'pending_guardian', daysLeft: 7, canRestore: false },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/We asked your grown-up/)).toBeInTheDocument())
    expect(screen.getByText(/Nothing has been deleted/)).toBeInTheDocument()
    expect(screen.getByText(/within 7 days/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel this request/ })).toBeInTheDocument()
  })

  it('lets a waiting child withdraw', async () => {
    getDeletionRequest.mockResolvedValue({
      ...META,
      request: { id: 'req1', state: 'pending_guardian', learnerId: 'kid1', requestedAt: Date.now() },
      banner: { kind: 'pending_guardian', daysLeft: 7, canRestore: false },
    })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Cancel this request/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Cancel this request/ }))
    await waitFor(() => expect(cancelDeletionRequest).toHaveBeenCalledWith('req1'))
  })

  it('counts down for a scheduled account, and offers to keep it', async () => {
    getDeletionRequest.mockResolvedValue({
      ...META,
      request: {
        id: 'req1', state: 'scheduled', learnerId: 'kid1',
        requestedAt: Date.now(), scheduledDeleteAt: Date.now() + 30 * 86_400_000,
      },
      banner: { kind: 'scheduled', daysLeft: 30, canRestore: true },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Your account is going/)).toBeInTheDocument())
    expect(screen.getByText(/paused, not gone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Keep my account after all/ })).toBeInTheDocument()
  })

  /* ── The escape hatch ─────────────────────────────────────────────── */

  it('THE ESCAPE HATCH REACHES SUPPORT, and never the guardian', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continue to delete/ }))

    fireEvent.click(screen.getByRole('button', { name: /Not your grown-up\? Tell us instead/ }))
    await waitFor(() => expect(screen.getByTestId('contact')).toBeInTheDocument())
    // It opens the SUPPORT form…
    expect(screen.getByTestId('contact').textContent).toMatch(/wrong-guardian/)
    // …and raises the flag server-side, so a child who closes the dialog
    // without typing has still been heard.
    expect(reportWrongGuardian).toHaveBeenCalled()
    // Nothing was asked of anybody's guardian.
    expect(requestAccountDeletion).not.toHaveBeenCalled()
  })

  it('keeps the escape hatch and Childline on the waiting screen too', async () => {
    getDeletionRequest.mockResolvedValue({
      ...META,
      request: { id: 'req1', state: 'pending_guardian', learnerId: 'kid1', requestedAt: Date.now() },
      banner: { kind: 'pending_guardian', daysLeft: 7, canRestore: false },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/We asked your grown-up/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Not your grown-up\? Tell us instead/ })).toBeInTheDocument()
    expect(screen.getByText(/Childline Zambia 116/)).toBeInTheDocument()
  })

  it('puts Childline on the step where the decision is made', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continue to delete/ }))
    const link = screen.getByRole('link', { name: /Childline Zambia 116/ })
    expect(link).toHaveAttribute('href', 'tel:116')
  })

  it('never asks a child to type DELETE', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue to delete/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continue to delete/ }))
    expect(document.querySelector('input')).toBeNull()
    expect(screen.queryByText(/type DELETE/i)).toBeNull()
  })
})
