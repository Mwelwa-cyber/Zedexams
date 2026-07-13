import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeachingProfilePanel from './TeachingProfilePanel'

// Auth: a signed-in teacher with a school name (for the completion "school" item).
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    currentUser: { uid: 'uid-1' },
    userProfile: { school: 'Leopards Hill Primary' },
  })),
}))

// Service: fully mocked IO so the real hook/core/resolver run against fixtures.
// vi.hoisted so the object exists when the (hoisted) vi.mock factory runs.
const svc = vi.hoisted(() => ({
  getTeachingProfile: vi.fn(),
  listAssignments: vi.fn(),
  addAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  removeAssignment: vi.fn(),
  setDefaultAssignment: vi.fn(),
  saveTeachingProfile: vi.fn(),
}))
vi.mock('../../../utils/teachingProfileService', () => svc)

function renderPanel() {
  return render(
    <MemoryRouter>
      <TeachingProfilePanel />
    </MemoryRouter>,
  )
}

const PROFILE = {
  calendarId: 'moe-national',
  calendarSource: 'national',
  academicYear: '2026',
  defaultAssignmentId: 'a1',
  onboardingCompleted: true,
}
const ASSIGNMENTS = [
  { id: 'a1', grade: 'G4', subject: 'integrated_science', className: '', curriculumType: 'cbc', periodsPerWeek: 3, isActive: true, isDefault: true },
  { id: 'a2', grade: 'G4', subject: 'mathematics', className: '', curriculumType: 'cbc', periodsPerWeek: 5, isActive: true, isDefault: false },
]

describe('TeachingProfilePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    svc.getTeachingProfile.mockResolvedValue(PROFILE)
    svc.listAssignments.mockResolvedValue(ASSIGNMENTS)
    svc.addAssignment.mockResolvedValue({ id: 'a3' })
    svc.updateAssignment.mockResolvedValue({})
    svc.removeAssignment.mockResolvedValue()
    svc.setDefaultAssignment.mockResolvedValue()
    svc.saveTeachingProfile.mockResolvedValue({})
  })

  it('renders completion, calendar heading and assignment cards', async () => {
    renderPanel()
    expect(await screen.findByText('Grade 4 — Integrated Science')).toBeInTheDocument()
    expect(screen.getByText('Grade 4 — Mathematics')).toBeInTheDocument()
    expect(screen.getByText(/% complete/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'School Calendar' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your Teaching Assignments' })).toBeInTheDocument()
    // The default assignment shows a Default badge.
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('shows the set-up empty state when there is no profile yet', async () => {
    svc.getTeachingProfile.mockResolvedValue(null)
    svc.listAssignments.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Set up your Teaching Profile')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /Set up Teaching Profile/i })
    fireEvent.click(btn)
    await waitFor(() => expect(svc.saveTeachingProfile).toHaveBeenCalledWith('uid-1', expect.objectContaining({ calendarSource: 'national' })))
  })

  it('opens the add-assignment modal', async () => {
    renderPanel()
    await screen.findByText('Grade 4 — Integrated Science')
    fireEvent.click(screen.getAllByRole('button', { name: /Add teaching assignment/i })[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add teaching assignment' })).toBeInTheDocument()
  })

  it('confirms before removing an assignment and never deletes documents', async () => {
    renderPanel()
    await screen.findByText('Grade 4 — Integrated Science')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    // Confirm dialog copy reassures that existing documents are preserved.
    expect(await screen.findByText(/will not be deleted/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove assignment' }))
    await waitFor(() => expect(svc.removeAssignment).toHaveBeenCalledWith('uid-1', 'a1'))
  })
})
