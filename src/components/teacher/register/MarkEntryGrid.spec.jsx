import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import MarkEntryGrid from './MarkEntryGrid'

const saveRecordMarks = vi.fn(async () => ({ count: 1, classAverage: 80, classAverageMark: 8, highest: 8, lowest: 8, passRate: 100 }))
vi.mock('../../../utils/classRecords', () => ({
  saveRecordMarks: (...args) => saveRecordMarks(...args),
}))
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

const record = {
  id: 'rec-1',
  title: 'Mid-term Test',
  columns: [{ key: 'maths', label: 'Maths', max: 50 }, { key: 'eng', label: 'English', max: 50 }],
  rosterSnapshot: [
    { rosterId: 'a', fullName: 'Mary Banda', learnerNumber: '1' },
    { rosterId: 'b', fullName: 'John Phiri', learnerNumber: '2' },
  ],
  marks: {},
}

describe('MarkEntryGrid', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-loads roster learners (no retyping)', () => {
    render(<MarkEntryGrid classId="c1" record={record} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('Mary Banda')).toBeInTheDocument()
    expect(screen.getByText('John Phiri')).toBeInTheDocument()
  })

  it('recomputes total + grade live as marks are entered', () => {
    render(<MarkEntryGrid classId="c1" record={record} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('Maths mark for Mary Banda'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('English mark for Mary Banda'), { target: { value: '45' } })
    // 90/100 = 90% → Excellent. "90" shows in the total cell and the
    // "Highest" stat; the grade label is unique to Mary's row.
    expect(screen.getAllByText('90').length).toBeGreaterThan(0)
    expect(screen.getByText('Excellent')).toBeInTheDocument()
  })

  it('saves the entered marks', async () => {
    render(<MarkEntryGrid classId="c1" record={record} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('Maths mark for Mary Banda'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save marks' }))
    await waitFor(() => expect(saveRecordMarks).toHaveBeenCalledTimes(1))
    const [classId, recordId, payload] = saveRecordMarks.mock.calls[0]
    expect(classId).toBe('c1')
    expect(recordId).toBe('rec-1')
    expect(payload.marks.a.maths).toBe(40)
  })
})
