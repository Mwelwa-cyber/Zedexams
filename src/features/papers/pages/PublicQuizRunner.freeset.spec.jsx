/**
 * ACCEPTANCE 11 + 16 — the boundary itself, in the real runner.
 *
 * 11: completing the free set renders NO overlay. Answering the last free
 *     question mounts the results screen and mounts zero modal / sheet / toast
 *     nodes. This is the rule the whole design turns on: twenty questions of
 *     real work must never end in a wall with no score and no answers.
 *
 * 16: re-opening a paper whose free set is spent lands on the results screen —
 *     not on question 1 (which silently discards the work) and not on a
 *     paywall (which charges for feedback already earned).
 *
 * Deliberately exercised through `PublicQuizRunner` rather than through the
 * pieces: "nothing renders at the boundary" is a claim about the whole tree at
 * one moment, and a component test cannot make it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * A five-question free set on an eight-question paper. Five rather than three
 * so question 1 is genuinely OUTSIDE the meter's two-question window — with a
 * three-question set the meter is on from the first question and the "it does
 * not warn early" half of the test asserts nothing.
 */
const FREE_TO = 5
const TOTAL = 8

const QUESTIONS = Array.from({ length: TOTAL }, (_, i) => ({
  id: `q${i + 1}`,
  type: 'mcq',
  text: `Question number ${i + 1}?`,
  options: ['alpha', 'bravo', 'charlie', 'delta'],
  correctAnswer: 1,
  topic: i < FREE_TO ? 'grammar' : 'spelling',
}))

const PAPER = {
  id: 'paper-1',
  title: '2025 ECZ · English Paper 1',
  subject: 'english',
  grade: '7',
  year: 2025,
  quizId: 'quiz-1',
  quizStatus: 'attached',
  totalQuestions: TOTAL,
  sections: [
    { id: 'a1', label: 'Section A, Part 1', title: 'Grammar', from: 1, to: FREE_TO },
    { id: 'a2', label: 'Section A, Part 2', title: 'Spelling', from: FREE_TO + 1, to: TOTAL },
  ],
  freeSet: { toQuestion: FREE_TO, sectionId: 'a1' },
}

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null, updateProfileFields: vi.fn() }),
}))
vi.mock('../../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => ({ data: null, loading: false, error: null }),
  TOOL_TO_FEATURE: { lesson_plan: 'plans' },
}))
vi.mock('../../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => ({ engine: false, resolved: true, final: true, source: 'off', latched: false }),
}))
vi.mock('../../../utils/pastPaperLookup', () => ({
  getPaperById: vi.fn(async () => PAPER),
}))
vi.mock('../../../utils/quizSubjectIntegrity', () => ({
  validateQuizSubjectIntegrity: () => ({ ok: true, violations: [] }),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../hooks/useQuizDisplayPrefs', () => ({
  useQuizDisplayPrefs: () => ({
    prefs: {}, setPref: vi.fn(), resetPrefs: vi.fn(), displayVars: {}, saving: false,
  }),
}))
vi.mock('../../../hooks/useQuizReadAloud', () => ({
  useQuizReadAloud: () => ({ enabled: false, stop: vi.fn(), speak: vi.fn() }),
}))
vi.mock('../../../utils/pastPaperQuiz', async () => {
  const pure = await import('../../../utils/pastPaperQuizLoad')
  // The persistent free-preview tally, kept in a module-scope counter so the
  // test can observe it the way localStorage would carry it across a reload.
  const state = { answered: 0 }
  return {
    QUIZ_LOAD: pure.QUIZ_LOAD,
    QUIZ_LOAD_TEXT: pure.QUIZ_LOAD_TEXT,
    FREE_QUESTION_LIMIT: 30,
    loadPublicQuiz: vi.fn(async () => ({
      outcome: pure.QUIZ_LOAD.OK, denied: false, error: null,
      quiz: { id: 'quiz-1', title: 'English P1', subject: 'english', grade: '7' },
      questions: QUESTIONS,
    })),
    getAnsweredCount: () => state.answered,
    recordAnsweredQuestion: () => { state.answered += 1; return state.answered },
    resetCounter: () => { state.answered = 0 },
    hasReachedFreeLimit: () => false,
    __state: state,
  }
})

