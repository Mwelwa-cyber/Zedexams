/**
 * QuizRunnerV2 against the session contract — DRAFT, NOT YET RUNNING.
 *
 * ## Why this file is `.draft.jsx` and not `.spec.jsx`
 *
 * Vitest collects `*.spec.{js,jsx}`. This is deliberately outside that glob
 * because the harness below does not yet run green, and the two dishonest ways
 * to land it are both worse than saying so:
 *
 *   • pushing it as a `.spec` file turns the required Vitest job red for
 *     everyone, for a suite that is nobody else's problem yet;
 *   • marking the assertions `.skip` dresses broken tests as passing ones, and
 *     starts the flaky → skipped → deleted decay that would destroy exactly the
 *     authority a characterisation suite needs.
 *
 * The SPEC — `sessionContract.jsx`, its contract/incidental classification and
 * its 24 assertions — is complete and is the artifact for review. This adapter
 * is the part that is not finished.
 *
 * ## What is blocking, precisely
 *
 * Established by isolating three configurations, not by guesswork:
 *
 *   A. real timers                        → mounts
 *   B. fake timers + shouldAdvanceTime    → mounts
 *   C. mount real, then install fake ones → hangs
 *
 * A frozen fake clock hangs the mount outright, because React Testing Library's
 * async `act` schedules through the timer APIs — so every assertion reported a
 * 5-second TIMEOUT rather than a failure, which reads as a broken suite instead
 * of wrong behaviour. `shouldAdvanceTime` fixes that (failures dropped from
 * 5000ms to ~50ms, four assertions pass) and forced a real improvement: the
 * deadline is now asserted as a DURATION rather than an absolute instant, which
 * is the property that matters and which cancels the clock drift that
 * `shouldAdvanceTime` allows.
 *
 * What remains is order dependence: the same assertion times out when run alone
 * and fails in ~50ms inside the full suite, so the remaining failures are
 * cascade rather than signal. Until that is fixed nothing here can be read as
 * evidence about the runner's behaviour.
 *
 * Rename to `.spec.jsx` when it is green — and not before.
 *
 * ## The original note
 *
 * QuizRunnerV2 against the session contract.
 *
 * The old runner is the SOURCE of the contract in
 * `src/engines/assessment-engine/session/characterisation/sessionContract.jsx`,
 * so it passing proves the assertions describe reality rather than an idea of
 * it. When the engine session exists it supplies its own harness and runs the
 * identical suite; nothing in the suite imports either implementation.
 *
 * Separate from `QuizRunnerV2.spec.jsx` on purpose. That file is this
 * component's own tests and may change with it. This one is a specification
 * that outlives it — it must not be edited to accommodate a new implementation,
 * because a spec edited to make the thing under test pass is not a spec.
 */
import { vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describeSessionContract } from '../../engines/assessment-engine/session/characterisation/sessionContract.jsx'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockGetQuizById = vi.fn()
const mockGetQuestions = vi.fn()
const mockSaveResult = vi.fn()
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getQuizById: mockGetQuizById,
    getQuestions: mockGetQuestions,
    saveResult: (...a) => mockSaveResult(...a),
  }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1' } }),
}))
vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ canUseExamMode: true, canAccessFullContent: true }),
}))
vi.mock('../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: false }),
}))

// The persistence boundary is the observable artifact — recorded, not stubbed
// away, because "what exactly gets persisted" is a contract behaviour.
const mockSaveQuizSession = vi.fn()
const mockLoadQuizSession = vi.fn()
vi.mock('../../hooks/useQuizPersistence', () => ({
  saveQuizSession: (...a) => mockSaveQuizSession(...a),
  loadQuizSession: (...a) => mockLoadQuizSession(...a),
  clearQuizSession: vi.fn(),
}))

vi.mock('../../utils/geminiChecker', () => ({ checkAnswerWithAI: vi.fn() }))
vi.mock('../../utils/examService', () => ({
  numericMatches: () => false,
  hotspotMatches: () => false,
}))
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

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ quizId: 'quiz-1' }),
    useSearchParams: () => [new URLSearchParams('')],
  }
})

const { default: QuizRunnerV2 } = await import('./QuizRunnerV2')

/** One MCQ per section, so section count and question count move together. */
const question = (i) => ({
  id: `q${i}`, type: 'mcq', text: `Question ${i}?`,
  options: ['a', 'b', 'c', 'd'], correctAnswer: 1, marks: 1, order: i - 1,
})

