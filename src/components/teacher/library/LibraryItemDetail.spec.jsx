/**
 * Regression test for LibraryItemDetail — [21] 'Show answers' toggle must
 * flow through to the Exercise & Homework Word export.
 *
 * The bug: lesson_activities DOCX export hard-coded
 *   { includeAnswers: true, includeModelAnswers: true }
 * so a teacher who unchecked 'Show answers' always got answers in the file.
 * The fix passes the toggle through — same as the homework/assessment branches.
 *
 * Approach: LibraryItemDetail has ~50 imports. We render it fully and mock
 * the heavy dependency graph. Every dependency except the one under test
 * (downloadLessonActivitiesDocx) is a trivial no-op stub. This is verbose but
 * correct — it exercises the real handler with the real toggle state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LibraryItemDetail from './LibraryItemDetail'

// ── Firebase ──────────────────────────────────────────────────────────────────
vi.mock('../../../firebase/config', () => ({ db: {}, auth: {}, storage: {} }))

// ── The export spy — the entire purpose of these tests ───────────────────────
const mockDownloadLessonActivitiesDocx = vi.fn(async () => {})
vi.mock('../../../utils/activityToDocx', () => ({
  downloadLessonActivitiesDocx: (...args) => mockDownloadLessonActivitiesDocx(...args),
}))

// assessmentToDocx is dynamically imported in the assessment branch; stub it
// so the dynamic import resolves without loading the heavy docx library.
vi.mock('../../../utils/assessmentToDocx', () => ({
  downloadAssessmentDocx: vi.fn(async () => {}),
}))

// ── All other download utilities (not under test — stub as no-ops) ────────────
vi.mock('../../../utils/lessonPlanToDocx',    () => ({ downloadLessonPlanDocx:    vi.fn(async () => {}) }))
vi.mock('../../../utils/serverLibraryDownload',()=>({ downloadLibraryItemViaServer:vi.fn(async()=>false) }))
vi.mock('../../../utils/worksheetToDocx',     () => ({ downloadWorksheetDocx:     vi.fn(async () => {}) }))
vi.mock('../../../utils/flashcardsToDocx',    () => ({ downloadFlashcardsDocx:    vi.fn(async () => {}) }))
vi.mock('../../../utils/schemeOfWorkToDocx',  () => ({ downloadSchemeOfWorkDocx:  vi.fn(async () => {}) }))
vi.mock('../../../utils/markScheduleToDocx',  () => ({ downloadMarkScheduleDocx:  vi.fn(async () => {}) }))
vi.mock('../../../utils/markScheduleToXlsx',  () => ({ downloadMarkScheduleXlsx:  vi.fn(async () => {}) }))
vi.mock('../../../utils/reportCardsToDocx',   () => ({ downloadReportCardsDocx:   vi.fn(async () => {}) }))
vi.mock('../../../utils/fullLessonToDocx',    () => ({ downloadFullLessonDocx:    vi.fn(async () => {}) }))
vi.mock('../../../utils/weeklyForecastToDocx',() => ({ downloadWeeklyForecastDocx:vi.fn(async () => {}) }))
vi.mock('../../../utils/recordOfWorkToDocx',  () => ({ downloadRecordOfWorkDocx:  vi.fn(async () => {}) }))
vi.mock('../../../utils/classTimetableToDocx',() => ({ downloadClassTimetableDocx:vi.fn(async () => {}) }))
vi.mock('../../../utils/classTimetableToXlsx',() => ({ downloadClassTimetableXlsx:vi.fn(async () => {}) }))
vi.mock('../../../utils/classTimetableToPdf', () => ({ downloadClassTimetablePdf: vi.fn(async () => {}) }))
vi.mock('../../../utils/lessonPlanToPdf',     () => ({ downloadLessonPlanPdf:     vi.fn(async () => {}) }))
vi.mock('../../../utils/flashcardsToPdf',     () => ({ downloadFlashcardsPdf:     vi.fn(async () => {}) }))
vi.mock('../../../utils/rubricToPdf',         () => ({ downloadRubricPdf:         vi.fn(async () => {}) }))
vi.mock('../../../utils/notesToPdf',          () => ({ downloadNotesPdf:          vi.fn(async () => {}) }))
vi.mock('../../../utils/homeworkToPdf',       () => ({ downloadHomeworkPdf:       vi.fn(async () => {}) }))
vi.mock('../../../utils/fullLessonToPdf',     () => ({ downloadFullLessonPdf:     vi.fn(async () => {}) }))
vi.mock('../../../utils/schemeOfWorkToPdf',   () => ({ downloadSchemeOfWorkPdf:   vi.fn(async () => {}) }))
vi.mock('../../../utils/sbaTaskToPdf',        () => ({ downloadSbaTaskPdf:        vi.fn(async () => {}) }))
vi.mock('../../../utils/rubricToDocx',        () => ({ downloadRubricDocx:        vi.fn(async () => {}) }))
vi.mock('../../../utils/notesToDocx',         () => ({ downloadNotesDocx:         vi.fn(async () => {}) }))
vi.mock('../../../utils/homeworkToDocx',      () => ({ downloadHomeworkDocx:      vi.fn(async () => {}) }))
vi.mock('../../../utils/sbaTaskToDocx',       () => ({ downloadSbaTaskDocx:       vi.fn(async () => {}) }))
vi.mock('../../../utils/sbaTrackerToDocx',    () => ({ downloadSbaTrackerDocx:    vi.fn(async () => {}) }))
vi.mock('../../../utils/sbaPlannerToDocx',    () => ({ downloadSbaPlannerDocx:    vi.fn(async () => {}) }))
vi.mock('../../../utils/sbaPlanner',          () => ({ buildSbaPlan:              vi.fn(() => null) }))
vi.mock('../../../utils/downloadFilename',    () => ({ buildDownloadName:         vi.fn(() => 'test-file.docx') }))
vi.mock('../../../utils/aiPaperToSections',   () => ({ aiPaperToStudioDoc:        vi.fn(() => ({ doc: {}, questions: [] })) }))

// ── Utility stubs ─────────────────────────────────────────────────────────────
vi.mock('../../../utils/schemeEditHistory', () => ({
  stampEditHistory: vi.fn((o) => o),
  lastEditedAt:     vi.fn(() => null),
  editHistoryOf:    vi.fn(() => []),
}))
vi.mock('../../../utils/useFormDefaultsFromUrl', () => ({
  buildGeneratorQueryString: vi.fn(() => ''),
}))
vi.mock('../../../utils/adminGenerationsService', () => ({
  resolveGeneration: vi.fn(async () => true),
}))
vi.mock('../../../utils/shareService', () => ({
  publishShare:             vi.fn(async () => ({ token: 'tok', url: 'https://x.com/s/tok' })),
  revokeShare:              vi.fn(async () => {}),
  listSharesForGeneration:  vi.fn(async () => []),
}))

// ── Auth / Toast ──────────────────────────────────────────────────────────────
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser:  { uid: 'teacher-1' },
    userProfile:  { id: 'teacher-1' },
    isAdmin:      false,
  }),
}))
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

// ── Library service — controls what getGeneration returns ─────────────────────
const TEST_ITEM = {
  id:       'gen-1',
  tool:     'lesson_activities',
  title:    'Grade 6 Fractions Exercise',
  ownerUid: 'teacher-1',
  inputs:   { grade: '6', subject: 'Mathematics', topic: 'Fractions' },
  output:   { header: { grade: '6', subject: 'Mathematics' }, exercise: {}, homework: {} },
  createdAt: null,
  status:   'ready',
}

vi.mock('../../../utils/teacherLibraryService', () => ({
  getGeneration:          vi.fn(async () => TEST_ITEM),
  deleteGeneration:       vi.fn(async () => true),
  duplicateGeneration:    vi.fn(async () => 'new-id'),
  recordExport:           vi.fn(),
  updateGenerationOutput: vi.fn(async () => true),
  CLIENT_CREATED_TOOLS:   [],
  TOOL_META: {
    lesson_activities: {
      label: 'Exercise & Homework',
      icon:  '📝',
      route: '/teacher/generate/lesson-activities',
    },
  },
  titleForGeneration: (item) => item.title || item.id,
  formatDate:         () => '1 Jan 2026',
  getItemPermissions: () => ({ canDownload: true, level: 'premium' }),
  LIBRARY_ACCESS:     { PRO: 'pro', PREMIUM: 'premium', FREE: 'free' },
}))

// ── Hooks with Firebase side-effects ─────────────────────────────────────────
vi.mock('../../../hooks/useFlashcardProgress', () => ({
  useFlashcardProgress: () => ({
    masteredCards: {},
    markMastered: vi.fn(),
    markReview:   vi.fn(),
  }),
}))

// ── View component stubs — all rendered as null except lesson_activities ──────
vi.mock('../views/LessonPlanView',        () => ({ default: () => null }))
vi.mock('../views/WorksheetView',         () => ({ default: () => null }))
vi.mock('../views/FlashcardsView',        () => ({ default: () => null }))
vi.mock('../views/SchemeOfWorkView',      () => ({ default: () => null }))
vi.mock('../views/MarkScheduleView',      () => ({ default: () => null }))
vi.mock('../views/WeeklyForecastView',    () => ({ default: () => null }))
vi.mock('../views/RecordOfWorkView',      () => ({ default: () => null }))
vi.mock('../views/ClassTimetableView',    () => ({ default: () => null }))
vi.mock('../views/RubricView',            () => ({ default: () => null }))
vi.mock('../views/NotesView',             () => ({ default: () => null }))
vi.mock('../views/SbaTaskView',           () => ({ default: () => null }))
vi.mock('../views/LessonActivitiesView',  () => ({ default: () => <div data-testid="la-view" /> }))
vi.mock('../views/HomeworkView',          () => ({ default: () => null }))
vi.mock('../views/SbaTrackerView',        () => ({ default: () => null }))
vi.mock('../views/SbaPlanView',           () => ({ default: () => null }))
vi.mock('../views/AssessmentPaperView',   () => ({ default: () => null }))
vi.mock('../views/FullLessonView',        () => ({ default: () => null }))
vi.mock('../views/FlashcardStudyOverlay', () => ({ default: () => null }))
vi.mock('../generate/SchemeEditableTable',        () => ({ default: () => null }))
vi.mock('../generate/WeeklyForecastEditableTable',() => ({ default: () => null }))
vi.mock('../../ui/ConfirmDialog', () => ({ default: () => null }))
vi.mock('../../seo/SeoHelmet',    () => ({ default: () => null }))

// ─────────────────────────────────────────────────────────────────────────────

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/teacher/library/gen-1']}>
      <Routes>
        <Route path="/teacher/library/:id" element={<LibraryItemDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LibraryItemDetail — [21] Show-answers toggle for lesson_activities export', () => {
  beforeEach(() => {
    mockDownloadLessonActivitiesDocx.mockReset()
  })

  it('passes includeAnswers=false when "Show answers" is unchecked (default)', async () => {
    renderDetail()

    // Wait for the item to load — the export button only appears after status='ready'.
    const exportBtn = await screen.findByRole('button', { name: /export .docx/i })

    // The checkbox starts unchecked (showAnswers defaults to false).
    const toggle = screen.getByRole('checkbox')
    expect(toggle).not.toBeChecked()

    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(mockDownloadLessonActivitiesDocx).toHaveBeenCalledTimes(1)
      expect(mockDownloadLessonActivitiesDocx).toHaveBeenCalledWith(
        TEST_ITEM.output,
        expect.any(String),
        { includeAnswers: false, includeModelAnswers: false },
      )
    })
  })

  it('passes includeAnswers=true when "Show answers" is checked', async () => {
    renderDetail()

    const exportBtn = await screen.findByRole('button', { name: /export .docx/i })
    const toggle = screen.getByRole('checkbox')

    // Check the toggle.
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()

    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(mockDownloadLessonActivitiesDocx).toHaveBeenCalledTimes(1)
      expect(mockDownloadLessonActivitiesDocx).toHaveBeenCalledWith(
        TEST_ITEM.output,
        expect.any(String),
        { includeAnswers: true, includeModelAnswers: true },
      )
    })
  })
})
