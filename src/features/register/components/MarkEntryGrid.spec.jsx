import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import MarkEntryGrid from './MarkEntryGrid'

const saveRecordMarks = vi.fn(async () => ({ count: 1, classAverage: 80, classAverageMark: 8, highest: 8, lowest: 8, passRate: 100 }))
vi.mock('../../../utils/classRecords', () => ({
  saveRecordMarks: (...args) => saveRecordMarks(...args),
}))
vi.mock('../../../shared/components/Toast', () => ({
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

  it('shows an ECZ SBA /10 column for SBA records', () => {
    const sbaRecord = { ...record, type: 'sba' } // columns max 100
    render(<MarkEntryGrid classId="c1" record={sbaRecord} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('SBA /10')).toBeInTheDocument()
    // Mary 45 + 45 = 90/100 → 9/10.
    fireEvent.change(screen.getByLabelText('Maths mark for Mary Banda'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('English mark for Mary Banda'), { target: { value: '45' } })
    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
  })

  it('hides the SBA /10 column for non-SBA records', () => {
    render(<MarkEntryGrid classId="c1" record={record} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.queryByText('SBA /10')).not.toBeInTheDocument()
  })

  it('shows a Final /30 total and no CBC grade for sba_final records', () => {
    const finalRecord = {
      id: 'f1',
      title: 'Final SBA',
      type: 'sba_final',
      columns: [
        { key: 'g5', label: 'Grade 5 (/10)', max: 10 },
        { key: 'g6', label: 'Grade 6 (/10)', max: 10 },
        { key: 'g7', label: 'Grade 7 (/10)', max: 10 },
      ],
      rosterSnapshot: [{ rosterId: 'a', fullName: 'Mary Banda', learnerNumber: '1' }],
      marks: { a: { g5: 8, g6: 9, g7: 9 } }, // 26/30
    }
    render(<MarkEntryGrid classId="c1" record={finalRecord} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('Final /30')).toBeInTheDocument()
    expect(screen.queryByText('Grade')).not.toBeInTheDocument()
    expect(screen.getAllByText('26').length).toBeGreaterThan(0) // total
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

  // [Bug fix #3] Back button dirty-state guard ——————————————————————————————

  it('calls onClose immediately when not dirty', () => {
    const onClose = vi.fn()
    render(<MarkEntryGrid classId="c1" record={record} onClose={onClose} onSaved={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Back to mark schedules/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a confirm when dirty and does NOT close if the user declines', () => {
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MarkEntryGrid classId="c1" record={record} onClose={onClose} onSaved={() => {}} />)
    // Enter a mark to set dirty=true
    fireEvent.change(screen.getByLabelText('Maths mark for Mary Banda'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /Back to mark schedules/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('closes when dirty and the user confirms leaving', () => {
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MarkEntryGrid classId="c1" record={record} onClose={onClose} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('Maths mark for Mary Banda'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /Back to mark schedules/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })
})