function makeHarness() {
  vi.clearAllMocks()
  mockLoadQuizSession.mockReturnValue(null)
  mockSaveResult.mockResolvedValue('result-1')

  let container = null

  // Drain BOTH queues. Microtasks alone are not enough — the runner's load()
  // awaits several promises in sequence — and neither are microtasks by
  // themselves under fake timers: React Testing Library's async act schedules
  // through setTimeout, so with the clock frozen and never advanced the await
  // simply never returns and every test reports a 5s timeout instead of a
  // failure. Advancing by 0 inside act runs those due callbacks without moving
  // the session clock, which the timer assertions advance deliberately.
  const flush = async () => {
    await act(async () => {
      for (let i = 0; i < 4; i += 1) {
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(0)
      }
    })
  }

  const optionButtons = () => Array.from(container.querySelectorAll('.zx-opt'))
  const byText = (re) => screen.queryAllByRole('button').find((b) => re.test(b.textContent || ''))

  return {
    async mount({ quiz = {}, sections = 1, savedSession = null, failSubmitOnce = false } = {}) {
      mockGetQuizById.mockResolvedValue({
        id: 'quiz-1', title: 'Characterisation Quiz', subject: 'Mathematics',
        grade: '4', duration: 30, questionCount: sections, totalMarks: sections,
        ...quiz,
      })
      mockGetQuestions.mockResolvedValue(
        Array.from({ length: sections }, (_, i) => question(i + 1)),
      )
      if (savedSession) mockLoadQuizSession.mockReturnValue(savedSession)
      if (failSubmitOnce) {
        mockSaveResult
          .mockRejectedValueOnce(new Error('network'))
          .mockResolvedValue('result-1')
      }
      const view = render(
        <MemoryRouter><QuizRunnerV2 /></MemoryRouter>,
      )
      container = view.container
      await flush()
      return view
    },

    async start(mode) {
      const label = mode === 'exam' ? /Start Exam/i : /Start Practice/i
      const btn = screen.queryByRole('button', { name: label })
      if (btn) await act(async () => { fireEvent.click(btn) })
      await flush()
    },

    isStarted: () => optionButtons().length > 0,

    async answerCurrent(index) {
      const opts = optionButtons()
      if (opts[index]) await act(async () => { fireEvent.click(opts[index]) })
      await flush()
    },

    async next() {
      const btn = byText(/Next/)
      if (btn) await act(async () => { fireEvent.click(btn) })
      await flush()
    },
    async prev() {
      const btn = byText(/Prev/)
      if (btn) await act(async () => { fireEvent.click(btn) })
      await flush()
    },
    async openSubmit() {
      const btn = byText(/Submit/)
      if (btn) await act(async () => { fireEvent.click(btn) })
      await flush()
    },
    async confirmSubmit() {
      const btn = byText(/Finish quiz/i)
      if (btn) await act(async () => { fireEvent.click(btn) })
      await flush()
    },

    /** Advance the session clock inside act so React applies what fires. */
    async tick(ms) {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
      await flush()
    },

    canGoPrev: () => {
      const btn = byText(/Prev/)
      return Boolean(btn) && !btn.disabled
    },
    hasNext: () => Boolean(byText(/Next/)),
    hasSubmit: () => Boolean(byText(/Submit/)),

    lastSavedSession: () => {
      const calls = mockSaveQuizSession.mock.calls
      return calls.length ? calls[calls.length - 1][2] : null
    },
    savedSessionCount: () => mockSaveQuizSession.mock.calls.length,
    submitCount: () => mockSaveResult.mock.calls.filter((_, i) =>
      mockSaveResult.mock.results[i]?.type !== 'throw').length,
    submittedResult: () => {
      const ok = mockSaveResult.mock.calls.filter((_, i) =>
        mockSaveResult.mock.results[i]?.value?.then || mockSaveResult.mock.results[i]?.type === 'return')
      // A rejected save is not a submitted result.
      const settled = mockSaveResult.mock.results.filter((r) => r.type === 'return')
      return settled.length && ok.length ? mockSaveResult.mock.calls[mockSaveResult.mock.calls.length - 1][0] : null
    },
  }
}

describeSessionContract('QuizRunnerV2', makeHarness)
