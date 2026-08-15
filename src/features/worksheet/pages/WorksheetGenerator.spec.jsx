import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WorksheetGenerator from './WorksheetGenerator.jsx'

// Presentation-refactor guarantees for the Worksheet studio (same mocking
// pattern as HomeworkStudio.spec.jsx):
//   1. The "Set up for you" chips are SINGLE-SOURCE: they derive from the live
//      selector payload, so when the (mocked) selector emits a different
//      subject the chips follow — never frozen on the raw suggestion.
//   2. The three Auto format selects (Worksheet style / Grid columns /
//      Reading passage length) are collapsed inside the "Format & style"
//      disclosure and hidden until it is expanded.

// The generator + the constant exports WorksheetGenerator reads for its selects.
vi.mock('../../../utils/teacherTools', () => ({
  generateWorksheet: vi.fn(),
  generateWorksheetStream: vi.fn(() => () => {}),
  TEACHER_LANGUAGES: [{ value: 'english', label: 'English' }],
  WORKSHEET_DIFFICULTIES: [{ value: 'mixed', label: 'Mixed' }],
  WORKSHEET_STYLES: [{ value: 'auto', label: 'Auto' }, { value: 'grid', label: 'Practice grid' }],
  WORKSHEET_GRID_COLUMNS: [{ value: 0, label: 'Auto' }],
  WORKSHEET_PASSAGE_LENGTHS: [{ value: '', label: 'Auto' }],
  WORKSHEET_QUESTION_COUNTS: [{ value: 10, label: '10 questions' }],
  WORKSHEET_DURATIONS: [{ value: 30, label: '30 min' }],
  CURRICULUM_TERMS: [{ value: '1', label: 'Term 1' }],
  LESSON_NUMBER_OPTIONS: [{ value: '', label: 'Any' }],
  TOTAL_LESSONS_OPTIONS: [{ value: '', label: 'Any' }],
  LEARNING_ENVIRONMENT_OPTIONS: [{ value: '', label: 'Any' }],
}))

// Heavy exporters — never exercised here.
vi.mock('../../../engines/export-engine/worksheetToDocx', () => ({ downloadWorksheetDocx: vi.fn() }))
vi.mock('../../../engines/export-engine/worksheetToPdf', () => ({ downloadWorksheetPdf: vi.fn() }))

// AuthContext + the generation gate stubbed to "allowed".
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' }, userProfile: {}, isAdmin: false }),
}))
vi.mock('../../../hooks/useGenerationGate', () => ({
  useGenerationGate: () => ({ ensureCanGenerate: () => true }),
}))

// URL defaults — no deep-link params, so the studio opens with an EMPTY seed
// (the precondition for the "Set up for you" card).
vi.mock('../../../utils/useFormDefaultsFromUrl', () => ({
  useFormDefaultsFromUrl: () => ({}),
}))

// Firebase-backed side effects — stubbed.
vi.mock('../../../utils/teacherLibraryService', () => ({
  attachLibraryToGeneration: vi.fn(() => Promise.resolve()),
  isFreePlanTeacher: () => false,
}))

// Draft manager — stubbed idle.
vi.mock('../../../hooks/draft/useStudioInputDraft', () => ({
  useStudioInputDraft: () => ({
    status: 'idle',
    savedAt: null,
    online: true,
    flush: vi.fn(),
    clear: vi.fn(() => Promise.resolve()),
  }),
}))
vi.mock('../../../shared/components/DraftStatusIndicator', () => ({ default: () => null }))
vi.mock('../../../shared/components/DraftRecoveryPrompt', () => ({ default: () => null }))

vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../shared/components/LiveGenerationCanvas', () => ({ default: () => null }))
vi.mock('../components/WorksheetView', () => ({ default: () => null }))
vi.mock('../../../shared/components/StudioAssignmentChangeNotice', () => ({ default: () => null }))
vi.mock('../../../shared/components/CreatedFromLessonPlanNotice', () => ({ default: () => null }))

// The Weekly-Forecast suggestion the shell's useStudioSetupForYou consumes —
// present, so the card shows on an empty-seeded studio.
vi.mock('../../../shared/hooks/useTeacherPlanContext', () => ({
  useTeacherPlanContext: () => ({
    loading: false,
    suggestion: {
      grade: 'G4',
      subject: 'mathematics',
      subjectLabel: 'Mathematics',
      topic: '',
      subtopic: '',
      date: '',
      weekNumber: 3,
    },
  }),
}))

// The curriculum selector is mocked to two buttons that emit DIFFERENT live
// payloads — the single-source rule says the card's chips must follow them.
function payload(subjectKey, subjectLabel) {
  return {
    curriculumMode: 'cbc',
    framework: '2023',
    curriculum: 'cbc',
    gradeLabel: 'Grade 4',
    subjectKey,
    subjectLabel,
    topic: 'Fractions',
    subtopic: '',
    subtopicRow: null,
    specificOutcome: '',
    grade: 'G4',
    subject: subjectKey,
  }
}
vi.mock('../../../shared/components/StudioCurriculumSelector', () => ({
  default: ({ onChange }) => (
    <div>
      <button type="button" onClick={() => onChange(payload('mathematics', 'Mathematics'))}>
        emit-maths
      </button>
      <button type="button" onClick={() => onChange(payload('english', 'English'))}>
        emit-english
      </button>
    </div>
  ),
}))

function renderStudio() {
  return render(
    <MemoryRouter>
      <WorksheetGenerator />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('WorksheetGenerator — shared shell presentation', () => {
  it('Set up for you chips follow the LIVE selector payload (single source of truth)', () => {
    renderStudio()

    // The empty-seeded studio applied the suggestion and shows the card.
    expect(screen.getByText(/set up for you/i)).toBeInTheDocument()
    expect(screen.getByText('Week 3')).toBeInTheDocument()

    // Selector emits Mathematics → chips show the live grade/subject + CBC tick.
    fireEvent.click(screen.getByRole('button', { name: 'emit-maths' }))
    expect(screen.getByText('Grade 4')).toBeInTheDocument()
    expect(screen.getByText('Mathematics')).toBeInTheDocument()
    expect(screen.getByText('✓ CBC curriculum')).toBeInTheDocument()

    // Teacher changes subject → the chips FOLLOW; the old subject chip is gone.
    fireEvent.click(screen.getByRole('button', { name: 'emit-english' }))
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.queryByText('Mathematics')).not.toBeInTheDocument()
  })

  it('hides the three Auto format selects until "Format & style" is expanded', () => {
    renderStudio()

    expect(screen.queryByText('Worksheet style')).not.toBeInTheDocument()
    expect(screen.queryByText('Grid columns (practice grids)')).not.toBeInTheDocument()
    expect(screen.queryByText('Reading passage length')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /format & style/i }))

    // All three default to Auto; style 'auto' keeps grid columns AND passage
    // length visible inside the expanded panel.
    expect(screen.getByText('Worksheet style')).toBeInTheDocument()
    expect(screen.getByText('Grid columns (practice grids)')).toBeInTheDocument()
    expect(screen.getByText('Reading passage length')).toBeInTheDocument()
  })
})
