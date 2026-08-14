/**
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
 *
 * ## Four things this harness got wrong, and what was actually true
 *
 * Recorded because the first two diagnoses were confident and wrong, and the
 * corrections are the only reason the suite runs. Each is enforced by the
 * `harness self-check` block at the bottom of this file rather than by this
 * comment — a rule stated in prose is one the next person can restate their
 * way round.
 *
 *   1. **Every mocked hook must return the SAME reference on every render.**
 *      This was the whole problem. `useNavigate: () => vi.fn()` and
 *      `useAuth: () => ({ currentUser })` minted a fresh reference per render,
 *      and the loader effect (`QuizRunnerV2.jsx:414`) lists both in its
 *      dependencies — so it re-ran, set state, re-rendered, and re-ran. The act
 *      queue never emptied, `await act(async …)` never resolved, and all 21
 *      assertions reported a 5-second TIMEOUT rather than a failure.
 *
 *   2. **It was never about the clock.** The timeout was blamed on fake timers,
 *      and `shouldAdvanceTime: true` was adopted as "load-bearing" on the
 *      strength of it. Probing render-then-flush under both clocks disproves
 *      that: with the mocks unstable, real timers hang identically; with them
 *      stable, a FROZEN fake clock settles in ~50ms. So the suite runs on a
 *      frozen clock advanced only where a test says to — which is what a
 *      characterisation suite needs, and what `shouldAdvanceTime` had quietly
 *      cost. The deadline assertions are still written as DURATIONS, which was
 *      a real improvement and is kept.
 *
 *   3. **`ThemeProvider` is required**, and this one was right: the started
 *      view reaches `useTheme`, which throws without it.
 *
 *   4. **Starting an EXAM takes two clicks, not one.** The pre-quiz card is a
 *      mode picker (`QuizRunnerV2.jsx:212-234`) — the CTA reads "Start
 *      Practice" until the Exam tile is selected, so a harness that looked for
 *      "Start Exam" on arrival silently started every exam test in practice
 *      mode. The smallest of the four and the most dangerous kind: it does not
 *      fail, it passes while describing something other than what it names.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ThemeProvider } from '../../../contexts/ThemeContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useDataSaver } from '../../../contexts/DataSaverContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { useFirestore } from '../../../hooks/useFirestore'
import { describeSessionContract } from '../../../engines/assessment-engine/session/characterisation/sessionContract.jsx'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

// ── Every mocked hook returns ONE reference, for the life of the file ────────
//
// Not a tidiness preference. See note 1 above: a fresh object or function from
// any of these is a dependency change on every render, and the runner's loader
// effect turns that into an unbounded render loop that presents as a timeout.
// The `harness self-check` block below fails if any of them starts minting.

const mockGetQuizById = vi.fn()
const mockGetQuestions = vi.fn()
const mockSaveResult = vi.fn()
const mockFirestore = {
  getQuizById: (...a) => mockGetQuizById(...a),
  getQuestions: (...a) => mockGetQuestions(...a),
  saveResult: (...a) => mockSaveResult(...a),
}
vi.mock('../../../hooks/useFirestore', () => ({ useFirestore: () => mockFirestore }))

const mockAuth = { currentUser: { uid: 'learner-1' } }
const mockSubscription = { canUseExamMode: true, canAccessFullContent: true }
const mockDataSaver = { dataSaver: false }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
vi.mock('../../../hooks/useSubscription', () => ({ useSubscription: () => mockSubscription }))
vi.mock('../../../contexts/DataSaverContext', () => ({ useDataSaver: () => mockDataSaver }))

// The persistence boundary is the observable artifact — recorded, not stubbed
// away, because "what exactly gets persisted" is a contract behaviour.
const mockSaveQuizSession = vi.fn()
const mockLoadQuizSession = vi.fn()
vi.mock('../../../hooks/useQuizPersistence', () => ({
  saveQuizSession: (...a) => mockSaveQuizSession(...a),
  loadQuizSession: (...a) => mockLoadQuizSession(...a),
  clearQuizSession: vi.fn(),
}))

vi.mock('../../../utils/geminiChecker', () => ({ checkAnswerWithAI: vi.fn() }))
vi.mock('../../../utils/examService', () => ({
  numericMatches: () => false,
  hotspotMatches: () => false,
}))
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
const mockParams = { quizId: 'quiz-1' }
const mockSearchParams = [new URLSearchParams('')]
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
    useSearchParams: () => mockSearchParams,
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
  // clearAllMocks resets CALLS, not queued once-implementations, so a rejection
  // armed by `failSubmitOnce` would otherwise outlive its test.
  mockSaveResult.mockReset()
  mockLoadQuizSession.mockReturnValue(null)
  mockSaveResult.mockResolvedValue('result-1')

  let container = null

  // Settling is done by flushing microtasks inside `act`, never by waiting on
  // the clock. `waitFor` under fake timers ADVANCES them to make progress,
  // which would let a deadline assertion pass on time the test never asked
  // for. The loop is bounded and clock-free, so a runner that never renders a
  // control fails with that sentence rather than with a 5-second timeout.
  //
  // "Settled" is "no longer loading", NOT "a control is on screen". Those look
  // the same until the expired-resume case, which auto-submits on arrival and
  // therefore renders the Saving view — correctly offering nothing to click.
  // Waiting for a button there fails a mount that worked.
  const flush = async () => { await act(async () => { await Promise.resolve() }) }
  const settle = async () => {
    for (let i = 0; i < 10; i += 1) {
      await flush()
      const text = container.textContent || ''
      if (text && !text.includes('Loading quiz')) return
    }
    throw new Error('the runner never left its loading state after 10 microtask flushes')
  }

  const buttons = () => Array.from(container.querySelectorAll('button'))
  const optionButtons = () => Array.from(container.querySelectorAll('.zx-opt'))
  const byText = (re) => screen.queryAllByRole('button').find((b) => re.test(b.textContent || ''))
  const click = async (el) => {
    if (el) await act(async () => { fireEvent.click(el) })
    await flush()
  }

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
      // ThemeProvider is required: the started view reaches useTheme, which
      // throws without it.
      const view = render(
        <MemoryRouter><ThemeProvider><QuizRunnerV2 /></ThemeProvider></MemoryRouter>,
      )
      container = view.container
      await settle()
      return view
    },

    /**
     * The pre-quiz card is a mode PICKER, so exam mode is two clicks: select
     * the Exam tile, then press the CTA — which only then reads "Start Exam".
     */
    async start(mode) {
      if (mode === 'exam') {
        await click(buttons().find((b) => /Exam/.test(b.textContent || '') && !/Start/.test(b.textContent || '')))
      }
      await click(buttons().find((b) => /Start/.test(b.textContent || '')))
    },

    isStarted: () => optionButtons().length > 0,

    async answerCurrent(index) {
      await click(optionButtons()[index])
    },

    async next() { await click(byText(/Next/)) },
    async prev() { await click(byText(/Prev/)) },
    async openSubmit() { await click(byText(/Submit/)) },
    async confirmSubmit() { await click(byText(/Finish quiz/i)) },

    /** Advance the session clock inside act so React applies what fires. */
    async tick(ms) {
      await act(async () => { vi.advanceTimersByTime(ms) })
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
    // A rejected save is an ATTEMPT, not a submitted result — which is the
    // whole point of the retry assertion. `mock.results` cannot tell the two
    // apart for an async function: a rejection is recorded as a `return` whose
    // value happens to be a rejected promise. `mock.settledResults` is the API
    // that distinguishes them, and using the wrong one would report a failed
    // save as a successful submit.
    submitCount: () => mockSaveResult.mock.settledResults.filter((r) => r.type === 'fulfilled').length,
    submittedResult: () => {
      const lastOk = mockSaveResult.mock.settledResults
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.type === 'fulfilled')
        .pop()
      return lastOk ? mockSaveResult.mock.calls[lastOk.i][0] : null
    },
  }
}

