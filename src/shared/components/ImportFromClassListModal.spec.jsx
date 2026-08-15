import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ImportFromClassListModal from './ImportFromClassListModal.jsx'

// The Mark Schedule studio's Class-List import picker. The firebase-backed
// data layer is mocked; the component's own contract is under test:
// list rendering, the no-registers empty state, self-fetch when the host's
// badge fetch hasn't landed, and the active-only roster handoff to onImport.

vi.mock('../../utils/classRegister', () => ({ listTeacherRegisters: vi.fn() }))
vi.mock('../../utils/classRoster', () => ({ listRoster: vi.fn() }))

const REGISTERS = [
  { id: 'reg-1', className: '4 Blue', grade: '4', year: '2026', school: 'Kabulonga Primary', learnerCount: 3 },
  { id: 'reg-2', className: 'Form 1 West', grade: 'form-1', year: '2026', school: 'Munali Secondary', learnerCount: 41 },
]

function renderModal(props = {}) {
  return render(
    <MemoryRouter>
      <ImportFromClassListModal
        uid="teacher-1"
        registers={REGISTERS}
        onClose={vi.fn()}
        onImport={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ImportFromClassListModal', () => {
  it('lists the provided registers with grade label, year and learner count (no refetch)', async () => {
    const { listTeacherRegisters } = await import('../../utils/classRegister')
    renderModal()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('4 Blue')).toBeInTheDocument()
    expect(screen.getByText(/Grade 4 · 2026 · 3 learners/)).toBeInTheDocument()
    expect(screen.getByText('Form 1 West')).toBeInTheDocument()
    expect(screen.getByText(/Form 1 · 2026 · 41 learners/)).toBeInTheDocument()
    // The host already supplied registers — never refetched.
    expect(listTeacherRegisters).not.toHaveBeenCalled()
  })

  it('explains and links to the Class Register when there are no registers', () => {
    renderModal({ registers: [] })

    expect(screen.getByText('No class lists yet')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Open the Class Register/ })
    expect(link).toHaveAttribute('href', '/teacher/register')
  })

  it('fetches its own registers when the host passes none (registers=null)', async () => {
    const { listTeacherRegisters } = await import('../../utils/classRegister')
    listTeacherRegisters.mockResolvedValue([REGISTERS[0]])

    renderModal({ registers: null })
    await act(async () => {})

    expect(listTeacherRegisters).toHaveBeenCalledWith('teacher-1')
    expect(await screen.findByText('4 Blue')).toBeInTheDocument()
  })

  it('hands onImport the register and only its ACTIVE roster entries, in order', async () => {
    const { listRoster } = await import('../../utils/classRoster')
    listRoster.mockResolvedValue([
      { id: 'l1', fullName: 'Bwalya Mwansa', status: 'active', order: 1 },
      { id: 'l2', fullName: 'Chanda Zulu', status: 'inactive', order: 2 },
      { id: 'l3', fullName: 'Mutale Banda', status: 'active', order: 3 },
    ])
    const onImport = vi.fn()
    renderModal({ onImport })

    fireEvent.click(screen.getByRole('button', { name: /4 Blue/ }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(listRoster).toHaveBeenCalledWith('reg-1')
    const { register, entries } = onImport.mock.calls[0][0]
    expect(register.id).toBe('reg-1')
    expect(entries.map((e) => e.fullName)).toEqual(['Bwalya Mwansa', 'Mutale Banda'])
  })

  it('shows an error (and does not import) when the roster load fails', async () => {
    const { listRoster } = await import('../../utils/classRoster')
    listRoster.mockRejectedValue(new Error('offline'))
    const onImport = vi.fn()
    renderModal({ onImport })

    fireEvent.click(screen.getByRole('button', { name: /4 Blue/ }))

    expect(await screen.findByText(/Could not load that class list/)).toBeInTheDocument()
    expect(onImport).not.toHaveBeenCalled()
  })
})
