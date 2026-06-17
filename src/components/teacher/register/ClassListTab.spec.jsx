import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import ClassListTab from './ClassListTab'

// The roster + register services hit Firestore; stub them. The behaviour under
// test — render the roster, and add a learner through the inline form — lives
// in the component, not the network.
const addRosterEntry = vi.fn(async () => 'new-id')
let rosterRows = []
vi.mock('../../../utils/classRoster', () => ({
  subscribeRoster: (_classId, onData) => { onData(rosterRows); return () => {} },
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
})
