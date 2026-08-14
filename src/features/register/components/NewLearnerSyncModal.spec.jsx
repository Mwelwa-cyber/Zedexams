import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import NewLearnerSyncModal from './NewLearnerSyncModal'

const reconcileNewLearner = vi.fn(async () => 2)
vi.mock('../../../utils/classRecords', () => ({
  reconcileNewLearner: (...args) => reconcileNewLearner(...args),
}))
vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

const register = { id: 'c1', term: 'Term 2', year: 2026 }
const learner = { id: 'r9', fullName: 'New Pupil', learnerNumber: '9', gender: 'M' }
const records = [
  { id: 'rec1', title: 'Maths Test' },
  { id: 'rec2', title: 'English Test' },
]

describe('NewLearnerSyncModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to all current-term records', async () => {
    const onDone = vi.fn()
    render(<NewLearnerSyncModal register={register} learner={learner} records={records} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add learner' }))
    await waitFor(() => expect(reconcileNewLearner).toHaveBeenCalledTimes(1))
    expect(reconcileNewLearner).toHaveBeenCalledWith('c1', learner, expect.objectContaining({ scope: 'all-term', term: 'Term 2', year: 2026 }))
    expect(onDone).toHaveBeenCalled()
  })

  it('"don\'t add" passes scope none', async () => {
    render(<NewLearnerSyncModal register={register} learner={learner} records={records} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Don.t add to any/i))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(reconcileNewLearner).toHaveBeenCalledWith('c1', learner, expect.objectContaining({ scope: 'none' })))
  })
})
