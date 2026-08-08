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
// Controllable per test: the assessment branch runs this, then gates on the
// result. The default deliberately returns a READY paper — the previous stub
// returned no questions at all, which the export gate now (correctly) refuses.
const mockPaperConversion = vi.hoisted(() => ({ current: null }))
vi.mock('../../../utils/aiPaperToSections', () => ({
  aiPaperToStudioDoc: vi.fn(() => mockPaperConversion.current),
}))

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
  useToast: () => mockToast,
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

const mockItem = vi.hoisted(() => ({ current: null }))
// A stable toast so a test can read what the teacher was told; the previous
// inline vi.fn() was recreated on every render and recorded nothing.
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../utils/teacherLibraryService', () => ({
  getGeneration:          vi.fn(async () => mockItem.current),
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
    // Kept with its route so the retired-tool tests below prove the button is
    // suppressed by AVAILABILITY, not merely absent from the metadata.
    rubric:    { label: 'Rubric',    icon: '📋', route: '/teacher/generate/rubric' },
    worksheet: { label: 'Worksheet', icon: '📝', route: '/teacher/generate/worksheet' },
  },
  titleForGeneration: (item) => item.title || item.id,
  formatDate:         () => '1 Jan 2026',
  getItemPermissions: () => ({ canDownload: true, level: 'premium' }),
  LIBRARY_ACCESS:     { PRO: 'pro', PREMIUM: 'premium', FREE: 'free' },
}))

// ── Hooks with Firebase side-effects ─────────────────────────────────────────
// The flashcards feature is consumed through its public index, so ONE mock
// replaces the five that used to target its parts individually (two exporters,
// the progress hook, and two view components). Vitest does not warn when a
// vi.mock path matches no imported module, so a move that leaves the old paths
// behind gives a spec that still passes while testing something else.
vi.mock('../../../utils/flashcardsToDocx', () => ({ downloadFlashcardsDocx: vi.fn(async () => {}) }))
vi.mock('../../../utils/flashcardsToPdf', () => ({ downloadFlashcardsPdf: vi.fn(async () => {}) }))
vi.mock('../../../features/flashcards', () => ({
  FlashcardsView:         () => null,
  FlashcardStudyOverlay:  () => null,
  useFlashcardProgress: () => ({
    masteredCards: {},
    markMastered: vi.fn(),
    markReview:   vi.fn(),
  }),
}))

// ── View component stubs — all rendered as null except lesson_activities ──────
vi.mock('../views/LessonPlanView',        () => ({ default: () => null }))
vi.mock('../../../features/worksheet',         () => ({ WorksheetView: () => null }))
vi.mock('../views/SchemeOfWorkView',      () => ({ default: () => null }))
vi.mock('../views/MarkScheduleView',      () => ({ default: () => null }))
vi.mock('../views/WeeklyForecastView',    () => ({ default: () => null }))
vi.mock('../views/RecordOfWorkView',      () => ({ default: () => null }))
vi.mock('../views/ClassTimetableView',    () => ({ default: () => null }))
vi.mock('../../../features/rubric',            () => ({ RubricView: () => null }))
vi.mock('../../../features/teacherNotes',             () => ({ NotesView: () => null }))
vi.mock('../views/SbaTaskView',           () => ({ default: () => null }))
vi.mock('../views/LessonActivitiesView',  () => ({ default: () => <div data-testid="la-view" /> }))
vi.mock('../../../features/homework',          () => ({ HomeworkView: () => null }))
vi.mock('../views/SbaTrackerView',        () => ({ default: () => null }))
vi.mock('../views/SbaPlanView',           () => ({ default: () => null }))
vi.mock('../views/AssessmentPaperView',   () => ({ default: () => null }))
vi.mock('../views/FullLessonView',        () => ({ default: () => null }))
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

beforeEach(() => {
  mockItem.current = TEST_ITEM
  mockPaperConversion.current = { doc: {}, questions: [] }
  mockToast.success.mockClear()
  mockToast.error.mockClear()
})

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

/* ── the export gate on the library detail view ──────────────────────────── */

/**
 * The second bypass. This surface exports AI-generated papers straight from the
 * library with no readiness check at all, so every blocking rule the Assessment
 * Studio enforces could be sidestepped by opening the generation instead of the
 * paper.
 *
 * A generated paper is where an unrenderable diagram is MOST likely: the model
 * chose the catalogue key, rather than a teacher picking one from a list.
 */
