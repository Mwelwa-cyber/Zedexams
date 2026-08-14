/**
 * The Phase 3 quiz cutover, from the learner's side.
 *
 * `docs/phase3-plan.md` §5.1(6) requires a spec that renders the ENGINE's
 * version of the runner and asserts the §2 layout contract, before the flag may
 * be flipped for anyone. This is that spec, plus the refusal rules that decide
 * WHICH quizzes the engine is allowed to serve at all — which at this runner is
 * the load-bearing half. `QuizRunnerV2` draws eleven question types and the
 * engine draws two, so the cutover is safe exactly to the extent that a quiz
 * containing anything else falls back whole.
 *
 * The flag hook is the one thing stubbed rather than exercised: its own
 * resolution is `flags.test.js` + `useAssessmentEngineFlag.spec.jsx`, and
 * re-deriving a decision here would test the stub. Everything downstream of the
 * decision — normalise, refuse, render, mark, build the written document — is
 * the real code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../contexts/ThemeContext'

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

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1' } }),
}))

vi.mock('../../../hooks/useSubscription', () => ({
  useSubscription: () => ({ canUseExamMode: true, canAccessFullContent: true }),
}))

vi.mock('../../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: false }),
}))

vi.mock('../../../hooks/useQuizPersistence', () => ({
  saveQuizSession: vi.fn(),
  loadQuizSession: () => null,
  clearQuizSession: vi.fn(),
}))

vi.mock('../../../utils/geminiChecker', () => ({ checkAnswerWithAI: vi.fn() }))

vi.mock('../../../utils/examService', () => ({
  numericMatches: () => false,
  hotspotMatches: () => false,
}))

// The engine's ChoiceQuestion renders option content through RichContent, so
// this stub has to draw the value it is handed — a stub returning null would
// make every letter-badge assertion below pass against an empty card.
vi.mock('../../../editor/RichContent', () => ({
  default: ({ value }) => <span>{typeof value === 'string' ? value : ''}</span>,
  getRichPlainText: (v) => (typeof v === 'string' ? v : ''),
}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../components/diagrams/DiagramSvg', () => ({ default: () => null }))
vi.mock('../../../shared/components/ZoomableImage', () => ({ default: () => null }))
vi.mock('../../../shared/components/ExtraQuestionImages', () => ({ default: () => null }))
vi.mock('../components/QuizTip', () => ({ default: () => null }))
vi.mock('../../../components/subscription/UpgradeModal', () => ({ default: () => <div>Upgrade</div> }))

const mockCapture = vi.fn()
vi.mock('../../../utils/analytics', () => ({ capture: (...a) => mockCapture(...a) }))

const mockReportClientError = vi.fn()
vi.mock('../../../utils/clientErrorReporting', () => ({
  reportClientError: (...a) => mockReportClientError(...a),
}))

// The flag decision itself is stubbed; see the header.
let mockFlag = { engine: true, resolved: true, final: true, source: 'rollout-all', latched: false, live: true }
vi.mock('../../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => mockFlag,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ quizId: 'quiz-1' }),
    useSearchParams: () => [new URLSearchParams('')],
  }
})

import QuizRunnerV2 from './QuizRunnerV2'

function mcq(overrides = {}) {
  return {
    id: 'q1',
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
  return render(runnerTree())
}

/** Load the quiz, then press through the start card into a practice attempt. */
async function startPractice({ quiz = quizDoc(), questions = [mcq()] } = {}) {
  mockGetQuizById.mockResolvedValue(quiz)
  mockGetQuestions.mockResolvedValue(questions)
  const result = renderRunner()
  const start = await screen.findByRole('button', { name: /Start Practice/i })
  fireEvent.click(start)
  await waitFor(() => expect(screen.queryByRole('button', { name: /Start Practice/i })).toBeNull())
  return result
}

const engineCard = () => document.querySelector('[data-engine-runner="quiz"]')

/**
 * Re-render the ALREADY-MOUNTED runner so it re-reads the module-level flag
 * stub. Must be RTL's `rerender`, not a second `render`: a second mount would
 * put two runners in the document and `engineCard()` would find whichever came
 * first, which is how a rollback test passes without a rollback happening.
 */
// A FRESH element every call. Reusing one object makes React bail out on
// referential equality and skip the re-render entirely — which silently turns
// "the rollback reached the learner" into "nothing happened", and a test that
// asserts the card is absent then passes because it was never re-rendered.
const runnerTree = () => (
  <MemoryRouter><ThemeProvider><QuizRunnerV2 /></ThemeProvider></MemoryRouter>
)

