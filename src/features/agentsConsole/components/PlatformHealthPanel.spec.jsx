import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import PlatformHealthPanel from './PlatformHealthPanel.jsx'

// What getPlatformHealth does for the current test. The panel builds its
// callables at module load, so the mock routes through this indirection.
let healthImpl

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (_fns, name) => (payload) => {
    if (name === 'getPlatformHealth') return healthImpl(payload)
    return Promise.resolve({ data: {} })
  },
}))
vi.mock('../../../firebase/config', () => ({ default: {} }))
vi.mock('react-router-dom', () => ({ Link: ({ children }) => children }))

const HEALTHY_SNAPSHOT = {
  checkedAt: 1,
  anthropic: { ok: true, keyMissing: false, model: 'test-model' },
  agentControl: {
    aria: { exists: true, paused: false },
    cala: { exists: true, paused: false },
    reva: { exists: true, paused: false },
    pubo: { exists: true, paused: false },
    quill: { exists: true, paused: false },
    vex: { exists: true, paused: false },
  },
  missingAgentControlDocs: [],
  kb: { activeVersion: 'v1', totalTopics: 90, byGrade: { G6: 90 }, bySubject: {} },
  recentJobs: { total: 50, byStatus: { done: 50 }, last: null },
}

beforeEach(() => {
  healthImpl = () => Promise.resolve({ data: HEALTHY_SNAPSHOT })
})

describe('PlatformHealthPanel', () => {
  it('renders the healthy snapshot as Ready', async () => {
    render(<PlatformHealthPanel />)
    await waitFor(() => expect(screen.getByText('Alive')).toBeInTheDocument())
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('6/6 present')).toBeInTheDocument()
    expect(screen.getByText('90 topics')).toBeInTheDocument()
    expect(screen.getByText('50 jobs')).toBeInTheDocument()
  })

  it('shows unknown state — not false failures — when the snapshot call rejects', async () => {
    // Regression: getPlatformHealth used to reject superAdmins with
    // "Admins only.", and the panel rendered the null snapshot as
    // "Down" / "0/6 present" / "No jobs yet" over a healthy pipeline.
    healthImpl = () => Promise.reject(new Error('Admins only.'))
    render(<PlatformHealthPanel />)
    await waitFor(() => expect(screen.getByText('Admins only.')).toBeInTheDocument())

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('Snapshot unavailable')).toHaveLength(4)
    expect(screen.queryByText('Down')).not.toBeInTheDocument()
    expect(screen.queryByText('0/6 present')).not.toBeInTheDocument()
    expect(screen.queryByText('No jobs yet — try a sample run')).not.toBeInTheDocument()
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
  })

  it('drops a stale snapshot when a later Refresh fails', async () => {
    render(<PlatformHealthPanel />)
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())

    healthImpl = () => Promise.reject(new Error('deadline-exceeded'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('deadline-exceeded')).toBeInTheDocument())

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Alive')).not.toBeInTheDocument()
  })

  it('still surfaces real failures when the snapshot itself reports them', async () => {
    healthImpl = () => Promise.resolve({
      data: {
        ...HEALTHY_SNAPSHOT,
        anthropic: { ok: false, keyMissing: false, model: 'test-model', error: 'Anthropic returned 500: boom' },
      },
    })
    render(<PlatformHealthPanel />)
    await waitFor(() => expect(screen.getByText('Down')).toBeInTheDocument())
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('Anthropic ping returned an error')).toBeInTheDocument()
  })
})
