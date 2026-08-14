/**
 * Behaviour tests for EditQuizV2.jsx — the quiz authoring editor.
 *
 * EditQuizV2 is one of the largest, previously-untested authoring surfaces.
 * These tests guard its load state machine and — most importantly — its
 * access-control gate, which is the highest-risk logic in the file: a
 * non-owner, non-admin must never be handed someone else's quiz to edit.
 *   - loading skeletons,
 *   - "Quiz not found" for a missing quiz,
 *   - the ownership gate (non-owner ⇒ not-found, no data leak),
 *   - the happy path (owner loads → editor renders with the quiz title).
 *
 * The heavy child panels and firebase-touching leaves are stubbed; the real
 * section hydration runs so the happy-path load exercises genuine wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}))

const mockGetQuizById = vi.fn()
const mockGetQuestions = vi.fn()
// Captured at module level (not inline vi.fn()s) so the editing tests below can
// assert on the actual save round-trip — clicking "Save draft" must call through
// to updateQuizWithQuestions with the quiz id.
const mockUpdateQuiz = vi.fn()
const mockUpdateQuizWithQuestions = vi.fn()
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getQuizById: mockGetQuizById,
    getQuestions: mockGetQuestions,
    updateQuiz: mockUpdateQuiz,
    updateQuizWithQuestions: mockUpdateQuizWithQuestions,
  }),
}))

let mockAuth = { currentUser: { uid: 'owner-1' }, isAdmin: false }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

// Firebase-touching / heavy leaves used only inside handlers or deep panels.
vi.mock('../../../utils/questionBankService', () => ({ captureQuestionsToBank: vi.fn() }))
vi.mock('../../../utils/aiAssistant', () => ({ suggestQuizAnswers: vi.fn() }))
vi.mock('../../../utils/quizStatus', () => ({ deriveQuizStatus: () => 'draft' }))
vi.mock('../../../editor/RichContent.jsx', () => ({ getRichPlainText: () => '' }))
// documentQuizImporter → testPaperDiagram calls getFunctions() at import time.
vi.mock('../../../components/quiz/documentQuizImporter', () => ({
  importQuizDocument: vi.fn(),
  revokeImportedQuizAssets: vi.fn(),
}))

// Heavy child panels — render nothing so the editor's own shell is exercised.
vi.mock('../components/ImportQuizPanel', () => ({ default: () => null }))
vi.mock('../components/QuizSectionsEditor', () => ({ default: () => null }))
vi.mock('../components/QuizEditorPreviewPanel', () => ({ default: () => null }))
vi.mock('../components/QuizVerifyModal', () => ({ default: () => null }))
vi.mock('../components/BulkAnswerKey', () => ({ default: () => null }))
vi.mock('../components/ReviewPanel', () => ({ default: () => null }))
vi.mock('../components/StructuralValidationPanel', () => ({ default: () => null }))
vi.mock('../components/ImageCropModal', () => ({ default: () => null }))
vi.mock('../components/ImportReviewBanner', () => ({ default: () => null }))
vi.mock('../components/PastPaperReferenceBanner', () => ({ default: () => null }))
vi.mock('../components/QuizEditorActionBar', () => ({ default: () => null }))
vi.mock('../components/QuizEditorFloatingNav', () => ({ default: () => null }))
vi.mock('../components/QuizValidationChecklist', () => ({ default: () => null }))
vi.mock('../components/ReimportDiffModal', () => ({ default: () => null }))
vi.mock('../components/QuizWizardSteps', () => ({ default: () => null }))
vi.mock('../components/QuizStatusBadge', () => ({ default: () => null }))
vi.mock('../components/QuizPublishStep', () => ({ default: () => null }))
vi.mock('../../../shared/components/ConfirmDialog', () => ({ default: () => null }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ quizId: 'quiz-1' }) }
})

import EditQuizV2 from './EditQuizV2'

function renderEditor() {
  return render(<MemoryRouter><EditQuizV2 /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth = { currentUser: { uid: 'owner-1' }, isAdmin: false }
  mockGetQuestions.mockResolvedValue([])
  // Default the write paths to resolve so a save that reaches Firestore doesn't
  // hang on an undefined promise; the empty id-map is the "no new docs created"
  // shape applyAssignedIds expects.
  mockUpdateQuizWithQuestions.mockResolvedValue([])
  mockUpdateQuiz.mockResolvedValue(undefined)
})

describe('EditQuizV2 — load states', () => {
  it('shows loading skeletons before the quiz resolves', () => {
    mockGetQuizById.mockReturnValue(new Promise(() => {}))
    mockGetQuestions.mockReturnValue(new Promise(() => {}))
    const { container } = renderEditor()
    // The loading branch renders three Skeleton placeholders and nothing else.
    expect(container.querySelector('.space-y-4')).toBeInTheDocument()
    expect(screen.queryByText('Edit quiz')).not.toBeInTheDocument()
  })

  it('renders "Quiz not found" when the quiz is missing', async () => {
    mockGetQuizById.mockResolvedValue(null)
    renderEditor()
    expect(await screen.findByText('Quiz not found')).toBeInTheDocument()
  })

  it('shows a recoverable error card (not a stuck skeleton) when the load throws', async () => {
    // A rejecting read stands in for a hydrate error on malformed/legacy data.
    // Before the load-effect try/catch, this left `loading` true forever — the
    // editor froze on the skeleton. Now it must surface an actionable card.
    mockGetQuizById.mockRejectedValue(new Error('boom'))
    renderEditor()
    expect(await screen.findByText(/Couldn't open this quiz/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reload/i })).toBeInTheDocument()
    // Not stuck on the loading skeleton.
    expect(document.querySelector('.space-y-4')).not.toBeInTheDocument()
  })

  it('offline: a null read shows the reload card, not "Quiz not found"', async () => {
    // getQuizById swallows read errors and returns null, indistinguishable from
    // a genuinely-deleted quiz. When the browser is offline we must NOT tell the
    // teacher their paper was deleted.
    const onLineDesc = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    try {
      mockGetQuizById.mockResolvedValue(null)
      renderEditor()
      expect(await screen.findByText(/Couldn't open this quiz/i)).toBeInTheDocument()
      expect(screen.queryByText('Quiz not found')).not.toBeInTheDocument()
    } finally {
      if (onLineDesc) Object.defineProperty(window.navigator, 'onLine', onLineDesc)
      else Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    }
  })
})

describe('EditQuizV2 — access control', () => {
  it('does not hand a non-owner, non-admin someone else\'s quiz', async () => {
    mockAuth = { currentUser: { uid: 'intruder' }, isAdmin: false }
    mockGetQuizById.mockResolvedValue({ id: 'quiz-1', title: 'Private Quiz', createdBy: 'owner-1' })
    renderEditor()
    // The ownership gate collapses to the not-found screen — the private
    // title must never render.
    expect(await screen.findByText('Quiz not found')).toBeInTheDocument()
    expect(screen.queryByText(/Private Quiz/)).not.toBeInTheDocument()
  })

  it('lets an admin open a quiz they do not own', async () => {
    mockAuth = { currentUser: { uid: 'admin-1' }, isAdmin: true }
    mockGetQuizById.mockResolvedValue({ id: 'quiz-1', title: 'Someone Else Quiz', createdBy: 'owner-1' })
    renderEditor()
    expect(await screen.findByText('Edit quiz')).toBeInTheDocument()
    expect(screen.getByText(/Someone Else Quiz/)).toBeInTheDocument()
  })
})

describe('EditQuizV2 — happy path', () => {
  it('loads the owner\'s quiz into the editor shell', async () => {
    mockGetQuizById.mockResolvedValue({
      id: 'quiz-1', title: 'Fractions Practice', createdBy: 'owner-1',
      subject: 'Mathematics', grade: '5', status: 'draft',
    })
    renderEditor()
    expect(await screen.findByText('Edit quiz')).toBeInTheDocument()
    expect(screen.getByText(/Fractions Practice/)).toBeInTheDocument()
  })
})

/**
 * Interaction-path coverage for the controls EditQuizV2 renders in its OWN
 * markup — not inside the stubbed child panels. These exercise the real dirty
 * flag, the wizard stepper, and both branches of the manual "Save draft" path
 * (validation gate vs. genuine Firestore write).
 */