/** Submit opens the review screen; the attempt is filed from its Finish button. */
async function finishQuiz() {
  fireEvent.click(await screen.findByRole('button', { name: /Submit/i }))
  fireEvent.click(await screen.findByRole('button', { name: /Finish quiz/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFlag = { engine: true, resolved: true, final: true, source: 'rollout-all', latched: false, live: true }
  mockSaveResult.mockResolvedValue('result-1')
})

describe('the engine serves the choice card', () => {
  it('draws the engine card when the flag selects it', async () => {
    await startPractice()
    expect(engineCard()).not.toBeNull()
  })

  it('draws ONE vertical column of full-width rows, per the §2 layout contract', async () => {
    await startPractice()
    // `.opt-grid` is `grid-template-columns: 1fr` — the single-column contract
    // expressed once, in CSS. Asserting the class is asserting that contract.
    expect(engineCard().querySelector('.opt-grid')).not.toBeNull()
  })

  it('carries a letter badge on every row, and letters run past D', async () => {
    // Five options is the case the contract names: a renderer that hard-coded
    // A–D would silently drop the fifth row's identity, and "the answer is E"
    // would be unsayable.
    await startPractice({
      questions: [mcq({ options: ['3', '4', '5', '6', '7'], correctAnswer: 4 })],
    })
    const letters = [...engineCard().querySelectorAll('.zx-opt-letter')].map((n) => n.textContent)
    expect(letters).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('reports the path it actually served, once', async () => {
    await startPractice()
    await waitFor(() => expect(mockCapture).toHaveBeenCalledWith(
      'assessment_engine_path',
      expect.objectContaining({ runner: 'quiz', engine: true, flagSource: 'rollout-all', live: true }),
    ))
    expect(mockCapture.mock.calls.filter((c) => c[0] === 'assessment_engine_path')).toHaveLength(1)
  })
})

describe('what the engine refuses to serve', () => {
  it('falls back to the old card when the flag is off', async () => {
    mockFlag = { ...mockFlag, engine: false, source: 'runner-off' }
    await startPractice()
    expect(engineCard()).toBeNull()
    // The old card still renders its options, so the learner loses nothing.
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument()
  })

  it('falls back while the decision is still provisional', async () => {
    // Acting on an unresolved decision would swap the card out from under a
    // learner who had already answered, and the answer does not carry across.
    mockFlag = { ...mockFlag, resolved: false, final: false }
    await startPractice()
    expect(engineCard()).toBeNull()
  })

  it('serves the WHOLE quiz on the old card when one question is a type the engine cannot draw', async () => {
    // The refusal that makes this cutover safe: eleven drawable types on the old
    // runner, two on the engine. A per-question mix would show one learner two
    // card designs in one attempt and make a render bug unattributable.
    await startPractice({
      questions: [
        mcq({ id: 'q1' }),
        { id: 'q2', type: 'short_answer', text: 'Name the process.', correctAnswer: 'photosynthesis', marks: 1, order: 1 },
      ],
    })
    expect(engineCard()).toBeNull()
    // …and the mcq that COULD have been drawn by the engine is still answerable.
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument()
  })

  it('falls back when a question carries an answer key the normaliser does not read', async () => {
    // A letter key is one of the legacy shapes `correctIndexOf` does not read:
    // it is not an integer, so the canonical correctIndex is null, and a card
    // built on it would paint nothing green and mark every selection wrong — a
    // silent loss of marks, not a crash.
    await startPractice({ questions: [mcq({ correctAnswer: 'B' })] })
    expect(engineCard()).toBeNull()
  })

  it('falls back when any option carries a picture the engine card cannot draw', async () => {
    // The refusal the TYPE check cannot make: `mcq` is a supported type, but
    // the canonical model has no field for per-option media and the engine card
    // draws only text. Served by the engine, a question whose options are
    // pictures renders as blank-looking rows and cannot be answered.
    await startPractice({
      questions: [mcq({
        options: ['', '', '', ''],
        optionMedia: [{ imageUrl: 'https://example.test/a.png' }, null, null, null],
      })],
    })
    expect(engineCard()).toBeNull()
  })

  it('still serves a quiz whose optionMedia array is present but empty', async () => {
    // The control for the refusal above: an `optionMedia` array carrying no
    // actual media must NOT push the quiz onto the old runner, or the check
    // would quietly exclude most of the corpus and the refusal rate would be
    // read as "the engine cannot serve these questions".
    await startPractice({
      questions: [mcq({ optionMedia: [null, null, null, null] })],
    })
    expect(engineCard()).not.toBeNull()
  })

  it('falls back when a topic would be KEYED differently by the two paths', async () => {
    // Not a render refusal — a WRITE one. The engine trims topics and the old
    // path does not, so ' Algebra ' would key `topicScores` differently on each
    // path and split a learner's topic aggregates. timeSpent is the only
    // deviation this cutover declared.
    await startPractice({ questions: [mcq({ topic: ' Algebra ' })] })
    expect(engineCard()).toBeNull()
  })

  it('falls back when a topic is whitespace only', async () => {
    // The old path keys '   ' verbatim; the engine drops it and keys 'General'.
    await startPractice({ questions: [mcq({ topic: '   ' })] })
    expect(engineCard()).toBeNull()
  })

  it('still serves an already-trimmed topic, and a question with no topic', async () => {
    // The control: the refusal above must not exclude the ordinary corpus, or
    // the engine would quietly serve almost nothing and the refusal rate would
    // be misread as "these questions cannot be drawn".
    await startPractice({
      questions: [mcq({ id: 'q1', topic: 'Algebra' }), mcq({ id: 'q2', topic: undefined })],
    })
    expect(engineCard()).not.toBeNull()
  })

  it('refuses, and reports, when the canonical id does not match the route', async () => {
    // The written document takes its quizId from the canonical id, so this one
    // is a wrong-quiz result rather than a wrong render — nothing on screen
    // would show it.
    await startPractice({ quiz: quizDoc({ id: 'a-different-quiz' }) })
    expect(engineCard()).toBeNull()
    expect(mockReportClientError).toHaveBeenCalled()
  })
})

describe('the decision is latched for the duration of an attempt', () => {
  it('keeps a learner who started on the old card there, even once the flag turns on', async () => {
    // The quiz document can load before the flag settles. A learner may press
    // Start and answer on the old card; if the decision then landed on engine,
    // an unlatched memo would swap the card mid-attempt — the swap the latch
    // exists to prevent.
    mockFlag = { ...mockFlag, engine: false, resolved: false, final: false }
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()])
    const { rerender } = renderRunner()
    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Start Practice/i })).toBeNull())
    expect(engineCard()).toBeNull()

    // The decision now settles on the engine, mid-attempt.
    mockFlag = { engine: true, resolved: true, final: true, source: 'rollout-all', latched: false, live: true }
    rerender(runnerTree())
    expect(engineCard()).toBeNull()
  })

  it('reports that hold as its own dimension, not as a refusal', async () => {
    // `engine:false, latched:false` is what a normalisation refusal looks like.
    // A quiz the engine COULD serve, held only because the attempt started
    // early, must not be counted there — the refusal rate is what the ramp
    // decision is read from.
    mockFlag = { ...mockFlag, engine: false, resolved: false, final: false }
    mockGetQuizById.mockResolvedValue(quizDoc())
    mockGetQuestions.mockResolvedValue([mcq()])
    const { rerender } = renderRunner()
    fireEvent.click(await screen.findByRole('button', { name: /Start Practice/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Start Practice/i })).toBeNull())

    mockFlag = { engine: true, resolved: true, final: true, source: 'rollout-all', latched: false, live: true }
    rerender(runnerTree())
    await waitFor(() => expect(mockCapture).toHaveBeenCalledWith(
      'assessment_engine_path',
      expect.objectContaining({ engine: false, heldByAttemptLatch: true }),
    ))
  })
})

