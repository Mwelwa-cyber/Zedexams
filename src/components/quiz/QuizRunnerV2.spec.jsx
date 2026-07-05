/**
 * Behaviour tests for QuizRunnerV2.jsx — the learner quiz-taking runner.
 *
 * QuizRunnerV2 is one of the largest, highest-traffic learner components and
 * previously had no component-level coverage. These tests guard its state
 * machine and the recoverable dead-ends that used to blank the screen:
 *   - loading / error / empty-quiz states,
 *   - the paywall redirect for non-demo quizzes,
 *   - the pre-quiz start card (mode selection + premium lock),
 *   - starting a practice quiz,
 *   - auto-resuming a saved in-progress session.
 *
 * The Firestore hooks, subscription/auth context, and heavy visual leaves are
 * stubbed; the real section builder (buildQuizDisplaySections) and the real
 * ErrorState are kept so the tests exercise genuine wiring rather than mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// firebase/config.js runs initializeApp at import time — stub it so the tree
// imports without a real Firebase project.
vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockGetQuizById = vi.fn()
const mockGetQuestions = vi.fn()
const mockSaveResult = vi.fn()
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getQuizById: mockGetQuizById,
    getQuestions: mockGetQuestions,
    saveResult: mockSaveResult,
  }),
}))

let mockCurrentUser = { uid: 'learner-1' }
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}))

let mockSubscription = { canUseExamMode: true, canAccessFullContent: true }
vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscription,
}))

vi.mock('../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: false }),
}))

const mockLoadQuizSession = vi.fn()
vi.mock('../../hooks/useQuizPersistence', () => ({
  saveQuizSession: vi.fn(),
  loadQuizSession: (...args) => mockLoadQuizSession(...args),
  clearQuizSession: vi.fn(),
}))

// Network / AI leaf — never call the real checker in a unit test.
vi.mock('../../utils/geminiChecker', () => ({ checkAnswerWithAI: vi.fn() }))

// examService.js calls getFunctions(app) at import time; QuizRunnerV2 only
// pulls two pure grading helpers from it, so stub the module.
vi.mock('../../utils/examService', () => ({
  numericMatches: () => false,
  hotspotMatches: () => false,
}))

// Heavy or firebase-touching visual leaves — stub to null so the render is
// light and self-contained. RichContent must keep its named export.
vi.mock('../../editor/RichContent', () => ({
  default: ({ value }) => <span>{typeof value === 'string' ? value : ''}</span>,
  getRichPlainText: (v) => (typeof v === 'string' ? v : ''),
}))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../diagrams/DiagramSvg', () => ({ default: () => null }))
vi.mock('./ZoomableImage', () => ({ default: () => null }))
vi.mock('./ExtraQuestionImages', () => ({ default: () => null }))
vi.mock('./QuizTip', () => ({ default: () => null }))
vi.mock('../subscription/UpgradeModal', () => ({ default: () => <div>Upgrade</div> }))

const mockNavigate = vi.fn()
let searchParamsValue = ''
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ quizId: 'quiz-1' }),
    useSearchParams: () => [new URLSearchParams(searchParamsValue)],
  }
})

import QuizRunnerV2 from './QuizRunnerV2'

function mcq(overrides = {}) {
  return {
    id: overrides.id || 'q1',
    type: 'mcq',
    text: 'What is 2 + 2?',
    options: ['3', '4', '5', '6'],
    correctAnswer: 1,
    marks: 1,
    order: 0,
    ...overrides,
  }
}

function quizDoc(overrides = {}) {
  return {
    id: 'quiz-1',
    title: 'Addition Basics',
    subject: 'Mathematics',
    grade: 4,
    term: 1,
    isDemo: true,
    passages: [],
    ...overrides,
  }
}

function renderRunner() {
  return render(
    <MemoryRouter>
      <QuizRunnerV2 />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentUser = { uid: 'learner-1' }
  mockSubscription = { canUseExamMode: true, canAccessFullContent: true }
  searchParamsValue = ''
  mockLoadQuizSession.mockReturnValue(null)
})

describe('QuizRunnerV2 — load states', () => {
  it('shows the loading state before the quiz resolves', () => {
    // never-resolving promises keep the component in its loading branch
    mockGetQuizById.mockReturnValue(new Promise(() => {}))
    mockGetQuestions.mockReturnValue(new Promise(() => {}))
    renderRunner()
    expect(screen.getByText('Loading quiz...')).toBeInTheDocument()
  })

  it('renders the friendly "Quiz Not Available" error when the quiz is missing', async () => {
    mockGetQuizById.mockResolvedValue(null)
    mockGetQuestions.mockResolvedValue([])
    renderRunner()
    expect(await screen.findByText('Quiz Not Available')).toBeInTheDocument()
  })

  it('renders a recoverable empty state when the quiz has no questions', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([])
    renderRunner()
    // pre-quiz card renders first; start it, then the runner hits the
    // no-active-section guard rather than blanking the screen.
    const startBtn = await screen.findByRole('button', { name: /Start Practice/i })
    fireEvent.click(startBtn)
    expect(await screen.findByText('No questions available for this quiz.')).toBeInTheDocument()
  })
})

describe('QuizRunnerV2 — access control', () => {
  it('redirects a locked learner away from a non-demo quiz', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc({ isDemo: false }))
    mockGetQuestions.mockResolvedValue([mcq()])
    mockSubscription = { canUseExamMode: false, canAccessFullContent: false }
    renderRunner()
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/quizzes',
        expect.objectContaining({ replace: true, state: { blocked: true } }),
      ),
    )
    // The pre-quiz card must never render against the null quiz left behind by
    // the redirect path — we hold the loading visual instead of crashing.
    expect(screen.queryByRole('button', { name: /Start Practice/i })).not.toBeInTheDocument()
    expect(screen.getByText('Loading quiz...')).toBeInTheDocument()
  })

  it('lets a locked learner into a demo quiz', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc({ isDemo: true }))
    mockGetQuestions.mockResolvedValue([mcq()])
    mockSubscription = { canUseExamMode: false, canAccessFullContent: false }
    renderRunner()
    expect(await screen.findByText('Addition Basics')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe('QuizRunnerV2 — pre-quiz start card', () => {
  it('shows the quiz meta and locks exam mode for non-premium learners', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()])
    mockSubscription = { canUseExamMode: false, canAccessFullContent: true }
    renderRunner()
    expect(await screen.findByText('Addition Basics')).toBeInTheDocument()
    expect(screen.getByText(/Mathematics · Grade 4 · Term 1/)).toBeInTheDocument()
    // exam mode advertises "Premium only" when the learner can't use it
    expect(screen.getByText('Premium only')).toBeInTheDocument()
  })

  it('starts a practice quiz and shows the first question', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()])
    renderRunner()
    const startBtn = await screen.findByRole('button', { name: /Start Practice/i })
    fireEvent.click(startBtn)
    expect(await screen.findByText('What is 2 + 2?')).toBeInTheDocument()
  })
})

describe('QuizRunnerV2 — session resume', () => {
  it('auto-resumes an in-progress saved session straight into the running view', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()])
    mockLoadQuizSession.mockReturnValue({
      mode: 'practice',
      answers: {},
      flagged: {},
      revealed: {},
      shortText: {},
      aiResults: {},
      activeSectionIndex: 0,
      startTime: 1,
    })
    renderRunner()
    // No "Start Practice" pre-quiz button — the runner jumps to the question.
    expect(await screen.findByText('What is 2 + 2?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start Practice/i })).not.toBeInTheDocument()
    expect(mockLoadQuizSession).toHaveBeenCalledWith('quiz-1', 'learner-1')
  })
})