/**
 * The harness checking ITSELF, because every one of its bugs was invisible
 * from the contract's side.
 *
 * Two presented as a 5-second timeout on every assertion, which reads as "the
 * suite is broken" and not as "the harness is lying" — and the first diagnosis
 * blamed the wrong thing and was believed for a day. Two more would not have
 * failed at all: an exam started in practice mode, and a rejected save counted
 * as a submit, are both GREEN and both describe something other than what they
 * name. A comment saying "keep these references stable" would not have caught
 * the next person adding an eighth mocked hook in the obvious style.
 *
 * Each assertion below fails if its fix is reverted. That is the bar: a
 * self-check that merely restates the rule is documentation with a green tick.
 */
describe('QuizRunnerV2 — harness self-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetQuizById.mockResolvedValue({
      id: 'quiz-1', title: 'Q', subject: 'Mathematics', grade: '4',
      duration: 30, questionCount: 1, totalMarks: 1,
    })
    mockGetQuestions.mockResolvedValue([question(1)])
    mockLoadQuizSession.mockReturnValue(null)
    mockSaveResult.mockResolvedValue('result-1')
  })
  afterEach(() => { vi.useRealTimers() })

  const flush = async () => { await act(async () => { await Promise.resolve() }) }

  it('every mocked hook returns the SAME reference twice — a fresh one is a render loop', () => {
    // Cause 1. `useNavigate: () => vi.fn()` and `useAuth: () => ({ … })` mint
    // per call; the runner's loader effect depends on both, so it re-ran on
    // every render it caused. Reverting any one of these to an inline literal
    // fails here, before it can present as a timeout somewhere else.
    for (const [name, hook] of [
      ['useAuth', useAuth],
      ['useSubscription', useSubscription],
      ['useDataSaver', useDataSaver],
      ['useFirestore', useFirestore],
      ['useNavigate', useNavigate],
      ['useParams', useParams],
      ['useSearchParams', useSearchParams],
    ]) {
      expect(hook(), `${name}() must return one stable reference`).toBe(hook())
    }
  })

  it('mounting loads the quiz EXACTLY once — the observable of that loop', async () => {
    // The identity check above is the cause; this is the effect, asserted
    // separately because a future unstable dependency this harness does not
    // mock would still show up here.
    const h = makeHarness()
    await h.mount({})
    expect(mockGetQuizById).toHaveBeenCalledTimes(1)
    expect(mockGetQuestions).toHaveBeenCalledTimes(1)
  })

  it('the clock is FROZEN — nothing advances it but an explicit tick', async () => {
    // Cause 2, inverted. Under `shouldAdvanceTime` this fails, which is the
    // point: a helper that advances time to make a render settle can make a
    // deadline assertion pass on time no test asked for.
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const before = Date.now()
    const h = makeHarness()
    await h.mount({})
    await h.start('practice')
    expect(Date.now()).toBe(before)
    await h.tick(5_000)
    expect(Date.now()).toBe(before + 5_000)
  })

  it('ThemeProvider is load-bearing, not decoration', async () => {
    // Cause 3. If the started view stopped needing theme context this would
    // fail and the wrapper could go — which is the useful direction for a
    // self-check to fail in.
    vi.useFakeTimers()
    const view = render(<MemoryRouter><QuizRunnerV2 /></MemoryRouter>)
    await flush()
    const start = Array.from(view.container.querySelectorAll('button'))
      .find((b) => /Start/.test(b.textContent || ''))
    expect(start, 'the pre-quiz card renders without theme context').toBeTruthy()
    await expect(async () => {
      await act(async () => { fireEvent.click(start) })
    }).rejects.toThrow(/useTheme must be used inside ThemeProvider/)
  })

  it("start('exam') actually reaches exam mode — the picker takes two clicks", async () => {
    // Cause 4. The CTA reads "Start Practice" until the Exam tile is selected,
    // so a one-click harness ran every exam assertion in practice mode. That
    // is the failure a characterisation suite must never have: green, and
    // describing something other than what it names.
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const h = makeHarness()
    await h.mount({ quiz: { duration: 10 } })
    await h.start('exam')
    expect(h.lastSavedSession().mode).toBe('exam')
  })

  it('a rejected save is not counted as a submitted result', async () => {
    // The `mock.results` / `mock.settledResults` trap: for an async function a
    // rejection is recorded as a `return` of a rejected promise, so the
    // obvious reading reports a failed save as a successful submit — and the
    // retry assertion would pass without a retry ever happening.
    vi.useFakeTimers()
    const h = makeHarness()
    await h.mount({ failSubmitOnce: true })
    await h.start('practice')
    await h.openSubmit()
    await h.confirmSubmit()
    expect(mockSaveResult).toHaveBeenCalledTimes(1)
    expect(h.submitCount()).toBe(0)
    expect(h.submittedResult()).toBeNull()
  })
})

describeSessionContract('QuizRunnerV2', makeHarness)
