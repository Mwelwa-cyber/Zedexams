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
import { ThemeProvider } from '../../../contexts/ThemeContext'

// firebase/config.js runs initializeApp at import time — stub it so the tree
// imports without a real Firebase project.
vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockGetQuizById = vi.fn()
const mockGetQuestions = vi.fn()
const mockSaveResult = vi.fn()
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getQuizById: mockGetQuizById,
    getQuestions: mockGetQuestions,
    saveResult: mockSaveResult,
  }),
}))

let mockCurrentUser = { uid: 'learner-1' }
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}))

let mockSubscription = { canUseExamMode: true, canAccessFullContent: true }
vi.mock('../../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscription,
}))

vi.mock('../../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: false }),
}))

const mockLoadQuizSession = vi.fn()
vi.mock('../../../hooks/useQuizPersistence', () => ({
  saveQuizSession: vi.fn(),
  loadQuizSession: (...args) => mockLoadQuizSession(...args),
  clearQuizSession: vi.fn(),
}))

// Network / AI leaf — never call the real checker in a unit test. Kept behind a
// handle so tests can make it resolve (online) or reject (offline).
const mockCheckAnswerWithAI = vi.fn()
vi.mock('../../../utils/geminiChecker', () => ({ checkAnswerWithAI: (...a) => mockCheckAnswerWithAI(...a) }))

// examService.js calls getFunctions(app) at import time; QuizRunnerV2 only
// pulls two pure grading helpers from it, so stub the module.
vi.mock('../../../utils/examService', () => ({
  numericMatches: () => false,
  hotspotMatches: () => false,
}))

// Heavy or firebase-touching visual leaves — stub to null so the render is
// light and self-contained. RichContent must keep its named export.
vi.mock('../../../editor/RichContent', () => ({
  default: ({ value }) => <span>{typeof value === 'string' ? value : ''}</span>,
  getRichPlainText: (v) => (typeof v === 'string' ? v : ''),
}))
vi.mock('../../../components/seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../components/diagrams/DiagramSvg', () => ({ default: () => null }))
vi.mock('../../../shared/components/ZoomableImage', () => ({ default: () => null }))
vi.mock('../../../shared/components/ExtraQuestionImages', () => ({ default: () => null }))
vi.mock('../components/QuizTip', () => ({ default: () => null }))
vi.mock('../../../components/subscription/UpgradeModal', () => ({ default: () => <div>Upgrade</div> }))

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