import PublicQuizRunner from './PublicQuizRunner'

function mountRunner() {
  return render(
    <MemoryRouter initialEntries={['/papers/paper-1/quiz']}>
      <Routes>
        <Route path="/papers/:paperId/quiz" element={<PublicQuizRunner />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Every kind of node that would count as "something rendered at the boundary". */
function overlayNodes(container) {
  return container.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="alert"], .fixed.inset-0',
  )
}

/**
 * Answer the current question. `correct: false` by default — the results
 * screen's most important element is the wrong-answer review, and a run with
 * nothing wrong in it would never render the thing under test.
 */
async function answer(user, container, { correct = false } = {}) {
  const label = correct ? /bravo/ : /alpha/
  const pick = [...container.querySelectorAll('button')].find((b) => label.test(b.textContent))
  await user.click(pick)
  await user.click(await screen.findByRole('button', { name: /check answer|check/i }))
}

beforeEach(async () => {
  localStorage.clear()
  const mod = await import('../../../utils/pastPaperQuiz')
  mod.__state.answered = 0
})

describe('ACCEPTANCE 11 — nothing renders at the free-set boundary', () => {
  it('answering the last free question mounts the results screen and zero overlays', async () => {
    const user = userEvent.setup()
    const { container } = mountRunner()
    await screen.findByText(/Question number 1\?/)

    // No overlay at any point during the run, including the question the meter
    // is warning about.
    for (let i = 0; i < FREE_TO; i += 1) {
      await answer(user, container)
      expect(overlayNodes(container)).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: /next question|see your score/i }))
      expect(overlayNodes(container)).toHaveLength(0)
    }

    // It went to the results screen — the same thing finishing any quiz does.
    await screen.findByText(/Section A, Part 1 done/i)
    expect(overlayNodes(container)).toHaveLength(0)
    // …carrying the score and the free review, not a bill.
    expect(screen.getByRole('img', { name: /you scored/i })).toBeTruthy()
    expect(container.textContent).not.toMatch(/free preview ended|upgrade to keep going/i)
  })

  it('warns inline from two questions out, with nothing to dismiss', async () => {
    const user = userEvent.setup()
    const { container } = mountRunner()
    await screen.findByText(/Question number 1\?/)

    expect(screen.queryByText(/left in your free set/i)).toBeNull()
    // Two questions in, i.e. two from the end of a five-question free set.
    for (let i = 0; i < 2; i += 1) {
      await answer(user, container)
      await user.click(screen.getByRole('button', { name: /next question/i }))
    }
    await screen.findByText(/Question number 3\?/)

    const meter = await screen.findByText(/left in your free set/i)
    expect(meter).toBeTruthy()
    // It is text. Its own line carries no control of any kind.
    const line = meter.closest('p')
    expect(line.querySelector('button')).toBeNull()
    expect(line.querySelector('a')).toBeNull()
  })
})

describe('ACCEPTANCE 16 — a spent paper re-opens on its results', () => {
  it('routes to the results screen, never to question 1 and never to a paywall', async () => {
    const user = userEvent.setup()
    const first = mountRunner()
    await screen.findByText(/Question number 1\?/)
    for (let i = 0; i < FREE_TO; i += 1) {
      await answer(user, first.container)
      await user.click(screen.getByRole('button', { name: /next question|see your score/i }))
    }
    await screen.findByText(/Section A, Part 1 done/i)
    first.unmount()

    // A fresh mount — what re-opening the paper does. The draft was written
    // before the results ever rendered, so it is already on disk.
    const second = mountRunner()
    await waitFor(() => expect(screen.getByRole('img', { name: /you scored/i })).toBeTruthy())
    expect(screen.queryByText(/Question number 1\?/)).toBeNull()
    expect(overlayNodes(second.container)).toHaveLength(0)
    // The review is right there, free, on a free account.
    expect(screen.getByRole('button', { name: /review the \d+ you got wrong/i })).toBeTruthy()
  })
})
