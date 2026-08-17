/**
 * Behaviour tests for the parent dashboard.
 *
 * What is pinned here: the child who needs attention is listed FIRST (a
 * parent should not have to read past the child who is fine), a failed
 * approvals read does not take the children list down with it, and the
 * screen never prints a figure ZedExams does not measure — no
 * time-on-task, no exam-readiness percentage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { displayName: 'Grace Phiri' } }),
}))

let mockChildren
vi.mock('../hooks/useGuardianChildren', () => ({
  default: () => mockChildren,
}))

const listGuardianApprovals = vi.fn(() => Promise.resolve([]))
vi.mock('../services/parentApp', () => ({
  listGuardianApprovals: (...a) => listGuardianApprovals(...a),
  declineGuardianApproval: vi.fn(),
}))

import ParentHome from './ParentHome'

const DAY = 86_400_000

const onTrack = {
  childUid: 'kid-ok', displayName: 'Aaron Phiri', grade: '7',
  status: 'on_track', lastActiveAt: Date.now() - 2 * 3600_000, guardianCount: 1,
}
const stopped = {
  childUid: 'kid-quiet', displayName: 'Zoe Phiri', grade: '4',
  status: 'quiet', lastActiveAt: Date.now() - 20 * DAY, guardianCount: 2,
}

function renderHome() {
  return render(<MemoryRouter><ParentHome /></MemoryRouter>)
}

describe('ParentHome', () => {
  beforeEach(() => {
    listGuardianApprovals.mockClear()
    listGuardianApprovals.mockResolvedValue([])
    mockChildren = { loading: false, error: null, children: [onTrack, stopped], reload: vi.fn() }
  })

  it('greets the parent by first name', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Grace')
  })

  it('lists the child who stopped BEFORE the one who is fine', () => {
    // Alphabetically Aaron comes first; by need, Zoe does.
    renderHome()
    const names = screen.getAllByText(/Phiri|Aaron|Zoe/).map((n) => n.textContent)
    const zoeAt = names.findIndex((t) => t.includes('Zoe'))
    const aaronAt = names.findIndex((t) => t.includes('Aaron'))
    expect(zoeAt).toBeLessThan(aaronAt)
  })

  it('never prints a figure we do not measure', () => {
    renderHome()
    const text = document.body.textContent
    expect(text).not.toMatch(/\d+h\s?\d*m/)
    expect(text).not.toMatch(/exam.?ready/i)
  })

  it('a failed approvals read leaves the children list standing', async () => {
    listGuardianApprovals.mockRejectedValue(new Error('offline'))
    renderHome()
    await waitFor(() => expect(listGuardianApprovals).toHaveBeenCalled())
    expect(screen.getByText(/Zoe/)).toBeInTheDocument()
    expect(screen.queryByText(/Needs your approval/)).not.toBeInTheDocument()
  })

  it('an empty family explains how to add one rather than showing a blank', () => {
    mockChildren = { loading: false, error: null, children: [], reload: vi.fn() }
    renderHome()
    expect(screen.getByText(/family code/i)).toBeInTheDocument()
  })

  it('a failed children read offers a retry', () => {
    const reload = vi.fn()
    mockChildren = { loading: false, error: 'Could not load', children: [], reload }
    renderHome()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
