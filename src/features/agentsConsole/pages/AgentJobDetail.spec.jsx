import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AgentJobDetail from './AgentJobDetail.jsx'

// The job the mocked onSnapshot serves. Set per test before rendering.
let currentJob
const updateDocMock = vi.fn(() => Promise.resolve())

// Mock the Firebase layer so this never touches a live app. onSnapshot
// immediately resolves with the current job (mirrors a Firestore read).
vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ __ref: args }),
  onSnapshot: (ref, onNext) => {
    onNext({ exists: () => true, id: 'job1', data: () => currentJob })
    return () => {}
  },
  serverTimestamp: () => '__ts__',
  updateDoc: (...args) => updateDocMock(...args),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn(),
}))
vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'admin-1' } }),
}))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ jobId: 'job1' }),
  Link: ({ children }) => children,
}))
vi.mock('../../../components/seo/SeoHelmet', () => ({ default: () => null }))

const createdAt = { toDate: () => new Date('2026-06-21T03:00:00Z') }

// A weekly-audit rollup awaiting review (read-only qaEng job).
const AUDIT_JOB = {
  id: 'job1',
  agentId: 'cala',
  department: 'qaEng',
  status: 'awaiting_approval',
  input: { runType: 'weekly-cbc-audit' },
  output: {
    cala: { sampleSize: 20, audited: 6, aligned: 1, drifted: 5, errored: 0, skipped: 14, findings: [] },
  },
  createdAt,
}

// A content-line draft awaiting approval (the real publish gate).
const CONTENT_JOB = {
  id: 'job1',
  agentId: 'aria',
  department: 'content',
  status: 'awaiting_approval',
  input: { tool: 'worksheet', topic: 'Fractions' },
  output: {
    aria: { draft: { title: 'x' } },
    cala: {
      aligned: false,
      citations: [],
      gaps: [{ outcome: 'g:o1', text: 'covered?', note: 'Outcome not covered in draft.' }],
      drift: [],
    },
    reva: { verdict: 'approve' },
  },
  createdAt,
}

// An ops rollup (Vigil hourly monitor) — read-only, carries input.runType.
const VIGIL_JOB = {
  id: 'job1',
  agentId: 'vigil',
  department: 'qaEng',
  status: 'awaiting_approval',
  input: { runType: 'hourly-monitor' },
  output: { vigil: { ok: false, checks: [] } },
  createdAt,
}

// Compass lives in the content department but is still a read-only rollup —
// input.runType must win over department when routing the review panel.
const COMPASS_JOB = {
  id: 'job1',
  agentId: 'compass',
  department: 'content',
  status: 'awaiting_approval',
  input: { runType: 'weekly-product-signal', windowDays: 28 },
  output: { compass: { backlog: [], errors: [] } },
  createdAt,
}

beforeEach(() => {
  updateDocMock.mockClear()
})

describe('AgentJobDetail — approval vs acknowledge routing', () => {
  it('shows an Acknowledge panel (not Approve & publish) for an audit rollup', async () => {
    currentJob = AUDIT_JOB
    render(<AgentJobDetail />)

    expect(await screen.findByText('Acknowledge')).toBeInTheDocument()
    expect(screen.getByText(/read-only report/i)).toBeInTheDocument()
    // The content-line publish flow must NOT appear for a read-only audit.
    expect(screen.queryByText(/Awaiting your approval/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Approve & publish/i)).not.toBeInTheDocument()
    // And the audit summary card renders below it.
    expect(screen.getByText(/Weekly CBC alignment audit/i)).toBeInTheDocument()
  })

  it('acknowledging writes status=approved with reviewer metadata', async () => {
    currentJob = AUDIT_JOB
    render(<AgentJobDetail />)

    fireEvent.click(await screen.findByText('Acknowledge'))

    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1))
    const fields = updateDocMock.mock.calls[0][1]
    expect(fields.status).toBe('approved')
    expect(fields.reviewedBy).toBe('admin-1')
    expect(fields.reviewedAt).toBe('__ts__')
  })

  it('keeps the Approve/Reject publish flow for a content-line draft', async () => {
    currentJob = CONTENT_JOB
    render(<AgentJobDetail />)

    expect(await screen.findByText(/Awaiting your approval/i)).toBeInTheDocument()
    expect(screen.queryByText('Acknowledge')).not.toBeInTheDocument()
  })

  it('shows Acknowledge for an ops rollup carrying input.runType (Vigil)', async () => {
    currentJob = VIGIL_JOB
    render(<AgentJobDetail />)

    expect(await screen.findByText('Acknowledge')).toBeInTheDocument()
    expect(screen.queryByText(/Approve & publish/i)).not.toBeInTheDocument()
  })

  it('shows Acknowledge for a content-department rollup (Compass) — runType wins over department', async () => {
    currentJob = COMPASS_JOB
    render(<AgentJobDetail />)

    expect(await screen.findByText('Acknowledge')).toBeInTheDocument()
    expect(screen.queryByText(/Awaiting your approval/i)).not.toBeInTheDocument()
  })
})
