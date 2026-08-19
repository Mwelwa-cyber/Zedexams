/**
 * Behaviour tests for DailyExamRunner.jsx — the daily-exam taking runner.
 *
 * DailyExamRunner is the highest-stakes learner flow (a timed, one-shot,
 * anti-cheat exam) and previously had zero component-level coverage. These
 * tests guard its state machine and the recoverable dead-ends:
 *   - loading / error+retry / already-submitted screens,
 *   - the ready render (header, timer, first question),
 *   - answering an MCQ updating the progress counters,
 *   - the section-navigation guard (can't advance past an unanswered section),
 *   - the manual submit → confirm → navigate-to-results flow,
 *   - the endTime-driven auto-submit when time has already expired.
 *
 * The Firestore-backed examService, auth context, router, and heavy visual
 * leaves are stubbed; the real component wiring (effects, guards, timer) is
 * exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// firebase/config.js runs initializeApp at import time — stub it so the tree
// imports without a real Firebase project.
vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

// examService is entirely Firestore/Callable-backed — stub every function the
// runner calls. saveProgress is fire-and-forget; the rest drive the flow.
const mockGetExamWithQuestions = vi.fn()
const mockCheckDailyLock = vi.fn()
const mockStartExam = vi.fn()
const mockRestoreExam = vi.fn()
const mockSaveProgress = vi.fn()
const mockSubmitExam = vi.fn()
vi.mock('../../../utils/examService', () => ({
  getExamWithQuestions: (...a) => mockGetExamWithQuestions(...a),
  checkDailyLock: (...a) => mockCheckDailyLock(...a),
  startExam: (...a) => mockStartExam(...a),
  restoreExam: (...a) => mockRestoreExam(...a),
  saveProgress: (...a) => mockSaveProgress(...a),
  submitExam: (...a) => mockSubmitExam(...a),
}))

let mockCurrentUser = { uid: 'learner-1', displayName: 'Test Learner' }
let mockUserProfile = { displayName: 'Test Learner' }
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser, userProfile: mockUserProfile }),
}))

// Render rich-text values as their plain string so option/question text is
// queryable; keep it a light leaf (no Tiptap, no firebase).
vi.mock('../../../editor/RichContent', () => ({
  default: ({ value }) => <span>{typeof value === 'string' ? value : ''}</span>,
}))
vi.mock('../../../shared/components/ExtraQuestionImages', () => ({ default: () => null }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ examId: 'exam-1' }),
  }
})

import DailyExamRunner from './DailyExamRunner'

// ── Fixtures ────────────────────────────────────────────────────────────────

const QUIZ = { id: 'exam-1', title: 'Maths Daily', subject: 'Mathematics', grade: '5' }
const Q1 = { id: 'q1', questionNumber: 1, type: 'mcq', text: 'What is 2 + 2?', options: ['3', '4', '5', '6'], marks: 1 }
const Q2 = { id: 'q2', questionNumber: 2, type: 'mcq', text: 'Capital of Zambia?', options: ['Lusaka', 'Ndola'], marks: 1 }

function examData(overrides = {}) {
  return {
    quiz: QUIZ,
    questions: [Q1, Q2],
    sections: [
      { kind: 'standalone', id: 's1', question: Q1 },
      { kind: 'standalone', id: 's2', question: Q2 },
    ],
    ...overrides,
  }
}

function freshSession(overrides = {}) {
  return {
    attemptId: 'att-1',
    answers: {},
    flagged: {},
    currentSectionIndex: 0,
    endTime: Date.now() + 10 * 60 * 1000, // 10 min out
    ...overrides,
  }
}

function renderRunner() {
  return render(
    <MemoryRouter initialEntries={['/exam/exam-1']}>
      <DailyExamRunner />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentUser = { uid: 'learner-1', displayName: 'Test Learner' }
  mockUserProfile = { displayName: 'Test Learner' }
  // Sensible defaults: fresh exam, no prior lock, a live session.
  mockGetExamWithQuestions.mockResolvedValue(examData())
  mockCheckDailyLock.mockResolvedValue(null)
  mockStartExam.mockResolvedValue(freshSession())
  mockSubmitExam.mockResolvedValue({ attemptId: 'att-1' })
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DailyExamRunner — load states', () => {
  it('shows the loading screen before data resolves', () => {
    // Never-resolving fetch keeps it in the loading state.
    mockGetExamWithQuestions.mockReturnValue(new Promise(() => {}))
    renderRunner()
    expect(screen.getByText(/Loading exam/i)).toBeInTheDocument()
  })

  it('renders the friendly recovery card when the exam fails to load', async () => {
    mockGetExamWithQuestions.mockResolvedValue(null) // "Exam not found."
    renderRunner()
    expect(await screen.findByText(/We hit a snag loading this exam/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()
  })

  it('retry re-runs init and recovers into the ready state', async () => {
    mockGetExamWithQuestions.mockResolvedValueOnce(null) // first attempt fails
    renderRunner()
    const retry = await screen.findByRole('button', { name: /Try again/i })

    // Second attempt (default mock) succeeds.
    fireEvent.click(retry)
    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument()
    expect(mockGetExamWithQuestions).toHaveBeenCalledTimes(2)
  })

  it('shows the already-completed screen when today\'s lock is submitted', async () => {
    mockCheckDailyLock.mockResolvedValue({ status: 'submitted', attemptId: 'att-done' })
    renderRunner()
    expect(await screen.findByText(/Exam Submitted/i)).toBeInTheDocument()
    // Links to that attempt's results, and never starts a new attempt.
    expect(screen.getByRole('link', { name: /View Results/i }))
      .toHaveAttribute('href', '/exam-results/att-done')
    expect(mockStartExam).not.toHaveBeenCalled()
  })
})

describe('DailyExamRunner — taking the exam', () => {
  it('renders the header, timer and the first question when ready', async () => {
    renderRunner()
    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument()
    expect(screen.getByText(/Mathematics · Grade 5 · Daily Exam/)).toBeInTheDocument()
    expect(screen.getByText(/Maths Daily/)).toBeInTheDocument()
    // Section 1 of 2, nothing answered yet.
    expect(screen.getByText(/Section 1 \/ 2/)).toBeInTheDocument()
    expect(screen.getByText('0/2 answered')).toBeInTheDocument()
  })

  it('selecting an MCQ option advances the answered counters', async () => {
    renderRunner()
    await screen.findByText(/What is 2 \+ 2\?/)
    fireEvent.click(screen.getByText('4'))
    await waitFor(() => expect(screen.getByText('1/2 answered')).toBeInTheDocument())
    expect(screen.getByText('1 answered')).toBeInTheDocument()
  })

  // §4 makes a single vertical column with letter badges a binding engine
  // requirement — the ECZ past-paper form. This runner used `sm:grid-cols-2`,
  // which laid choices out 2x2 on tablet and up, so a long option wrapped
  // inside half a row and the reading order stopped being a list.
  it('lays answer options out in one vertical column, like the quiz runner', async () => {
    const { container } = renderRunner()
    await screen.findByText(/What is 2 \+ 2\?/)

    const optionList = container.querySelector('.opt-grid')
    expect(optionList).not.toBeNull()
    // The class carries `grid-template-columns: 1fr` (src/index.css). Assert the
    // multi-column utility is gone rather than only that the new class is
    // present — both could be on the element at once.
    expect(optionList.className).not.toMatch(/grid-cols-\d/)
    expect(container.querySelectorAll('.opt-grid .zx-opt').length).toBeGreaterThan(1)
  })

  it('lets the learner skip an unanswered question — Next always advances', async () => {
    renderRunner()
    await screen.findByText(/What is 2 \+ 2\?/)

    // On a timed exam a learner must be able to defer a hard question (flag it
    // and come back). Next advances even with the current section unanswered —
    // no blocking guard, no error toast.
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(await screen.findByText(/Capital of Zambia\?/)).toBeInTheDocument()
    expect(screen.getByText(/Section 2 \/ 2/)).toBeInTheDocument()
    expect(screen.queryByText(/Please answer this question before moving/i)).not.toBeInTheDocument()
    // The skipped question is still counted as unanswered for guidance.
    expect(screen.getByText('0/2 answered')).toBeInTheDocument()
  })

  it('exposes a Submit control on every section so the exam can never dead-end', async () => {
    renderRunner()
    await screen.findByText(/What is 2 \+ 2\?/)
    // Section 1 (not the last) still offers Submit alongside Next.
    expect(screen.getByRole('button', { name: /Submit 🏁/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument()
  })

  it('submits via the pre-submit review screen and navigates to the results page', async () => {
    renderRunner()
    await screen.findByText(/What is 2 \+ 2\?/)

    // Answer q1, advance, answer q2, reach the Submit button.
    fireEvent.click(screen.getByText('4'))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    await screen.findByText(/Capital of Zambia\?/)
    fireEvent.click(screen.getByText('Lusaka'))

    fireEvent.click(screen.getByRole('button', { name: /Submit 🏁/ }))
    expect(await screen.findByText('Review your answers')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Finish quiz/ }))

    await waitFor(() => expect(mockSubmitExam).toHaveBeenCalledTimes(1))
    expect(mockSubmitExam).toHaveBeenCalledWith('learner-1', 'exam-1', 'att-1', expect.objectContaining({ q1: 1, q2: 0 }))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/exam-results/att-1', { replace: true }),
    )
  })
})

describe('DailyExamRunner — no clock, and restore', () => {
  it('never counts down and never auto-submits, however long the learner takes', async () => {
    // The acceptance criterion for the daily quiz. `endTime` is now the
    // attempt's SESSION WINDOW (end of the day it belongs to), not a deadline
    // the runner enforces — a learner who reads slowly, loses signal or is
    // called away keeps their paper. Closing a stale attempt is `restoreExam`'s
    // job on the NEXT visit, which the "already closed" case below covers.
    mockStartExam.mockResolvedValue(freshSession({ endTime: Date.now() - 1000 }))
    renderRunner()
    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(mockSubmitExam).not.toHaveBeenCalled()
  })

  it('shows no timer anywhere on the running exam', async () => {
    renderRunner()
    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument()
    expect(screen.queryByText(/⏱️/)).toBeNull()
    expect(document.querySelector('.zx-timer')).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('restores an in-progress attempt instead of starting a new one', async () => {
    mockCheckDailyLock.mockResolvedValue({ status: 'in_progress', attemptId: 'att-resume' })
    mockRestoreExam.mockResolvedValue(freshSession({
      attemptId: 'att-resume',
      answers: { q1: 1 },
      currentSectionIndex: 1,
    }))
    renderRunner()

    // Resumes on the saved section (2 of 2) with the prior answer counted.
    expect(await screen.findByText(/Capital of Zambia\?/)).toBeInTheDocument()
    expect(screen.getByText(/Section 2 \/ 2/)).toBeInTheDocument()
    expect(screen.getByText('1/2 answered')).toBeInTheDocument()
    expect(mockRestoreExam).toHaveBeenCalledWith('learner-1', 'att-resume')
    expect(mockStartExam).not.toHaveBeenCalled()
  })

  it('shows the time-expired screen when startExam reports the attempt already closed', async () => {
    mockStartExam.mockResolvedValue({ alreadySubmitted: true, timeExpired: true, attemptId: 'att-x' })
    renderRunner()
    expect(await screen.findByText(/Time Expired/i)).toBeInTheDocument()
  })

  // ── Question figures (BUG_REPORT RENDER-001) ──────────────────────────────
  // The runner read imageUrl only, so a question whose figure is a library
  // diagram rendered with NO figure — a learner could not answer from what was
  // on screen, in the highest-stakes flow there is.
  describe('question figures', () => {
    function withFigure(over) {
      const q = { ...Q1, ...over }
      mockGetExamWithQuestions.mockResolvedValue(examData({
        questions: [q, Q2],
        sections: [
          { kind: 'standalone', id: 's1', question: q },
          { kind: 'standalone', id: 's2', question: Q2 },
        ],
      }))
    }

    it('renders a library diagram as the question figure', async () => {
      withFigure({ imageDiagram: { libraryKey: 'cylinder', params: {} } })
      const { container } = renderRunner()
      expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument()
      expect(container.querySelector('.zx-diagram-svg')).not.toBeNull()
    })

    it('positions a library diagram the same way it positions an uploaded image', async () => {
      withFigure({ imageDiagram: { libraryKey: 'cylinder', params: {} }, imagePosition: 'below' })
      const { container } = renderRunner()
      await screen.findByText(/What is 2 \+ 2\?/)
      const wrap = container.querySelector('[data-image-position="below"]')
      expect(wrap).not.toBeNull()
      expect(wrap.className).toContain('flex-col-reverse')
      // Inside the wrapper, or the reversal moves nothing.
      expect(wrap.querySelector('.zx-diagram-svg')).not.toBeNull()
    })

    it('a library diagram wins over a leftover imageUrl, and only one figure renders', async () => {
      withFigure({
        imageDiagram: { libraryKey: 'cylinder', params: {} },
        imageUrl: 'https://storage.example/stale.jpg',
      })
      const { container } = renderRunner()
      await screen.findByText(/What is 2 \+ 2\?/)
      expect(container.querySelector('.zx-diagram-svg')).not.toBeNull()
      expect(container.querySelector('img[src="https://storage.example/stale.jpg"]')).toBeNull()
    })

    it('emits no position wrapper for a question with no figure', async () => {
      withFigure({ imagePosition: 'below' })
      const { container } = renderRunner()
      await screen.findByText(/What is 2 \+ 2\?/)
      expect(container.querySelector('[data-image-position]')).toBeNull()
    })
  })
})
