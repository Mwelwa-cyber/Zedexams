import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import ProgressTab from './ProgressTab'

const cols = [{ key: 't', label: 'Test', max: 100 }]
const records = [
  {
    id: 'r2', title: 'Term 1 Exam', term: 'Term 1', year: 2026, type: 'assessment', columns: cols,
    rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary Banda' }, { rosterId: 'b', fullName: 'John Phiri' }],
    marks: { a: { t: 80 }, b: { t: 40 } },
  },
  {
    id: 'r1', title: 'Term 1 Test', term: 'Term 1', year: 2026, type: 'mark_schedule', columns: cols,
    rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary Banda' }, { rosterId: 'b', fullName: 'John Phiri' }],
    marks: { a: { t: 60 }, b: { t: 50 } },
  },
]

vi.mock('../../../utils/classRecords', () => ({
  listRecords: vi.fn(async () => records),
}))

describe('ProgressTab', () => {
  it('shows each learner with their average across records', async () => {
    render(<ProgressTab register={{ id: 'c1', term: 'Term 1', year: 2026 }} />)
    expect(await screen.findByText('Mary Banda')).toBeInTheDocument()
    expect(screen.getByText('John Phiri')).toBeInTheDocument()
    // Mary: (60+80)/2 = 70% average appears.
    expect(screen.getByText('70%')).toBeInTheDocument()
    // Class average row label is present.
    expect(screen.getByText('Class average')).toBeInTheDocument()
  })

  it('shows an empty state when no records are marked', async () => {
    const mod = await import('../../../utils/classRecords')
    mod.listRecords.mockResolvedValueOnce([])
    render(<ProgressTab register={{ id: 'c2' }} />)
    await waitFor(() => expect(screen.getByText(/No progress to show yet/i)).toBeInTheDocument())
  })

  // [Bug fix #14] Load failure renders an error card, not the empty state ——

  it('shows an error card when listRecords rejects', async () => {
    const mod = await import('../../../utils/classRecords')
    mod.listRecords.mockRejectedValueOnce(new Error('Network error'))
    render(<ProgressTab register={{ id: 'c-err', term: 'Term 1', year: 2026 }} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByText(/No progress to show yet/i)).not.toBeInTheDocument()
  })
})
