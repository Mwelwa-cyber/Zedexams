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

// The assignment modal embeds StudioCurriculumSelector, whose data layer
// (curriculumDataService → syllabusKbService) imports firebase/config. Stub the
// syllabi source so the import chain stays firebase-free; an empty catalog is
// fine — these tests don't drive the cascade.
vi.mock('../../../utils/syllabusKbService', () => ({
  getMergedSyllabi: vi.fn(() => Promise.resolve({})),
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

// Library service is only used to infer migration suggestions; stub it so the
// spec never pulls in firebase/config. Default: no prior work → no suggestions.
// Hoisted so the tests can assert WHEN the inference reads run (they must not
// run at all for a teacher with a completed profile).
const inferenceReads = vi.hoisted(() => ({
  listMyGenerations: vi.fn(() => Promise.resolve([])),
  getMyAssessments: vi.fn(() => Promise.resolve([])),
  hasGenerationOfTool: vi.fn(() => Promise.resolve(false)),
}))
vi.mock('../../../utils/teacherLibraryService', () => ({
  listMyGenerations: inferenceReads.listMyGenerations,
  hasGenerationOfTool: inferenceReads.hasGenerationOfTool,
}))
// Same for the assessments read (broader migration inference).
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({ getMyAssessments: inferenceReads.getMyAssessments }),
}))

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
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'School Calendar' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your Teaching Assignments' })).toBeInTheDocument()
    // The default assignment shows a Default badge.
    expect(screen.getByText('Default')).toBeInTheDocument()
    // Completed profile → the migration inference reads never run.
    expect(inferenceReads.listMyGenerations).not.toHaveBeenCalled()
    expect(inferenceReads.getMyAssessments).not.toHaveBeenCalled()
  })

  it('shows the no-assignments-found empty state when there is no profile yet', async () => {
    svc.getTeachingProfile.mockResolvedValue(null)
    svc.listAssignments.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('No teaching assignments found')).toBeInTheDocument()
    expect(screen.getByText(/could not confidently identify assignments/i)).toBeInTheDocument()
    // No profile → inference runs once, and the assessments read is bounded
    // (explicit small limit, never the teacher's full assessment history).
    await waitFor(() => expect(inferenceReads.getMyAssessments).toHaveBeenCalledTimes(1))
    expect(inferenceReads.getMyAssessments).toHaveBeenCalledWith('uid-1', 60)
    expect(inferenceReads.listMyGenerations).toHaveBeenCalledTimes(1)
    const btn = screen.getByRole('button', { name: /Set up manually/i })
    fireEvent.click(btn)
    // Launches the four-step setup wizard (no immediate write).
    expect(await screen.findByText('Tell us about your school')).toBeInTheDocument()
  })

  it('marks Scheme of Work / Class Timetable as connected when the teacher has one saved', async () => {
    inferenceReads.hasGenerationOfTool.mockImplementation((_uid, tool) =>
      Promise.resolve(tool === 'scheme_of_work'))
    renderPanel()
    await screen.findByText('Grade 4 — Integrated Science')
    // The probes are limit(1) existence checks for exactly these two tools.
    await waitFor(() => expect(inferenceReads.hasGenerationOfTool).toHaveBeenCalledWith('uid-1', 'scheme_of_work'))
    expect(inferenceReads.hasGenerationOfTool).toHaveBeenCalledWith('uid-1', 'class_timetable')
    await waitFor(() =>
      expect(screen.getByText('Scheme of Work connected').closest('li')).toHaveClass('is-done'))
    // The timetable probe returned false → stays an optional to-do.
    const timetable = screen.getByText('Class Timetable connected').closest('li')
    expect(timetable).not.toHaveClass('is-done')
  })

  it('keeps the recommended items at Optional when the probes fail', async () => {
    inferenceReads.hasGenerationOfTool.mockRejectedValue(new Error('offline'))
    renderPanel()
    await screen.findByText('Grade 4 — Integrated Science')
    expect(screen.getByText('Scheme of Work connected').closest('li')).not.toHaveClass('is-done')
  })

  describe('detected assignments (no profile, prior work found)', () => {
    beforeEach(() => {
      svc.getTeachingProfile.mockResolvedValue(null)
      svc.listAssignments.mockResolvedValue([])
      // Two suggestions after normalisation: the messy Grade-4 maths titles
      // collapse into ONE row; Grade 5 English stays separate.
      inferenceReads.listMyGenerations.mockResolvedValue([
        { id: 'g1', tool: 'lesson_plan', inputs: { grade: 'G4', subject: 'Mathematics', curriculum: 'cbc' } },
        { id: 'g2', tool: 'scheme_of_work', inputs: { grade: '4', subject: 'Mathematics Syllabus (Grades 4–6)', curriculum: 'CBC' } },
        { id: 'g3', tool: 'worksheet', inputs: { grade: 'G5', subject: 'English', curriculum: 'cbc' } },
      ])
    })

    it('renders deduplicated, normalised rows with a dynamic count', async () => {
      renderPanel()
      expect(await screen.findByText('Teaching assignments found (2)')).toBeInTheDocument()
      expect(screen.getByText('Grade 4 · Mathematics')).toBeInTheDocument()
      expect(screen.queryByText(/Syllabus \(Grades 4–6\)/)).toBeNull()
      expect(screen.getByText(/From 2 documents/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add 2 & continue/i })).toBeEnabled()
    })

    it('saves ONLY the selected normalised assignments on continue', async () => {
      renderPanel()
      await screen.findByText('Grade 4 · Mathematics')
      // Untick Grade 5 English (checkboxes follow list order: maths first — 2 docs).
      fireEvent.click(screen.getAllByRole('checkbox')[1])
      expect(screen.getByText('1 selected')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Add 1 & continue' }))
      await waitFor(() => expect(svc.addAssignment).toHaveBeenCalledTimes(1))
      expect(svc.addAssignment).toHaveBeenCalledWith('uid-1', expect.objectContaining({
        grade: 'G4', subject: 'mathematics', curriculumType: 'cbc',
      }))
    })

    it('select all / clear all drive the selected count', async () => {
      renderPanel()
      await screen.findByText('2 selected')
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
      expect(screen.getByText('No assignments selected')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add 0 & continue/i })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
      expect(screen.getByText('2 selected')).toBeInTheDocument()
    })

    it('a failed save keeps the selections and shows an accessible error', async () => {
      svc.addAssignment.mockRejectedValue(new Error('offline'))
      renderPanel()
      await screen.findByText('Grade 4 · Mathematics')
      fireEvent.click(screen.getByRole('button', { name: /add 2 & continue/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not add those assignments/i)
      // Selections preserved for a retry.
      const boxes = screen.getAllByRole('checkbox')
      expect(boxes).toHaveLength(2)
      boxes.forEach((box) => expect(box).toBeChecked())
      expect(screen.getByRole('button', { name: /add 2 & continue/i })).toBeEnabled()
    })
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
