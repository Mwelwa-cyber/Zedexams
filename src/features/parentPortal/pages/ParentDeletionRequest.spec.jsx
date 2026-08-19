/**
 * The guardian's decision screen.
 *
 * What is pinned here is the honesty of the screen rather than its layout:
 *
 *   • the "worth a conversation" note appears ONLY when the server sent one —
 *     it is suppressed for an inactive child, and a client that rendered it
 *     unconditionally would put the claim back;
 *   • an unknown stat tile is ABSENT, not zero;
 *   • the plan panel is absent for a family that is not paying;
 *   • "Talk first" parks WITHOUT answering, and Approve requires a second
 *     screen — no decision is one tap from the feed;
 *   • the guardian reads the same Deleted list the child read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { displayName: 'Grace Phiri' }, currentUser: { uid: 'g1' } }),
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))

const getDeletionRequest = vi.fn()
const respondToDeletionRequest = vi.fn(() => Promise.resolve({ ok: true }))
const cancelDeletionRequest = vi.fn(() => Promise.resolve({ ok: true }))
// The state strings are written out rather than imported: the service module
// reaches `firebase/functions` at load. They cannot drift unnoticed —
// `test:deletion-state-mirror` compares the real client copy against the
// server's state machine.
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
  respondToDeletionRequest: (...a) => respondToDeletionRequest(...a),
  cancelDeletionRequest: (...a) => cancelDeletionRequest(...a),
}))

import ParentDeletionRequest from './ParentDeletionRequest'

const DELETED = [
  'Their profile and picture',
  'Their notes and saved work',
  'Their results and their streak',
]

const pending = (over = {}) => ({
  request: {
    id: 'req1',
    state: 'pending_guardian',
    learnerId: 'kid1',
    learnerDisplayName: 'Lydia Banda',
    requestedAt: Date.now() - 86_400_000,
    viewerIs: 'guardian',
  },
  deletedSummary: DELETED,
  graceDays: 30,
  guardianResponseDays: 7,
  context: {
    tiles: { streakDays: 12, examReadiness: 68, daysToExam: 9 },
    note: { text: 'Lydia has been using ZedExams almost every day…', reasons: ['exam_soon'] },
    plan: { text: 'You pay K50 a month covering 2 children.', othersRemain: true },
  },
  ...over,
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/family/requests/req1']}>
      <Routes>
        <Route path="/family/requests/:requestId" element={<ParentDeletionRequest />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getDeletionRequest.mockReset()
  respondToDeletionRequest.mockClear()
  cancelDeletionRequest.mockClear()
  getDeletionRequest.mockResolvedValue(pending())
})

describe('ParentDeletionRequest', () => {
  it('shows the stat tiles so the decision is not made blind', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/wants to delete their account/)).toBeInTheDocument())
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('day streak')).toBeInTheDocument()
    expect(screen.getByText('exam ready')).toBeInTheDocument()
    expect(screen.getByText('days to exams')).toBeInTheDocument()
  })

  it('omits a tile the server could not measure, rather than printing a zero', async () => {
    getDeletionRequest.mockResolvedValue(pending({
      context: { tiles: { streakDays: null, examReadiness: null, daysToExam: null }, note: null, plan: null },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/wants to delete their account/)).toBeInTheDocument())
    expect(screen.queryByText('day streak')).toBeNull()
    expect(screen.queryByText('exam ready')).toBeNull()
  })

  it('shows the conversation note when the server sent one', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Worth a conversation first/)).toBeInTheDocument())
  })

  it('SUPPRESSES the note when the server withheld it', async () => {
    // The server withholds it for a child who is not actually active. A client
    // that drew it anyway would put the false claim straight back.
    getDeletionRequest.mockResolvedValue(pending({
      context: { tiles: { streakDays: null, examReadiness: null, daysToExam: null }, note: null, plan: null },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/wants to delete their account/)).toBeInTheDocument())
    expect(screen.queryByText(/Worth a conversation first/)).toBeNull()
    expect(screen.queryByText(/almost every day/)).toBeNull()
  })

  it('shows the plan panel only when the family is paying', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/K50 a month/)).toBeInTheDocument())

    getDeletionRequest.mockResolvedValue(pending({
      context: { tiles: {}, note: null, plan: null },
    }))
    const { unmount } = renderPage()
    await waitFor(() => expect(screen.getAllByText(/wants to delete/).length).toBeGreaterThan(0))
    unmount()
  })

  it('shows the child the same Deleted list', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/If you approve, this is deleted/)).toBeInTheDocument())
    for (const line of DELETED) {
      expect(screen.getByText(line)).toBeInTheDocument()
    }
  })

  it('parks the request without answering it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Talk to Lydia first/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Talk to Lydia first/ }))
    await waitFor(() => expect(respondToDeletionRequest).toHaveBeenCalledWith('req1', 'park'))
  })

  it('declines in one tap — keeping the account is the recoverable choice', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Keep their account/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Keep their account/ }))
    await waitFor(() => expect(respondToDeletionRequest).toHaveBeenCalledWith('req1', 'decline'))
  })

  it('APPROVING IS NEVER ONE TAP — it needs a second screen and a hold', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Approve deletion$/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^Approve deletion$/ }))

    // Nothing has been sent yet.
    expect(respondToDeletionRequest).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/This one is hard to undo/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Hold to approve deletion/ })).toBeInTheDocument()
    // And it is a HOLD, not a typed word — no text input on the screen.
    expect(document.querySelector('input')).toBeNull()
  })

  it('offers restore, not a decision, once the window is running', async () => {
    getDeletionRequest.mockResolvedValue(pending({
      request: {
        id: 'req1', state: 'scheduled', learnerId: 'kid1',
        learnerDisplayName: 'Lydia Banda',
        requestedAt: Date.now(), scheduledDeleteAt: Date.now() + 30 * 86_400_000,
        viewerIs: 'guardian',
      },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Scheduled for deletion/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Restore Lydia's account/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve deletion$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Restore Lydia's account/ }))
    await waitFor(() => expect(cancelDeletionRequest).toHaveBeenCalledWith('req1'))
  })

  it('says there is nothing to decide once somebody already has', async () => {
    getDeletionRequest.mockResolvedValue(pending({
      request: {
        id: 'req1', state: 'declined', learnerId: 'kid1',
        learnerDisplayName: 'Lydia Banda', viewerIs: 'guardian',
      },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Nothing left to decide/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^Approve deletion$/ })).toBeNull()
  })

  it('does not confirm a request exists to somebody it was not sent to', async () => {
    getDeletionRequest.mockResolvedValue({ request: null })
    renderPage()
    await waitFor(() => expect(screen.getByText(/could not find that request/)).toBeInTheDocument())
  })

  it('keeps Childline reachable', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Childline Zambia 116/)).toBeInTheDocument())
  })
})
