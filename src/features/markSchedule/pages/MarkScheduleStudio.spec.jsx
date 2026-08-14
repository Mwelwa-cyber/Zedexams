import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarkScheduleStudio from './MarkScheduleStudio.jsx'

// Mark Schedule Studio UI overhaul — behaviour pins:
//   (a) CBC arrives pre-selected, so the grade select is live on first render
//   (b) the standalone Subject select is gone (per-column subjects only)
//   (c) live Total / % / Pos columns use dense ranking (ties share a place)
//   (d) Import from Class List fills rows from a register's active roster
//       and never wipes an already-typed row
//   (e) the Download menu lists the three exports, disabled with no artifact
//
// Mocking follows HomeworkStudio.spec.jsx: everything firebase-backed is
// stubbed so the studio renders in jsdom; the REAL StudioCurriculumSelector
// runs (its syllabus data hooks are mocked) because (a)/(b) are about it.

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher-1' }, userProfile: {}, isAdmin: false }),
}))
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} } }),
}))

// Universal Draft Manager (PlatformSettings + Firestore) — stubbed idle.
vi.mock('../../../hooks/draft/useDraftManager', () => ({
  useDraftManager: () => ({
    status: 'idle',
    savedAt: null,
    online: true,
    clear: vi.fn(() => Promise.resolve()),
  }),
}))
vi.mock('../../../shared/components/DraftRecoveryPrompt', () => ({ default: () => null }))
vi.mock('../../../shared/components/DraftStatusIndicator', () => ({ default: () => null }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

// Library persistence + exports — firebase/docx heavy, not under test.
vi.mock('../../../utils/teacherLibraryService', () => ({
  saveMarkScheduleGeneration: vi.fn(async () => 'gen-1'),
  isFreePlanTeacher: () => false,
}))
vi.mock('../../../hooks/useLibraryAutoSave', () => ({ useLibraryAutoSave: () => {} }))
vi.mock('../../../engines/export-engine/markScheduleToDocx', () => ({ downloadMarkScheduleDocx: vi.fn() }))
vi.mock('../../../engines/export-engine/markScheduleToXlsx', () => ({ downloadMarkScheduleXlsx: vi.fn() }))
vi.mock('../../../engines/export-engine/reportCardsToDocx', () => ({ downloadReportCardsDocx: vi.fn() }))
vi.mock('../../../utils/downloadFilename', () => ({ buildDownloadName: vi.fn(() => 'file') }))
vi.mock('../components/MarkScheduleView', () => ({
  default: () => <div data-testid="schedule-view" />,
}))

// Class Register data layer (firebase) — the import flow under test drives
// these mocks.
vi.mock('../../../utils/classRegister', () => ({ listTeacherRegisters: vi.fn() }))
vi.mock('../../../utils/classRoster', () => ({ listRoster: vi.fn() }))

// The REAL StudioCurriculumSelector renders; only its syllabus-backed data
// hooks (firebase-fed) are stubbed. available: null = "availability unknown,
// offer the full grade list" — the selector's documented fallback.
vi.mock('../../../components/teacher/studio/hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: () => ({ available: null, loading: false }),
}))
vi.mock('../../../components/teacher/studio/hooks/useSubjectsForGrade.js', () => ({
  useSubjectsForGrade: () => ({ subjects: [], loading: false }),
}))
vi.mock('../../../components/teacher/studio/hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: () => ({ topics: [], loading: false, error: null }),
}))
vi.mock('../../../components/teacher/studio/hooks/useSubtopicDetail.js', () => ({
  useSubtopicDetail: () => ({ subtopicRow: null }),
}))

async function renderStudio() {
  const view = render(
    <MemoryRouter>
      <MarkScheduleStudio />
    </MemoryRouter>,
  )
  // Flush the fire-and-forget registers fetch so no state lands outside act.
  await act(async () => {})
  return view
}

beforeEach(async () => {
  vi.clearAllMocks()
  const { listTeacherRegisters } = await import('../../../utils/classRegister')
  listTeacherRegisters.mockResolvedValue([])
})