describe('EditQuizV2 — editing', () => {
  // A minimally-valid MCQ so the load hydrates one complete, save-passing
  // question (non-empty stem, four filled options, an in-range correct index).
  const validQuestion = {
    id: 'q-1',
    type: 'mcq',
    text: 'What is 2 + 2?',
    options: ['3', '4', '5', '6'],
    correctAnswer: 1,
    marks: 1,
    order: 0,
  }

  function loadOwnerQuiz(extra = {}) {
    mockGetQuizById.mockResolvedValue({
      id: 'quiz-1', title: 'Fractions Practice', createdBy: 'owner-1',
      subject: 'Mathematics', grade: '5', status: 'draft', ...extra,
    })
  }

  it('flips the "Unsaved changes" badge on once the title is edited', async () => {
    loadOwnerQuiz()
    renderEditor()
    await screen.findByText('Edit quiz')

    // Freshly loaded quizzes are clean: no dirty pill, the footer reads saved.
    expect(screen.queryByText('● Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByText('✓ All changes saved')).toBeInTheDocument()

    // Typing into the title input (a directly-rendered field) calls setF, which
    // flips `dirty` — the pill and the footer warning both appear.
    fireEvent.change(screen.getByPlaceholderText(/Quiz title/), {
      target: { value: 'Fractions Practice v2' },
    })

    expect(await screen.findByText('● Unsaved changes')).toBeInTheDocument()
    expect(screen.getByText('⚠️ Unsaved changes')).toBeInTheDocument()
  })

  it('advances to the Preview step via the "Continue" nav button and back again', async () => {
    loadOwnerQuiz()
    renderEditor()
    await screen.findByText('Edit quiz')

    // The create step shows the import panel; the preview heading isn't mounted.
    expect(screen.queryByText('Step 2 of 4')).not.toBeInTheDocument()

    // "Continue →" is owned by EditQuizV2's footer nav (QuizWizardSteps is
    // stubbed), and drives setWizardStep('preview').
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument()
    expect(screen.getByText(/Preview quiz/)).toBeInTheDocument()

    // "← Back" walks the same order array back to the create step. (Exact
    // label so it doesn't also match the header's aria-label="Back" arrow.)
    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    await waitFor(() =>
      expect(screen.queryByText('Step 2 of 4')).not.toBeInTheDocument())
  })

  it('blocks the save and toasts when a question is incomplete', async () => {
    // No questions from Firestore ⇒ hydrate seeds a single blank starter
    // question. It counts toward questionCount but fails the per-question
    // content check, so validate() rejects before any write.
    loadOwnerQuiz()
    renderEditor()
    await screen.findByText('Edit quiz')

    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }))

    expect(await screen.findByText('Question 1 is missing question text.')).toBeInTheDocument()
    expect(mockUpdateQuizWithQuestions).not.toHaveBeenCalled()
  })

  it('writes through updateQuizWithQuestions when a valid quiz is saved as draft', async () => {
    loadOwnerQuiz()
    mockGetQuestions.mockResolvedValue([validQuestion])
    renderEditor()
    await screen.findByText('Edit quiz')
    // The loaded question is reflected in the header count.
    expect(screen.getByText(/· 1 questions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }))

    // The manual save reaches Firestore with the routed quiz id and a
    // draft status, and the success toast confirms the write completed.
    await waitFor(() => expect(mockUpdateQuizWithQuestions).toHaveBeenCalled())
    const [savedId, payload] = mockUpdateQuizWithQuestions.mock.calls[0]
    expect(savedId).toBe('quiz-1')
    expect(payload.status).toBe('draft')
    expect(await screen.findByText('Changes saved as draft.')).toBeInTheDocument()
  })
})