function shortAnswer(overrides = {}) {
  return {
    id: 'q1',
    type: 'short_answer',
    text: 'Name the process plants use to make food.',
    correctAnswer: 'photosynthesis',
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

// The runner's header carries the reading-theme picker, which reads the real
// ThemeProvider — the app mounts one above every route, so rendering the
// runner without it would be testing an arrangement that never ships.
function renderRunner() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <QuizRunnerV2 />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentUser = { uid: 'learner-1' }
  mockSubscription = { canUseExamMode: true, canAccessFullContent: true }
  searchParamsValue = ''
  mockLoadQuizSession.mockReturnValue(null)
  mockCheckAnswerWithAI.mockResolvedValue({ correct: true, feedback: 'Great' })
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

describe('QuizRunnerV2 — answering', () => {
  // The runner renders its MCQ options as <button className="zx-opt"> with
  // data-selected / data-correct / data-wrong attributes (the OptionButton
  // component). We drive those buttons directly to exercise the real
  // pick → reveal → grade path rather than any mock.

  // Helper: grab the option buttons in on-screen order (A, B, C, D → indices).
  function optionButtons(container) {
    return Array.from(container.querySelectorAll('.zx-opt'))
  }

  // Regression: the schema admits up to 20 options and past-paper import
  // produces up to 10, but this runner labelled choices with a literal
  // ['A','B','C','D'][i] — so a fifth option printed "undefined" as its letter.
  it('labels a five-option question A-E, never undefined', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([
      mcq({ options: ['3', '4', '5', '6', '7'], correctAnswer: 1 }),
    ])
    const { container } = renderRunner()
    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    const opts = optionButtons(container)
    expect(opts).toHaveLength(5)
    expect(opts.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('A'), expect.stringContaining('E'),
      ]),
    )
    expect(container.textContent).not.toContain('undefined')
  })

  it('marks the clicked option as selected in exam mode', async () => {
    // We resume straight into an exam session (no endTime → the countdown
    // effect early-returns, so nothing auto-submits) to land on the running
    // question without the pre-quiz card.
    //
    // This used to be the ONLY mode where data-selected stayed true after a
    // tap — practice revealed immediately and the selection flipped back to
    // false. That is no longer true, by the §10.0 decision; the practice case
    // is the test directly below.
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()])
    mockLoadQuizSession.mockReturnValue({
      mode: 'exam',
      answers: {},
      flagged: {},
      revealed: {},
      shortText: {},
      aiResults: {},
      activeSectionIndex: 0,
      startTime: 1,
    })
    const { container } = renderRunner()

    await screen.findByText('What is 2 + 2?')
    const opts = optionButtons(container)
    expect(opts).toHaveLength(4)

    // Tap option A ('3'); exam mode records the choice without revealing.
    fireEvent.click(opts[0])
    expect(opts[0]).toHaveAttribute('data-selected', 'true')
    // A sibling stays unselected, and nothing is revealed yet.
    expect(opts[1]).toHaveAttribute('data-selected', 'false')
    expect(opts[0]).toHaveAttribute('data-correct', 'false')
    expect(opts[1]).toHaveAttribute('data-wrong', 'false')
  })

  it('keeps the picked row marked as selected THROUGH the reveal', async () => {
    // The §10.0 `selected` divergence, decided 2026-08-14: all three renderers
    // now keep the selection after reveal. This card was the only one that
    // cleared it, and it could do so only because it takes `wrong` as a
    // separate prop — `PublicQuizRunner`'s card and `buildChoiceRows` both
    // DERIVE the ✗ from `selected`, so clearing it there deletes the marker.
    //
    // What it buys the learner: on a correct row the ✓ appears whether or not
    // they chose it, so the retained selection is the only thing that says
    // "and this was your answer" without scanning every other row for a ✗.
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()]) // correctAnswer: 1
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    fireEvent.click(optionButtons(container)[1])
    const revealed = optionButtons(container)
    expect(revealed[1]).toHaveAttribute('data-selected', 'true')
    expect(revealed[1]).toHaveAttribute('data-correct', 'true')
    // Only the picked row — this is not "everything is selected now".
    expect(revealed[0]).toHaveAttribute('data-selected', 'false')
    expect(revealed[2]).toHaveAttribute('data-selected', 'false')
  })

  it('and keeps it on a WRONG pick, where it is the row the learner chose', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()]) // correctAnswer: 1
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    fireEvent.click(optionButtons(container)[0])
    const revealed = optionButtons(container)
    expect(revealed[0]).toHaveAttribute('data-selected', 'true')
    expect(revealed[0]).toHaveAttribute('data-wrong', 'true')
    // The key is highlighted but was NOT the learner's choice, and the two
    // states are distinguishable — which is the whole point of the decision.
    expect(revealed[1]).toHaveAttribute('data-correct', 'true')
    expect(revealed[1]).toHaveAttribute('data-selected', 'false')
  })

  it('reveals the correct option when a learner picks it in practice mode', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()]) // correctAnswer: 1 → option B ('4')
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    // Click the correct option (index 1). Practice mode reveals instantly.
    fireEvent.click(optionButtons(container)[1])
    expect(optionButtons(container)[1]).toHaveAttribute('data-correct', 'true')
    // The celebratory reveal panel confirms the correct answer to the learner.
    expect(await screen.findByText(/Excellent! Well done!/i)).toBeInTheDocument()
  })

  it('flags a wrong pick and still highlights the correct option in practice mode', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()]) // correctAnswer: 1
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    // Click a wrong option (index 0 = 'A'/'3'). Reveal marks it wrong AND
    // points the learner at the correct option (index 1).
    fireEvent.click(optionButtons(container)[0])
    const revealed = optionButtons(container)
    expect(revealed[0]).toHaveAttribute('data-wrong', 'true')
    expect(revealed[1]).toHaveAttribute('data-correct', 'true')
    expect(await screen.findByText(/Not quite/i)).toBeInTheDocument()
  })

  it('advances through a two-question quiz with Next and reaches the submit modal', async () => {
    // Two single-MCQ sections so a Next control exists (a one-question quiz
    // jumps straight to Submit).
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([
      mcq({ id: 'q1', order: 0, text: 'What is 2 + 2?' }),
      mcq({ id: 'q2', order: 1, text: 'What is 3 + 3?', options: ['5', '6', '7', '8'], correctAnswer: 1 }),
    ])
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    // Answer Q1, then advance.
    fireEvent.click(optionButtons(container)[1])
    fireEvent.click(screen.getByRole('button', { name: /Next →/ }))

    // Q2 is now on screen; being the last section, the nav shows Submit 🏁.
    expect(await screen.findByText('What is 3 + 3?')).toBeInTheDocument()
    fireEvent.click(optionButtons(container)[1])
    const submitBtn = screen.getByRole('button', { name: /Submit 🏁/ })
    fireEvent.click(submitBtn)

    // The pre-submit review screen appears rather than submitting straight away.
    expect(await screen.findByText('Review your answers')).toBeInTheDocument()
  })

  it('lets the learner skip an unanswered question and submit from anywhere', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([
      mcq({ id: 'q1', order: 0, text: 'What is 2 + 2?' }),
      mcq({ id: 'q2', order: 1, text: 'What is 3 + 3?', options: ['5', '6', '7', '8'], correctAnswer: 1 }),
    ])
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    // Skip Q1 (unanswered) — Next advances with no blocking error. Practice has
    // no timer, so a hard block here would be a permanent dead-end.
    fireEvent.click(screen.getByRole('button', { name: /Next →/ }))
    expect(await screen.findByText('What is 3 + 3?')).toBeInTheDocument()
    expect(screen.queryByText(/answer this question before/i)).not.toBeInTheDocument()

    // Answer Q2 so only the deliberately-skipped Q1 remains unanswered.
    fireEvent.click(optionButtons(container)[1])

    // Submit is reachable even though Q1 was never answered.
    fireEvent.click(screen.getByRole('button', { name: /Submit 🏁/ }))
    expect(await screen.findByText('Review your answers')).toBeInTheDocument()
    // The review screen honestly reports the skipped question as unanswered.
    expect(screen.getByText(/1 unanswered question will be marked incorrect/)).toBeInTheDocument()
  })

  it('keeps Submit reachable on a non-final section so practice can never dead-end', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([
      mcq({ id: 'q1', order: 0 }),
      mcq({ id: 'q2', order: 1, text: 'Second' }),
    ])
    renderRunner()
    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')
    // On section 1 of 2 both controls are present.
    expect(screen.getByRole('button', { name: /Next →/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submit 🏁/ })).toBeInTheDocument()
  })

  it('submits the quiz — saveResult is called with a sensible payload and the app navigates to results', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()]) // single question → Submit 🏁 directly
    mockSaveResult.mockResolvedValue('result-99')
    const { container } = renderRunner()

    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await screen.findByText('What is 2 + 2?')

    // Answer the only question correctly, then open the review screen and finish.
    fireEvent.click(optionButtons(container)[1])
    fireEvent.click(screen.getByRole('button', { name: /Submit 🏁/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Finish quiz/ }))

    // saveResult receives the graded payload (server-authoritative scoring
    // re-grades from the question key, so a correct MCQ → 100%).
    await waitFor(() =>
      expect(mockSaveResult).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'learner-1',
          quizId: 'quiz-1',
          quizTitle: 'Addition Basics',
          mode: 'practice',
          score: 1,
          totalMarks: 1,
          percentage: 100,
        }),
      ),
    )
    // …and we route to the results page for the returned id.
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/results/result-99'))
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
    // Opts into includeExpired so a lapsed exam is recovered + auto-submitted
    // rather than silently dropped.
    expect(mockLoadQuizSession).toHaveBeenCalledWith('quiz-1', 'learner-1', { includeExpired: true })
  })

  it('recovers a lapsed exam by auto-submitting the saved answers instead of losing them', async () => {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq({ id: 'q1' })])
    mockSaveResult.mockResolvedValue('result-9')
    // An exam whose deadline passed while the app was closed — the persistence
    // layer now hands it back flagged `expired` rather than returning null.
    mockLoadQuizSession.mockReturnValue({
      mode: 'exam',
      answers: { q1: 1 },
      flagged: {},
      revealed: {},
      shortText: {},
      aiResults: {},
      activeSectionIndex: 0,
      endTime: 1, // in the past
      startTime: 1,
      expired: true,
    })
    renderRunner()
    // It finalises the recovered attempt (score saved) and routes to results,
    // rather than discarding the whole attempt.
    await waitFor(() => expect(mockSaveResult).toHaveBeenCalledTimes(1))
    expect(mockSaveResult).toHaveBeenCalledWith(
      expect.objectContaining({ quizId: 'quiz-1', mode: 'exam', answers: expect.objectContaining({ q1: 1 }) }),
    )
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/results/result-9'))
  })
})

