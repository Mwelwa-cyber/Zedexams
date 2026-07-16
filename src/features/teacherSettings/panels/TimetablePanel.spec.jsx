import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TimetablePanel from './TimetablePanel'

// Auth: a signed-in teacher whose users/{uid}.timetable is set per-test.
const auth = vi.hoisted(() => ({
  userProfile: { timetable: null },
  updateProfileFields: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    currentUser: { uid: 'uid-1' },
    userProfile: auth.userProfile,
    updateProfileFields: auth.updateProfileFields,
  })),
}))

// Teaching profile: fixture assignments (curriculum-validated by the real core).
const profile = vi.hoisted(() => ({ assignments: [] }))
vi.mock('../lib/useTeachingProfile', () => ({
  useTeachingProfile: vi.fn(() => ({
    uid: 'uid-1',
    loading: false,
    assignments: profile.assignments,
  })),
}))

// Draft manager: pure pass-through (IndexedDB/cloud sync is out of spec scope).
vi.mock('../../../hooks/draft/useDraftManager', () => ({
  useDraftManager: vi.fn(() => ({
    status: 'idle',
    savedAt: null,
    online: true,
    recovery: { available: false, payload: null, source: null },
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    clear: vi.fn(),
  })),
}))

// Library service: no saved class timetables unless a test injects them.
const lib = vi.hoisted(() => ({
  listMyGenerations: vi.fn(() => Promise.resolve([])),
  getGeneration: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../../utils/teacherLibraryService', () => lib)

const A_ENG = {
  id: 'a_eng', grade: 'G5', subject: 'english', className: 'Grade 5 Blue',
  curriculumType: 'cbc', periodsPerWeek: 6, lessonDurationMinutes: 40, isActive: true,
}
const A_LIT = {
  id: 'a_lit', grade: 'G2', subject: 'literacy', className: '',
  curriculumType: 'cbc', periodsPerWeek: 4, lessonDurationMinutes: 30, isActive: true,
}
// G7 does not exist under the CBC — fails validateAssignment.
const A_BAD = {
  id: 'a_bad', grade: 'G7', subject: 'mathematics', className: '',
  curriculumType: 'cbc', periodsPerWeek: 5, isActive: true,
}

const V2_DOC = {
  schemaVersion: 2,
  defaultPeriodLengthMinutes: 40,
  displayPreferences: { timetableLayout: 'days-as-columns', viewMode: 'grid' },
  scheduleBlocks: [
    {
      blockId: 'b1', day: 'mon', startTime: '08:15', endTime: '09:35',
      lengthInPeriods: 2, assignmentId: 'a_eng', sourceType: 'manual',
      snapshot: { label: 'Grade 5 · English · Grade 5 Blue', grade: 'G5', subject: 'english', className: 'Grade 5 Blue', curriculumType: 'cbc' },
    },
    {
      blockId: 'b2', day: 'tue', startTime: '08:15', endTime: '08:45',
      lengthInPeriods: 1, assignmentId: 'a_lit', sourceType: 'class-timetable',
      classTimetableId: 'ct1', scheduleBlockId: 'sb1', locked: true,
      snapshot: { label: 'Grade 2 · Literacy', grade: 'G2', subject: 'literacy', className: '', curriculumType: 'cbc' },
    },
  ],
  legacyV1: null,
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <TimetablePanel />
    </MemoryRouter>,
  )
}

describe('TimetablePanel (My Teaching Timetable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.userProfile = { timetable: V2_DOC }
    profile.assignments = [A_ENG, A_LIT]
  })

  it('renders the renamed page with workload figures computed from blocks', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'My Teaching Timetable' })).toBeInTheDocument()
    expect(screen.getByText('Your weekly teaching schedule, workload and assignment coverage')).toBeInTheDocument()
    // Assigned 6+4=10; scheduled 2 (double) + 1 = 3; teaching time 80+30 min.
    expect(screen.getByText('10 periods')).toBeInTheDocument()
    expect(screen.getByText('3 periods')).toBeInTheDocument()
    expect(screen.getByText('1 h 50 min')).toBeInTheDocument()
  })

  it('shows per-assignment coverage with remaining counts and statuses', () => {
    renderPanel()
    const table = screen.getByRole('table', { name: 'Assignment coverage' })
    const rows = within(table).getAllByRole('row')
    const eng = rows.find((r) => r.textContent.includes('English'))
    expect(within(eng).getByText('6')).toBeInTheDocument() // required
    expect(within(eng).getByText('4')).toBeInTheDocument() // remaining
    expect(within(eng).getByText('Incomplete')).toBeInTheDocument()
  })

  it('marks an invalid assignment (CBC Grade 7) as Invalid in coverage', () => {
    profile.assignments = [A_ENG, A_BAD]
    renderPanel()
    expect(screen.getByText('Invalid')).toBeInTheDocument()
  })

  it('renders identical block data in both orientations — switching layout never moves periods', () => {
    renderPanel()
    // days-as-columns: days are column headers, time is the row header.
    expect(screen.getByRole('region', { name: /days across the top/i })).toBeInTheDocument()
    expect(screen.getAllByText('Grade 5 · English · Grade 5 Blue').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Timetable layout'), { target: { value: 'days-as-rows' } })
    expect(screen.getByRole('region', { name: /days down the left/i })).toBeInTheDocument()
    // Same block, same times, in the other orientation.
    expect(screen.getAllByText('Grade 5 · English · Grade 5 Blue').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/08:15–09:35/).length).toBeGreaterThan(0)
  })

  it('saves layout changes through updateProfileFields without altering blocks', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Timetable layout'), { target: { value: 'days-as-rows' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await vi.waitFor(() => expect(auth.updateProfileFields).toHaveBeenCalled())
    const saved = auth.updateProfileFields.mock.calls[0][0].timetable
    expect(saved.displayPreferences.timetableLayout).toBe('days-as-rows')
    expect(saved.scheduleBlocks).toHaveLength(2)
    expect(saved.scheduleBlocks.find((b) => b.blockId === 'b1').startTime).toBe('08:15')
  })

  it('offers list and daily views over the same schedule data', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'List view' }))
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.getByText(/Linked from Class Timetable/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Daily view' }))
    expect(screen.getByRole('tab', { name: 'Monday' })).toBeInTheDocument()
  })

  it('migrates a legacy v1 timetable: matched rows link, unmatched rows are preserved as Needs review', () => {
    auth.userProfile = {
      timetable: {
        periodMinutes: 40,
        days: {
          mon: [
            { start: '08:15', end: '08:55', subject: 'english', grade: 'G5', label: '' },
            { start: '10:00', end: '10:40', subject: 'integrated_science', grade: 'G7', label: '' },
          ],
        },
      },
    }
    renderPanel()
    // The unmatched Grade 7 science period surfaces the review alert with its
    // original values preserved, and counts in the workload rollup.
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/Needs review/)
    expect(screen.getAllByText(/Grade 7 · Integrated Science/).length).toBeGreaterThan(0)
    const statLabel = screen.getAllByText('Needs review').find((el) => el.tagName === 'DT')
    expect(within(statLabel.closest('div')).getByText('1')).toBeInTheDocument()
  })

  it('period editor lists only the teacher’s assignments; invalid ones are disabled', () => {
    profile.assignments = [A_ENG, A_LIT, A_BAD]
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Add period/ }))
    const select = screen.getByLabelText('Teaching Assignment')
    const options = within(select).getAllByRole('option')
    // Placeholder + 3 assignments, no generic grade/subject lists anywhere.
    expect(options).toHaveLength(4)
    const bad = options.find((o) => o.textContent.includes('needs review'))
    expect(bad).toBeDisabled()
    expect(screen.queryByLabelText(/subject/i)).toBeNull()
  })

  it('rejects an overlapping manual period at save time and blocks the button', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Add period/ }))
    const dialog = screen.getByRole('dialog', { name: 'Add teaching period' })
    fireEvent.change(within(dialog).getByLabelText('Teaching Assignment'), { target: { value: 'a_lit' } })
    // Monday 08:15 clashes with the existing double (08:15–09:35).
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: 'mon' } })
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '08:45' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/overlaps/)
    expect(within(dialog).getByRole('button', { name: 'Add period' })).toBeDisabled()
  })

  it('adds a valid manual period using the assignment’s own duration (not the default)', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Add period/ }))
    const dialog = screen.getByRole('dialog', { name: 'Add teaching period' })
    fireEvent.change(within(dialog).getByLabelText('Teaching Assignment'), { target: { value: 'a_lit' } })
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: 'wed' } })
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '09:00' } })
    // Literacy carries a 30-minute duration; the page default is 40.
    expect(within(dialog).getByText(/09:00–09:30/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add period' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await vi.waitFor(() => expect(auth.updateProfileFields).toHaveBeenCalled())
    const saved = auth.updateProfileFields.mock.calls[0][0].timetable
    const added = saved.scheduleBlocks.find((b) => b.day === 'wed')
    expect(added.durationMinutes).toBe(30)
    expect(added.sourceType).toBe('manual')
    // Linked block durations untouched by the default.
    expect(saved.scheduleBlocks.find((b) => b.blockId === 'b2').durationMinutes).toBe(30)
  })

  it('linked blocks are read-only: clicking opens details with an Open class timetable link', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'List view' }))
    // The assignment label also appears in the coverage table — pick the block card.
    const linkedCard = screen.getAllByText('Grade 2 · Literacy')
      .map((el) => el.closest('button.tset-ttb-block'))
      .find(Boolean)
    fireEvent.click(linkedCard)
    const dialog = screen.getByRole('dialog', { name: 'Linked period details' })
    expect(within(dialog).getByText(/read-only/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open class timetable' }))
      .toHaveAttribute('href', '/teacher/library/ct1')
  })

  it('shows the assignments-first empty state when nothing is scheduled', () => {
    auth.userProfile = { timetable: null }
    profile.assignments = []
    renderPanel()
    expect(screen.getByText('No teaching periods scheduled')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up Teaching Assignments' })).toBeInTheDocument()
  })

  it('shows unscheduled coverage when assignments exist but nothing is scheduled', () => {
    auth.userProfile = { timetable: null }
    renderPanel()
    // Coverage table lists both assignments as Not scheduled with full remaining.
    expect(screen.getAllByText('Not scheduled').length).toBe(2)
    expect(screen.getByText('No teaching periods scheduled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add period manually' })).toBeInTheDocument()
  })

  it('detects a teacher overlap across linked and manual periods', () => {
    auth.userProfile = {
      timetable: {
        ...V2_DOC,
        scheduleBlocks: [
          V2_DOC.scheduleBlocks[0],
          { ...V2_DOC.scheduleBlocks[1], day: 'mon', startTime: '08:45', endTime: '09:15' },
        ],
      },
    }
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Conflicts and warnings' })).toBeInTheDocument()
    expect(screen.getByText(/overlaps a manual period/)).toBeInTheDocument()
  })
})