describe('MarkScheduleStudio — overhauled UI', () => {
  it('pre-selects CBC so the grade select is enabled immediately on first render', async () => {
    await renderStudio()

    const cbc = screen.getByRole('radio', { name: /CBC/ })
    expect(cbc).toHaveAttribute('aria-checked', 'true')

    const gradeSelect = screen.getByLabelText('Class / Grade')
    expect(gradeSelect).not.toBeDisabled()
    // Live cascade: the placeholder is the ready state, never the disabled chain.
    expect(gradeSelect.options[0].textContent).toBe('Select class…')
    expect(screen.queryByText('Choose a curriculum first…')).toBeNull()
  })

  it('renders no standalone Subject select (per-column subjects only)', async () => {
    await renderStudio()

    expect(screen.queryByRole('combobox', { name: 'Subject' })).toBeNull()
    expect(screen.queryByLabelText('Subject', { exact: true })).toBeNull()
    // The per-column subject chips are still there.
    expect(screen.getAllByLabelText('Subject name').length).toBeGreaterThan(0)
  })

  it('shows live Total / % / Pos cells with dense ranking (ties share a position)', async () => {
    await renderStudio()

    fireEvent.change(screen.getByLabelText('Pupil 1 name'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('Pupil 2 name'), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByLabelText('Pupil 3 name'), { target: { value: 'Carol' } })

    fireEvent.change(screen.getByLabelText('Alice MATHS mark'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Bob MATHS mark'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Carol MATHS mark'), { target: { value: '10' } })

    // Default subjects max out at 25+25+26+26+25 = 127.
    expect(screen.getByText('Total /127')).toBeInTheDocument()
    expect(screen.getByTestId('pupil-total-0')).toHaveTextContent('20')
    expect(screen.getByTestId('pupil-percent-0')).toHaveTextContent('16%') // round(20/127*100)
    // Dense ranking: Alice and Bob tie on 20 and SHARE position 1; Carol is 2.
    expect(screen.getByTestId('pupil-pos-0')).toHaveTextContent('1')
    expect(screen.getByTestId('pupil-pos-1')).toHaveTextContent('1')
    expect(screen.getByTestId('pupil-pos-2')).toHaveTextContent('2')
    // A blank-name row shows no computed values.
    expect(screen.getByTestId('pupil-pos-3')).toHaveTextContent('—')
  })

  it('imports a class list: active learners fill rows in order, typed rows are kept', async () => {
    const { listTeacherRegisters } = await import('../../../utils/classRegister')
    const { listRoster } = await import('../../../utils/classRoster')
    listTeacherRegisters.mockResolvedValue([
      {
        id: 'reg-1',
        className: '4 Blue',
        grade: '4',
        year: '2026',
        school: 'Kabulonga Primary',
        learnerCount: 3,
        status: 'active',
      },
    ])
    listRoster.mockResolvedValue([
      { id: 'l1', fullName: 'Bwalya Mwansa', status: 'active', order: 1 },
      { id: 'l2', fullName: 'Chanda Zulu', status: 'inactive', order: 2 },
      { id: 'l3', fullName: 'Mutale Banda', status: 'active', order: 3 },
    ])

    await renderStudio()

    // A row the teacher already typed must survive the import.
    fireEvent.change(screen.getByLabelText('Pupil 1 name'), { target: { value: 'Alice' } })

    // The button carries the learner-count badge once registers load.
    const importBtn = await screen.findByRole('button', { name: /Import from Class List · 3/ })
    fireEvent.click(importBtn)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /4 Blue/ }))

    await waitFor(() => {
      const names = screen.getAllByPlaceholderText('Full name').map((i) => i.value)
      // Blank rows are replaced, the named row is kept first, active learners
      // (never the inactive Chanda) append in register order.
      expect(names).toEqual(['Alice', 'Bwalya Mwansa', 'Mutale Banda'])
    })
    expect(listRoster).toHaveBeenCalledWith('reg-1')
    // Modal closed after a successful import.
    expect(screen.queryByRole('dialog')).toBeNull()
    // Header seeding: empty school + default grade picked up from the register.
    expect(screen.getByLabelText('Class / Grade')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Kabulonga Primary')).toBeInTheDocument()
  })

  it('lists the three exports in the Download menu, disabled while there is no artifact', async () => {
    await renderStudio()

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    const excel = screen.getByRole('menuitem', { name: /Excel \(live formulas\)/ })
    const word = screen.getByRole('menuitem', { name: /Word \(landscape\)/ })
    const cards = screen.getByRole('menuitem', { name: /Report cards \(\.docx\)/ })
    for (const item of [excel, word, cards]) {
      expect(item).toBeDisabled()
      expect(item).toHaveAttribute('title', 'Add pupils and marks first')
    }
    // Save to library is the standalone primary, disabled the same way.
    expect(screen.getByRole('button', { name: 'Save to library' })).toBeDisabled()
  })
})