describe('QuizRunnerV2 — exam short-answers are never lost to a dropped connection', () => {
  async function startExamWithShortAnswer() {
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([shortAnswer()])
    mockSaveResult.mockResolvedValue('result-sa')
    renderRunner()
    // Pick Exam mode, then start.
    fireEvent.click(await screen.findByRole('button', { name: /Timed/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start Exam/i }))
    return screen.findByPlaceholderText('Type your answer here...')
  }

  async function submitExam() {
    // Submit opens the pre-submit review screen (QuizReviewScreen); its
    // confirm button is "Finish quiz ✓" (the old inline confirm said
    // "Submit ✓" — this helper predates the review screen).
    fireEvent.click(screen.getByRole('button', { name: /Submit 🏁/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Finish quiz/ }))
    await waitFor(() => expect(mockSaveResult).toHaveBeenCalledTimes(1))
    return mockSaveResult.mock.calls[0][0]
  }

  it('records the typed answer immediately — no "Save Answer" / AI call needed', async () => {
    const input = await startExamWithShortAnswer()
    fireEvent.change(input, { target: { value: 'Photosynthesis' } })

    // The learner never taps Save Answer (and never needs a network round-trip);
    // the raw text is already in the submitted answers.
    const payload = await submitExam()
    expect(payload.mode).toBe('exam')
    expect(payload.answers.q1).toEqual({ text: 'Photosynthesis' })
    expect(mockCheckAnswerWithAI).not.toHaveBeenCalled()
  })

  it('keeps the answer and reassures the learner when AI marking fails offline', async () => {
    mockCheckAnswerWithAI.mockRejectedValue(new Error('Failed to fetch'))
    const input = await startExamWithShortAnswer()
    fireEvent.change(input, { target: { value: 'Photosynthesis' } })

    // Tapping Save Answer offline used to discard the answer; now it stays put
    // and the learner gets a calm, non-blocking message.
    fireEvent.click(screen.getByRole('button', { name: /Save Answer/i }))
    expect(await screen.findByText(/Your answer is saved/i)).toBeInTheDocument()

    // And it survives all the way into the submitted result — marked PENDING
    // (marking was attempted and failed), never scored wrong, so the attempt
    // persists as provisional rather than dragging the mark down.
    const payload = await submitExam()
    expect(payload.answers.q1).toEqual({ text: 'Photosynthesis', pending: true })
    expect(payload.gradingStatus).toBe('pending')
    expect(payload.finalScore).toBeNull()
  })

  it('enriches the answer with the AI verdict when marking succeeds online', async () => {
    mockCheckAnswerWithAI.mockResolvedValue({ graded: true, correct: true, feedback: 'Correct' })
    const input = await startExamWithShortAnswer()
    fireEvent.change(input, { target: { value: 'Photosynthesis' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Answer/i }))

    const payload = await submitExam()
    await waitFor(() => expect(mockCheckAnswerWithAI).toHaveBeenCalledTimes(1))
    expect(payload.answers.q1).toEqual({ text: 'Photosynthesis', correct: true })
    // Everything graded → the persisted attempt is FINAL with an authoritative score.
    expect(payload.gradingStatus).toBe('complete')
    expect(payload.scoreStatus).toBe('final')
    expect(payload.pendingQuestionIds).toEqual([])
    expect(typeof payload.finalScore).toBe('number')
  })

  it('persists a PROVISIONAL attempt (finalScore null) when AI marking could not grade an answer', async () => {
    // The grader returns an explicit un-graded/pending verdict (burst throttle /
    // provider timeout / budget) rather than a fabricated correct:false.
    mockCheckAnswerWithAI.mockResolvedValue({
      graded: false,
      pending: true,
      correct: null,
      feedback: 'Your answer is saved. We couldn’t mark it right now.',
    })
    const input = await startExamWithShortAnswer()
    fireEvent.change(input, { target: { value: 'Photosynthesis' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Answer/i }))
    expect(await screen.findByText(/couldn’t mark it right now/i)).toBeInTheDocument()

    const payload = await submitExam()
    // The answer is saved as pending — never as wrong.
    expect(payload.answers.q1).toEqual({ text: 'Photosynthesis', pending: true })
    // …and the whole attempt is persisted as PROVISIONAL so nothing downstream
    // (pass/fail, badges, leaderboards, class analytics) treats a partial mark
    // as settled. The durable Firestore doc — not just React state — carries it.
    expect(payload.gradingStatus).toBe('pending')
    expect(payload.scoreStatus).toBe('provisional')
    expect(payload.pendingQuestionIds).toEqual(['q1'])
    expect(payload.finalScore).toBeNull()
  })
})