const ASSESSMENT_ITEM = {
  ...TEST_ITEM,
  tool: 'assessment',
  title: 'Grade 7 Geography Topic Test',
  output: { header: { grade: '7', subject: 'Geography', title: 'Topic Test' } },
}

const readyQuestion = (localId, over = {}) => ({
  localId,
  type: 'short_answer',
  text: '<p>Name the largest river in Zambia.</p>',
  marks: 2,
  ...over,
})

/** What aiPaperToStudioDoc returns for a paper made of these questions. */
const conversionOf = (questions, over = {}) => ({
  doc: { title: 'Topic Test', subject: 'Geography', grade: '7', passages: [], parts: [], pagebreaks: [] },
  questions,
  questionCount: questions.length,
  totalMarks: questions.length * 2,
  warnings: [],
  sections: questions.map((question) => ({ kind: 'standalone', question })),
  editorParts: [],
  ...over,
})

async function exportAssessment() {
  renderDetail()
  const btn = await screen.findByRole('button', { name: /export .docx/i })
  fireEvent.click(btn)
  return btn
}

describe('LibraryItemDetail — export readiness for generated papers', () => {
  beforeEach(async () => {
    mockItem.current = ASSESSMENT_ITEM
    // Cleared per test: "nothing was delivered" is only a claim about THIS
    // click, and a leaked call from the previous test would make it false for
    // the wrong reason.
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    const { recordExport } = await import('../../../utils/teacherLibraryService')
    downloadAssessmentDocx.mockClear()
    recordExport.mockClear()
  })

  it('a paper with no questions cannot export', async () => {
    mockPaperConversion.current = conversionOf([])
    await exportAssessment()
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
    expect(mockToast.error.mock.calls[0][0]).toMatch(/Add at least one question/)
    expect(downloadAssessmentDocx).not.toHaveBeenCalled()
  })

  it('an unfinished question cannot export, and is named', async () => {
    mockPaperConversion.current = conversionOf([readyQuestion('a'), readyQuestion('b', { text: '' })])
    await exportAssessment()
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
    expect(mockToast.error.mock.calls[0][0]).toMatch(/Question 2 is not finished/)
    expect(downloadAssessmentDocx).not.toHaveBeenCalled()
  })

  it('a missing required figure cannot export, with the studio’s exact sentence', async () => {
    mockPaperConversion.current = conversionOf([
      readyQuestion('a', { imageDiagram: { libraryKey: 'not-in-the-catalog' } }),
    ])
    await exportAssessment()
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
    expect(mockToast.error.mock.calls[0][0]).toBe(
      'Question 1 requires a diagram, but the figure could not be rendered. '
      + 'Replace, regenerate or repair the diagram before exporting.',
    )
    expect(downloadAssessmentDocx).not.toHaveBeenCalled()
  })

  it('a valid paper exports exactly once', async () => {
    mockPaperConversion.current = conversionOf([readyQuestion('a'), readyQuestion('b')])
    await exportAssessment()
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    await waitFor(() => expect(downloadAssessmentDocx).toHaveBeenCalledTimes(1))
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('a render-time unresolved figure still prevents delivery', async () => {
    // The stage no static check can predict: the catalogue key is valid, the
    // raster fails mid-build. The exporter throws and the view must report it
    // rather than record an export that did not happen.
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    const { recordExport } = await import('../../../utils/teacherLibraryService')
    downloadAssessmentDocx.mockRejectedValueOnce(Object.assign(
      new Error('Question 1 requires a diagram, but the figure could not be rendered. '
        + 'Replace, regenerate or repair the diagram before exporting.'),
      { code: 'unresolved-figure' },
    ))
    mockPaperConversion.current = conversionOf([readyQuestion('a')])
    await exportAssessment()
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
    expect(mockToast.error.mock.calls[0][0]).toMatch(/Question 1 requires a diagram/)
    expect(recordExport).not.toHaveBeenCalled()
  })

  it('fixing the paper makes it exportable again, with no reload', async () => {
    mockPaperConversion.current = conversionOf([readyQuestion('a', { text: '' })])
    const btn = await exportAssessment()
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
    expect(downloadAssessmentDocx).not.toHaveBeenCalled()

    // Same mounted view, same button: the repaired paper is read on the next
    // click rather than a cached verdict.
    mockPaperConversion.current = conversionOf([readyQuestion('a')])
    fireEvent.click(btn)
    await waitFor(() => expect(downloadAssessmentDocx).toHaveBeenCalledTimes(1))
  })
})

/* ── load-failure vs not-found (getGeneration now re-throws) ──────────────── */

/**
 * getGeneration used to swallow every error and return null, so a transient
 * load failure was indistinguishable from a deleted/foreign doc — the teacher
 * saw "Not found" for work that still exists, with no way to retry. It now
 * rejects on a genuine failure and returns null ONLY for a missing doc; the
 * detail view splits those into two panels.
 */
describe('LibraryItemDetail — load failure vs not found', () => {
  it('a null result (missing/foreign doc) shows the Not found panel', async () => {
    mockItem.current = null
    const { getGeneration } = await import('../../../utils/teacherLibraryService')
    getGeneration.mockResolvedValueOnce(null)
    renderDetail()
    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('a rejected load shows a retryable error, not "Not found"', async () => {
    const { getGeneration } = await import('../../../utils/teacherLibraryService')
    getGeneration.mockRejectedValueOnce(new Error('network down'))
    renderDetail()
    expect(await screen.findByText(/Couldn’t load this item/i)).toBeInTheDocument()
    // The teacher is reassured their work still exists, and offered a retry.
    expect(screen.getByText(/hasn’t been deleted/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText('Not found')).not.toBeInTheDocument()
  })

  it('Try again re-loads and recovers without a remount', async () => {
    const { getGeneration } = await import('../../../utils/teacherLibraryService')
    getGeneration.mockRejectedValueOnce(new Error('network down'))
    // The next (retry) call succeeds.
    mockItem.current = TEST_ITEM
    renderDetail()
    const retry = await screen.findByRole('button', { name: /try again/i })
    fireEvent.click(retry)
    // Same mounted view: the item loads on the retry and the error panel clears.
    expect(await screen.findByTestId('la-view')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn’t load this item/i)).not.toBeInTheDocument()
  })
})


/**
 * A retired or withdrawn studio's saved documents stay fully readable and
 * exportable. What they lose is every route back INTO the studio.
 *
 * No PlatformSettingsProvider is mounted here, so the flags are the context's
 * defaults — which is exactly the launch state: Rubric retired, Worksheet
 * withdrawn.
 */
describe('LibraryItemDetail — documents of a studio that is no longer offered', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPaperConversion.current = null
  })

  it('labels a saved rubric and offers no way back into the retired studio', async () => {
    mockItem.current = {
      id: 'gen-r', tool: 'rubric', title: 'Project rubric',
      output: { header: {} }, inputs: {}, createdAt: null, status: 'ready',
    }
    renderDetail()
    await screen.findByText('Rubric (retired tool)')
    expect(screen.queryByText(/Generate similar/)).toBeNull()
    // Still a document: the export controls are untouched.
    expect(screen.getByText(/Export \.docx/)).toBeInTheDocument()
    expect(screen.getByText(/Export PDF/)).toBeInTheDocument()
  })

  it('labels a saved worksheet as returning, and keeps its answer key', async () => {
    mockItem.current = {
      id: 'gen-w', tool: 'worksheet', title: 'Fractions practice',
      output: { header: {}, questions: [] }, inputs: {}, createdAt: null, status: 'ready',
    }
    renderDetail()
    await screen.findByText('Worksheet (tool returning soon)')
    expect(screen.queryByText(/Generate similar/)).toBeNull()
    expect(screen.getByText(/Answer key/i)).toBeInTheDocument()
  })

  it('a lesson plan no longer offers "Create Worksheet", but still offers Homework', async () => {
    mockItem.current = {
      id: 'gen-p', tool: 'lesson_plan', title: 'Fractions',
      output: { header: {} }, inputs: {}, createdAt: null, status: 'ready',
    }
    renderDetail()
    await screen.findByText('Fractions')
    expect(screen.queryByText(/Create Worksheet/)).toBeNull()
    expect(screen.getByText(/Create Homework/)).toBeInTheDocument()
  })
})
