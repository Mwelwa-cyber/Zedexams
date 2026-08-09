/**
 * Regression tests for PublicShareView — the unauthenticated /share/:token page.
 *
 * Guards:
 * [18a] No tool should dump raw JSON via <pre>{JSON.stringify(plan)}</pre> on a
 *       public share page (the pre-fix default case).
 * [18b] assessment and sba_task shares must NOT expose answer/marking content —
 *       those views must receive showAnswers={false} even though SbaTaskView
 *       defaults showAnswers to true.
 * [18c] Unknown/future tools get a friendly "can't preview" message, not a JSON
 *       dump that could leak embedded data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import PublicShareView from './PublicShareView'

// ── Firebase ──────────────────────────────────────────────────────────────────
vi.mock('../../../firebase/config', () => ({ db: {} }))

// getDoc is what the component calls; we control the returned snapshot here.
let _shareDocData = null
vi.mock('firebase/firestore', () => ({
  doc:    vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({
    exists: () => _shareDocData !== null,
    id:     'test-token',
    data:   () => _shareDocData,
  })),
}))

// ── Lightweight chrome stubs ──────────────────────────────────────────────────
vi.mock('../../ui/Logo',       () => ({ default: () => null }))
vi.mock('../../seo/SeoHelmet', () => ({ default: () => null }))

// ── Already-handled view stubs (plain null — we don't need to inspect them) ──
vi.mock('../views/LessonPlanView',    () => ({ default: () => <div data-testid="lesson-plan-view" /> }))
vi.mock('../../../features/worksheet',     () => ({ WorksheetView: () => <div data-testid="worksheet-view" /> }))
// Mocked at the feature's front door, which is how the component imports it.
// This also keeps the spec off the feature's module graph: the index re-exports
// useFlashcardProgress, which pulls AuthContext and firebase/config in at import
// time — a presentational stub should not need Firebase configured.
vi.mock('../../../features/flashcards', () => ({ FlashcardsView: () => <div data-testid="flashcards-view" /> }))
vi.mock('../../../features/schemeOfWork', () => ({ SchemeOfWorkView: () => <div data-testid="scheme-of-work-view" />, SchemeEditableTable: () => null }))
vi.mock('../../../features/weeklyForecast', () => ({ WeeklyForecastView: () => <div data-testid="weekly-forecast-view" />, WeeklyForecastEditableTable: () => null }))
vi.mock('../../../features/recordOfWork', () => ({ RecordOfWorkView: () => <div data-testid="record-of-work-view" /> }))
vi.mock('../../../features/rubric',        () => ({ RubricView: () => <div data-testid="rubric-view" /> }))

// ── NotesView: renders a testid so we can confirm the right component was used.
vi.mock('../../../features/teacherNotes', () => ({
  NotesView: ({ notes }) => <div data-testid="notes-view">{notes?.header?.title}</div>,
}))

vi.mock('../../../features/homework', () => ({
  HomeworkView: ({ showAnswers }) => <div data-testid="homework-view" data-show-answers={String(showAnswers)} />,
}))

vi.mock('../views/LessonActivitiesView', () => ({
  default: ({ showAnswers }) => <div data-testid="lesson-activities-view" data-show-answers={String(showAnswers)} />,
}))

// SbaTaskView: renders secret marking content ONLY when showAnswers is true.
// This lets us assert the secret string is absent when showAnswers={false}.
vi.mock('../../../features/sba', () => ({
  SbaTaskView: ({ task, showAnswers }) => (
    <div data-testid="sba-task-view" data-show-answers={String(showAnswers)}>
      {showAnswers && <span>{task?.markingScheme?.secretContent}</span>}
    </div>
  ),
  SbaPlanView: () => <div data-testid="sba-plan-view" />,
  SbaTrackerView: () => null,
}))

vi.mock('../../../features/markSchedule', () => ({
  MarkScheduleView: () => <div data-testid="mark-schedule-view" />,
}))

vi.mock('../../../features/classTimetable', () => ({
  ClassTimetableView: () => <div data-testid="class-timetable-view" />,
}))

// AssessmentPaperView: renders secret answer content ONLY when showAnswers is true.
vi.mock('../views/AssessmentPaperView', () => ({
  default: ({ assessment, tool, showAnswers }) => (
    <div data-testid="assessment-paper-view" data-tool={tool} data-show-answers={String(showAnswers)}>
      {showAnswers && <span>{assessment?.answerKey}</span>}
    </div>
  ),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderShare(token = 'tok1') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<PublicShareView />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

// Wait for the async share-load effect to settle (loading → ready).
async function waitForReady() {
  // "Loading…" disappears once the component transitions out of the loading state.
  await waitFor(() =>
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument(),
  )
}

beforeEach(() => {
  _shareDocData = null
})

// ─────────────────────────────────────────────────────────────────────────────

describe('PublicShareView — [18] answer gating and no raw JSON dump', () => {

  it('renders AssessmentPaperView with showAnswers=false; answer key not in DOM', async () => {
    const ASSESSMENT_SECRET = 'ASSESSMENT_ANSWER_KEY_XYZQ'
    _shareDocData = {
      tool:  'assessment',
      title: 'Grade 7 Maths Test',
      plan:  { header: { grade: '7', subject: 'Mathematics' }, answerKey: ASSESSMENT_SECRET },
    }
    renderShare()
    await waitForReady()

    const view = screen.getByTestId('assessment-paper-view')
    expect(view).toBeInTheDocument()
    // tool prop must be forwarded so the view can distinguish assessment vs exam_paper
    expect(view.getAttribute('data-tool')).toBe('assessment')
    // showAnswers must be false — answer key must NOT appear publicly
    expect(view.getAttribute('data-show-answers')).toBe('false')
    expect(screen.queryByText(ASSESSMENT_SECRET)).not.toBeInTheDocument()
    // No raw JSON dump
    expect(document.querySelector('pre')).toBeNull()
  })

  it('renders exam_paper with showAnswers=false', async () => {
    const EXAM_SECRET = 'EXAM_ANSWER_KEY_XYZQ'
    _shareDocData = {
      tool:  'exam_paper',
      title: 'Grade 9 Science Exam',
      plan:  { header: { grade: '9' }, answerKey: EXAM_SECRET },
    }
    renderShare()
    await waitForReady()

    const view = screen.getByTestId('assessment-paper-view')
    expect(view.getAttribute('data-tool')).toBe('exam_paper')
    expect(view.getAttribute('data-show-answers')).toBe('false')
    expect(screen.queryByText(EXAM_SECRET)).not.toBeInTheDocument()
  })

  it('renders SbaTaskView with showAnswers=false; marking secret not in DOM', async () => {
    const SBA_SECRET = 'SBA_MARKING_SECRET_XYZQ'
    _shareDocData = {
      tool:  'sba_task',
      title: 'Grade 5 Science SBA',
      plan:  {
        header: { grade: '5', subject: 'Integrated Science' },
        questions: [],
        markingScheme: { secretContent: SBA_SECRET },
      },
    }
    renderShare()
    await waitForReady()

    const view = screen.getByTestId('sba-task-view')
    expect(view).toBeInTheDocument()
    // SbaTaskView defaults showAnswers=true; we must explicitly gate it to false
    expect(view.getAttribute('data-show-answers')).toBe('false')
    expect(screen.queryByText(SBA_SECRET)).not.toBeInTheDocument()
    expect(document.querySelector('pre')).toBeNull()
  })

  it('renders NotesView for a notes share (not a raw JSON dump)', async () => {
    _shareDocData = {
      tool:  'notes',
      title: 'Grade 6 Physics Notes',
      plan:  { header: { title: 'Heat and Temperature' }, sections: [] },
    }
    renderShare()
    await waitForReady()

    expect(screen.getByTestId('notes-view')).toBeInTheDocument()
    expect(document.querySelector('pre')).toBeNull()
  })

  it('renders a friendly fallback for an unknown/future tool, not a JSON dump', async () => {
    const UNKNOWN_SENTINEL = 'UNKNOWN_PLAN_DATA_SENTINEL_XYZQ'
    _shareDocData = {
      tool:  'future_tool_not_yet_supported',
      title: 'Something new',
      plan:  { someField: UNKNOWN_SENTINEL },
    }
    renderShare()
    await waitForReady()

    // The friendly message must appear. The apostrophe is a curly ' (U+2019
    // from &rsquo;), so we match the surrounding text instead of the contraction.
    expect(screen.getByText(/previewed on a share link yet/i)).toBeInTheDocument()
    expect(screen.getByText(/ask the teacher for an exported copy/i)).toBeInTheDocument()

    // The raw JSON dump and its content must NOT appear
    expect(document.querySelector('pre')).toBeNull()
    expect(screen.queryByText(UNKNOWN_SENTINEL)).not.toBeInTheDocument()
  })

  it('shows a revoked message when revokedAt is set, not the plan', async () => {
    _shareDocData = {
      tool:      'notes',
      title:     'Some Notes',
      plan:      { sections: [] },
      revokedAt: '2026-07-01T00:00:00Z',
    }
    renderShare()
    await waitFor(() =>
      expect(screen.getByText(/share has been revoked/i)).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('notes-view')).not.toBeInTheDocument()
  })
})
