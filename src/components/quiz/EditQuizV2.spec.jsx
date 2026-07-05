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
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}))

const mockGetQuizById = vi.fn()
const mockGetQuestions = vi.fn()
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getQuizById: mockGetQuizById,
    getQuestions: mockGetQuestions,
    updateQuiz: vi.fn(),
    updateQuizWithQuestions: vi.fn(),
  }),
}))

let mockAuth = { currentUser: { uid: 'owner-1' }, isAdmin: false }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

// Firebase-touching / heavy leaves used only inside handlers or deep panels.
vi.mock('../../utils/questionBankService', () => ({ captureQuestionsToBank: vi.fn() }))
vi.mock('../../utils/aiAssistant', () => ({ suggestQuizAnswers: vi.fn() }))
vi.mock('../../utils/quizAssignments', () => ({
  deriveQuizStatus: () => 'draft',
  listAssignmentsForResource: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../editor/RichContent.jsx', () => ({ getRichPlainText: () => '' }))
// documentQuizImporter → testPaperDiagram calls getFunctions() at import time.
vi.mock('./documentQuizImporter', () => ({
  importQuizDocument: vi.fn(),
  revokeImportedQuizAssets: vi.fn(),
}))

// Heavy child panels — render nothing so the editor's own shell is exercised.
vi.mock('./ImportQuizPanel', () => ({ default: () => null }))
vi.mock('./QuizSectionsEditor', () => ({ default: () => null }))
vi.mock('./QuizEditorPreviewPanel', () => ({ default: () => null }))
vi.mock('./QuizVerifyModal', () => ({ default: () => null }))
vi.mock('./BulkAnswerKey', () => ({ default: () => null }))
vi.mock('./ReviewPanel', () => ({ default: () => null }))
vi.mock('./StructuralValidationPanel', () => ({ default: () => null }))
vi.mock('./ImageCropModal', () => ({ default: () => null }))
vi.mock('./ImportReviewBanner', () => ({ default: () => null }))
vi.mock('./PastPaperReferenceBanner', () => ({ default: () => null }))
vi.mock('./QuizEditorActionBar', () => ({ default: () => null }))
vi.mock('./QuizEditorFloatingNav', () => ({ default: () => null }))
vi.mock('./QuizValidationChecklist', () => ({ default: () => null }))
vi.mock('./ReimportDiffModal', () => ({ default: () => null }))
vi.mock('./QuizWizardSteps', () => ({ default: () => null }))
vi.mock('./assignment/QuizStatusBadge', () => ({ default: () => null }))
vi.mock('./assignment/QuizAssignStep', () => ({ default: () => null }))
vi.mock('./assignment/QuizPublishStep', () => ({ default: () => null }))
vi.mock('../ui/ConfirmDialog', () => ({ default: () => null }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))

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
