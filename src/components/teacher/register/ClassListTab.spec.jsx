import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

import ClassListTab from './ClassListTab'

// The roster + register services hit Firestore; stub them. The behaviour under
// test — render the roster, and add a learner through the inline form — lives
// in the component, not the network.
const addRosterEntry = vi.fn(async () => 'new-id')
let rosterRows = []
// Tracks how many times subscribeRoster has been called (used by the
// onRosterChange stability regression test).
let subscribeCallCount = 0
const capturedOnData = { current: null }
vi.mock('../../../utils/classRoster', () => ({
  subscribeRoster: (_classId, onData) => {
    subscribeCallCount += 1
    capturedOnData.current = onData
    onData(rosterRows)
    return () => {}
  },
  addRosterEntry: (...args) => addRosterEntry(...args),
  updateRosterEntry: vi.fn(async () => {}),
  setRosterStatus: vi.fn(async () => {}),
  removeRosterEntry: vi.fn(async () => {}),
  // Imported by RosterImportModal (mounted lazily, but the module loads).
  bulkAddRoster: vi.fn(async () => ({ added: 0, skipped: 0 })),
  listImportableAccounts: vi.fn(async () => []),
  importExistingAccounts: vi.fn(async () => ({ added: 0, skipped: 0 })),
  parseRosterFile: vi.fn(async () => ({ rows: [], summary: { total: 0, ok: 0, warning: 0, error: 0 } })),
}))

// ClassListTab + NewLearnerSyncModal pull in classRecords (→ firebase/config),
// which can't initialise in jsdom — stub it. No current-term records, so the
// new-learner sync prompt never opens.
vi.mock('../../../utils/classRecords', () => ({
  recordsMissingLearner: vi.fn(async () => []),
  reconcileNewLearner: vi.fn(async () => 0),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher-1' } }),
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

const register = { id: 'class-1', className: 'Grade 4 Blue', grade: '4', learnerCount: 0 }

describe('ClassListTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterRows = []
    subscribeCallCount = 0
    capturedOnData.current = null
  })

  it('renders existing roster learners', () => {
    rosterRows = [
      { id: 'r1', fullName: 'Mary Banda', learnerNumber: '1', gender: 'F', parentPhone: null, status: 'active' },
      { id: 'r2', fullName: 'John Phiri', learnerNumber: '2', gender: 'M', parentPhone: null, status: 'active' },
    ]
    render(<ClassListTab register={register} />)
    // Name shows in both the table and the mobile card list.
    expect(screen.getAllByText('Mary Banda').length).toBeGreaterThan(0)
    expect(screen.getAllByText('John Phiri').length).toBeGreaterThan(0)
    // Active count is rendered (split across a styled span + text node).
    expect(screen.getByText(
      (_, el) => el?.tagName === 'P' && /\b2\b\s*active/.test(el.textContent.replace(/\s+/g, ' ')),
    )).toBeInTheDocument()
  })

  it('shows an empty state when there are no learners', () => {
    render(<ClassListTab register={register} />)
    expect(screen.getByText(/No learners yet/i)).toBeInTheDocument()
  })

  it('adds a learner through the inline form', async () => {
    render(<ClassListTab register={register} />)
    const nameInput = screen.getByPlaceholderText('Full name')
    fireEvent.change(nameInput, { target: { value: 'Grace Mwale' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addRosterEntry).toHaveBeenCalledTimes(1))
    expect(addRosterEntry).toHaveBeenCalledWith(
      'class-1',
      'teacher-1',
      expect.objectContaining({ fullName: 'Grace Mwale' }),
    )
  })

  it('does not re-subscribe when the onRosterChange prop reference changes (regression: infinite loading bug)', async () => {
    // Regression test: the parent (ClassRegisterDetail) passes an inline arrow
    // function as onRosterChange. Before the fix, that new reference on each
    // re-render was in the useEffect dependency array, causing the subscription
    // to tear down + restart → setLoading(true) → "Loading roster…" forever.
    //
    // The fix holds onRosterChange in a ref so the subscription is bound only
    // to classId. We verify: (a) the roster renders after initial load, and
    // (b) subscribeRoster is NOT called a second time when the prop changes.
    rosterRows = [
      { id: 'r1', fullName: 'Alice Phiri', learnerNumber: '1', gender: 'F', parentPhone: null, status: 'active' },
    ]

    // Simulate a parent component that creates a new onRosterChange arrow each render.
    const { rerender } = render(
      <ClassListTab register={register} onRosterChange={() => {}} />,
    )

    // Roster should be visible after first render.
    expect(screen.queryByText(/Loading roster/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Alice Phiri').length).toBeGreaterThan(0)
    const callsAfterMount = subscribeCallCount

    // Re-render with a brand-new function reference (simulating parent state change).
    act(() => {
      rerender(<ClassListTab register={register} onRosterChange={() => {}} />)
    })

    // The subscription must NOT have been restarted — subscribeCallCount unchanged.
    expect(subscribeCallCount).toBe(callsAfterMount)
    // Roster must still be visible, not back to "Loading roster…".
    expect(screen.queryByText(/Loading roster/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Alice Phiri').length).toBeGreaterThan(0)
  })
})
