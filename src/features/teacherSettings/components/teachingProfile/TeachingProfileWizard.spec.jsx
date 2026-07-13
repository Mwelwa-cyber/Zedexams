import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeachingProfileWizard from './TeachingProfileWizard'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    currentUser: { uid: 'uid-1' },
    userProfile: { school: '' },
    updateProfileFields: vi.fn().mockResolvedValue(),
  })),
}))

const svc = vi.hoisted(() => ({
  addAssignment: vi.fn(),
  removeAssignment: vi.fn(),
  setDefaultAssignment: vi.fn(),
  saveTeachingProfile: vi.fn(),
}))
vi.mock('../../../../utils/teachingProfileService', () => svc)

const CONTEXT = {
  status: 'ok',
  academicYear: 2026,
  isClosed: false,
  termName: 'Second Term',
  weekNumber: 2,
  weekBeginningLabel: '11 May 2026',
  weekEndingLabel: '15 May 2026',
  nextTerm: { termName: 'Third Term', openLabel: '7 September 2026' },
}
const ASSIGN = [{ id: 'a1', grade: 'G4', subject: 'mathematics', className: '', curriculumType: 'cbc', isActive: true }]

function renderWizard(props = {}) {
  return render(
    <MemoryRouter>
      <TeachingProfileWizard
        uid="uid-1"
        initialProfile={{}}
        initialAssignments={ASSIGN}
        context={CONTEXT}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('TeachingProfileWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    svc.setDefaultAssignment.mockResolvedValue()
    svc.saveTeachingProfile.mockResolvedValue({})
  })

  it('opens on step 1 (School) with the stepper', () => {
    renderWizard()
    expect(screen.getByText('Tell us about your school')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('blocks Next on step 1 until a school level is chosen', () => {
    renderWizard({ initialProfile: {} })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/school level/i)
    // Still on step 1.
    expect(screen.getByText('Tell us about your school')).toBeInTheDocument()
  })

  it('resumes at the review step when school + assignments already exist', () => {
    renderWizard({ initialProfile: { schoolLevel: 'primary', academicYear: '2026' } })
    // Earliest incomplete required step → Review & default (step 4), not step 1.
    expect(screen.getByText('Choose your default teaching view')).toBeInTheDocument()
  })

  it('on exit with saved assignments, reassures they are already saved', async () => {
    const onClose = vi.fn()
    renderWizard({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Exit setup' }))
    expect(await screen.findByText(/have already been saved/i)).toBeInTheDocument()
    // "Finish later" closes; "Continue setup" keeps the wizard.
    fireEvent.click(screen.getByRole('button', { name: 'Finish later' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('walks all four steps and saves an active, onboarded profile', async () => {
    renderWizard()
    // Step 1 → choose level, then Next.
    fireEvent.change(screen.getByLabelText('School level'), { target: { value: 'primary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Step 2 (assignment already present) → Next.
    expect(await screen.findByText('What do you teach?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Step 3 → Next.
    expect(await screen.findByText('Confirm your current teaching period')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Step 4 → Save.
    expect(await screen.findByText('Choose your default teaching view')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Save Teaching Profile/i }))

    await waitFor(() =>
      expect(svc.saveTeachingProfile).toHaveBeenCalledWith(
        'uid-1',
        expect.objectContaining({
          profileStatus: 'active',
          onboardingCompleted: true,
          calendarSource: 'national',
          defaultAssignmentId: 'a1',
        }),
      ),
    )
    expect(svc.setDefaultAssignment).toHaveBeenCalledWith('uid-1', 'a1', ['a1'])
  })
})
