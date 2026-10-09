/**
 * GuardianRequestPage — /for-guardians/request/:requestId
 *
 * The properties that matter: the page renders only what the server returned,
 * a request that is not the guardian's reads as "not found" (the same answer a
 * stranger gets), approving needs a second confirming tap, and the "decide
 * later" copy does not pretend to pause the clock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../shared/styles/learnerTheme.css', () => ({}))
vi.mock('../styles/parentApp.css', () => ({}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))

const getDeletionRequest = vi.fn()
const respondToDeletionRequest = vi.fn()
const cancelDeletionRequest = vi.fn()
vi.mock('../services/guardianActions', () => ({
  getDeletionRequest: (...a) => getDeletionRequest(...a),
  respondToDeletionRequest: (...a) => respondToDeletionRequest(...a),
  cancelDeletionRequest: (...a) => cancelDeletionRequest(...a),
}))

import GuardianRequestPage from './GuardianRequestPage'

const payload = (over = {}) => ({
  request: { id: 'r1', state: 'pending_guardian', viewerIs: 'guardian', learnerDisplayName: 'Mwila' },
  banner: { kind: 'pending_guardian', daysLeft: 5, canRestore: false },
  context: { tiles: { streakDays: 4, examReadiness: 71, daysToExam: 12 }, note: null, plan: null },
  deletedSummary: ['Their progress and results'],
  graceDays: 30,
  guardianResponseDays: 7,
  ...over,
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/for-guardians/request/r1']}>
      <Routes>
        <Route path="/for-guardians/request/:requestId" element={<GuardianRequestPage />} />
        <Route path="/for-guardians" element={<div>guardian home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  respondToDeletionRequest.mockResolvedValue({ ok: true })
  cancelDeletionRequest.mockResolvedValue({ ok: true })
})

describe('GuardianRequestPage', () => {
  it('asks the server for the request named in the URL and shows the decision', async () => {
    getDeletionRequest.mockResolvedValue(payload())
    renderPage()
    expect(await screen.findByText(/asked to delete their account/i)).toBeInTheDocument()
    expect(getDeletionRequest).toHaveBeenCalledWith('r1')
    expect(screen.getByText(/Their progress and results/)).toBeInTheDocument()
    expect(screen.getByText('71%')).toBeInTheDocument()
  })

  it('treats a request that is not the guardian\'s as not found', async () => {
    getDeletionRequest.mockResolvedValue({ request: null })
    renderPage()
    expect(await screen.findByText(/could not find this request/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep their account/i })).not.toBeInTheDocument()
  })

  it('reads the child\'s own view of the request as not found too', async () => {
    getDeletionRequest.mockResolvedValue(payload({ request: { id: 'r1', state: 'pending_guardian', viewerIs: 'learner' } }))
    renderPage()
    expect(await screen.findByText(/could not find this request/i)).toBeInTheDocument()
  })

  it('needs a second tap before approving a deletion', async () => {
    getDeletionRequest.mockResolvedValue(payload())
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /approve deletion/i }))
    expect(respondToDeletionRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /yes, delete their account/i }))
    await waitFor(() => expect(respondToDeletionRequest).toHaveBeenCalledWith('r1', 'approve'))
    expect(await screen.findByText(/you approved the request/i)).toBeInTheDocument()
  })

  it('declines in one tap and says nothing will be deleted', async () => {
    getDeletionRequest.mockResolvedValue(payload())
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /keep their account/i }))
    await waitFor(() => expect(respondToDeletionRequest).toHaveBeenCalledWith('r1', 'decline'))
    expect(await screen.findByText(/nothing will be deleted/i)).toBeInTheDocument()
  })

  it('"decide later" says it does not pause the wait', async () => {
    getDeletionRequest.mockResolvedValue(payload())
    renderPage()
    expect(await screen.findByText(/does not pause the/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /decide later/i }))
    await waitFor(() => expect(respondToDeletionRequest).toHaveBeenCalledWith('r1', 'park'))
    expect(await screen.findByText(/this is not an answer yet/i)).toBeInTheDocument()
  })

  it('shows the server\'s own sentence when an answer is refused', async () => {
    getDeletionRequest.mockResolvedValue(payload())
    respondToDeletionRequest.mockRejectedValue(new Error('This request was sent to a different guardian.'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /keep their account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/different guardian/i)
  })

  it('lets a guardian cancel a scheduled deletion', async () => {
    getDeletionRequest.mockResolvedValue(payload({
      request: { id: 'r1', state: 'scheduled', viewerIs: 'guardian', learnerDisplayName: 'Mwila' },
      banner: { kind: 'scheduled', daysLeft: 20, canRestore: true },
    }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /cancel the deletion/i }))
    await waitFor(() => expect(cancelDeletionRequest).toHaveBeenCalledWith('r1'))
    expect(await screen.findByText(/the account is restored/i)).toBeInTheDocument()
  })

  it('always shows Childline', async () => {
    getDeletionRequest.mockResolvedValue({ request: null })
    renderPage()
    expect(await screen.findByText(/116/)).toBeInTheDocument()
  })
})