describe('a rollback reaches an attempt already running on the engine', () => {
  it('drops back to the old card when an operator disables the flag mid-attempt', async () => {
    // The latch holds false→true so nobody is swapped ONTO the engine
    // mid-question. It must NOT hold true→false: disabling the flag is an
    // emergency rollback, and the learners on the engine are exactly the
    // population it is for. Held both ways, an in-flight attempt kept the
    // engine renderer, verdict and result writer after the switch was thrown.
    const { rerender } = await startPractice()
    expect(engineCard()).not.toBeNull()

    mockFlag = { ...mockFlag, engine: false, source: 'runner-off' }
    rerender(runnerTree())
    expect(engineCard()).toBeNull()
    // The learner keeps their question — the old card renders it.
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument()
  })
})

describe('the verdict and the written result come from the engine', () => {
  it('marks a correct choice correct, and files the score through the engine builder', async () => {
    await startPractice({
      questions: [mcq({ options: ['3', '4', '5', '6'], correctAnswer: 1, marks: 1 })],
    })
    // Anchor the write to the path under test: both builders produce the same
    // document by design (that is what the replay harness proves), so without
    // this the assertions below would pass just as well on the old path.
    expect(engineCard()).not.toBeNull()
    // Pick 'B' — the key.
    fireEvent.click(screen.getByText('4').closest('button'))
    await finishQuiz()

    await waitFor(() => expect(mockSaveResult).toHaveBeenCalled())
    const written = mockSaveResult.mock.calls[0][0]
    expect(written).toMatchObject({
      userId: 'learner-1',
      quizId: 'quiz-1',
      quizTitle: 'Addition Basics',
      subject: 'Mathematics',
      score: 1,
      totalMarks: 1,
      percentage: 100,
      mode: 'practice',
      gradingStatus: 'complete',
      scoreStatus: 'final',
    })
    // `grade` is a string on `results` by deliberate divergence from `scores`,
    // which stores it as a Number. The two must not converge.
    expect(typeof written.grade).toBe('string')
  })

  it('scores a wrong choice as wrong', async () => {
    await startPractice({
      questions: [mcq({ options: ['3', '4', '5', '6'], correctAnswer: 1, marks: 1 })],
    })
    expect(engineCard()).not.toBeNull()
    fireEvent.click(screen.getByText('5').closest('button'))
    await finishQuiz()

    await waitFor(() => expect(mockSaveResult).toHaveBeenCalled())
    expect(mockSaveResult.mock.calls[0][0]).toMatchObject({ score: 0, percentage: 0 })
  })
})
