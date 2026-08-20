/**
 * The runner, and the three guarantees §1 makes about it.
 *
 *   1. **Exam mode reveals nothing.** No tick, no colour, no score, until
 *      submit. The runner is handed stripped questions, so this is really a
 *      test that it never tries to resolve a key it does not have.
 *   2. **The clock is derived from `expiresAt`, never counted down.** A phone
 *      that slept for twenty minutes wakes to a clock twenty minutes shorter.
 *   3. **Only the exit sheet ends an exam.** Tapping back opens a sheet with
 *      three ways out; nothing about that tap voids anything.
 *
 * The clock is driven with a FROZEN, MOVED clock rather than a mocked timer
 * module, because the bug being guarded against is the runner keeping its own
 * counter — and a stubbed counter would agree with the expectation while the
 * real one drifted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import QuizRunner from './QuizRunner'
import { QUIZ_MODE } from '../lib/quizModes'

const QUESTIONS = [
  { id: 'q1', n: 1, section: 'Grammar', text: 'Mutinta bought ..... umbrella.', options: ['a', 'an'], correctAnswer: 'B' },
  { id: 'q2', n: 2, section: 'Grammar', text: 'The pupils waited ..... the stop.', options: ['in', 'at'], correctAnswer: 'B' },
]
/** What an exam is actually served: no key, no prose (functions strip it). */
const STRIPPED = QUESTIONS.map(({ correctAnswer, ...rest }) => rest)

function renderRunner(overrides = {}) {
  const props = {
    mode: QUIZ_MODE.EXAM,
    questions: STRIPPED,
    attempt: { attemptId: 'a1', expiresAtMs: Date.now() + 90 * 60_000 },
    clockOffsetMs: 0,
    answers: {},
    flags: {},
    revealed: {},
    strictForward: false,
    currentIndex: 0,
    resumed: false,
    readAloud: { enabled: false },
    submitting: false,
    onChoose: vi.fn(() => false),
    onNavigate: vi.fn(),
    onToggleFlag: vi.fn(),
    onSubmit: vi.fn(),
    onAbandon: vi.fn(),
    onSwitchToPractice: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  }
  render(<MemoryRouter><QuizRunner {...props} /></MemoryRouter>)
  return props
}

describe('QuizRunner — exam mode', () => {
  it('reveals nothing: no tick, no colour, no score', () => {
    renderRunner({ answers: { q1: 0 } })
    // The chosen option is marked as chosen — that is a selection, not a
    // verdict — and no option carries a correct/wrong class.
    expect(document.querySelector('.pq-opt.is-chosen')).toBeTruthy()
    expect(document.querySelector('.pq-opt.is-correct')).toBeNull()
    expect(document.querySelector('.pq-opt.is-wrong')).toBeNull()
    expect(screen.queryByText(/Score/i)).not.toBeInTheDocument()
    expect(document.querySelector('.pq-coach')).toBeNull()
  })

  it('offers the flag and the review grid; practice does not', async () => {
    const props = renderRunner()
    await userEvent.click(screen.getByRole('button', { name: /^Flag$/ }))
    expect(props.onToggleFlag).toHaveBeenCalledWith('q1')
    expect(screen.getByRole('button', { name: /Review all questions/ })).toBeInTheDocument()
  })

  it('the exit tap opens a sheet with three ways out — it never voids on its own', async () => {
    const props = renderRunner({ answers: { q1: 0 } })
    await userEvent.click(screen.getByRole('button', { name: /Leave the exam/ }))
    expect(props.onAbandon).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Stay in the exam/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch to practice instead/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Leave — don't count this/ })).toBeInTheDocument()
    // And it says what leaving costs, in questions rather than in the abstract.
    // Scoped to the sheet: "Question 1 of 2" in the runner behind it matches
    // the same text, and an ambiguous matcher would pass on the wrong element.
    const sheet = screen.getByRole('dialog', { name: /Leave the exam/ })
    expect(sheet.textContent).toMatch(/You have answered\s*1 of 2\s*questions/)
  })

  it('only the exit sheet\'s own button abandons', async () => {
    const props = renderRunner()
    await userEvent.click(screen.getByRole('button', { name: /Leave the exam/ }))
    await userEvent.click(screen.getByRole('button', { name: /Leave — don't count this/ }))
    expect(props.onAbandon).toHaveBeenCalledTimes(1)
  })

  it('the submit sheet counts blanks and always makes the guess argument', async () => {
    renderRunner({ currentIndex: 1, answers: { q2: 0 } })
    await userEvent.click(screen.getByRole('button', { name: /Finish and submit/ }))
    expect(screen.getByText(/1 question is still blank/)).toBeInTheDocument()
    expect(screen.getByText(/a guess costs you nothing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go to the first blank one/ })).toBeInTheDocument()
  })

  it('strictForward removes the back step and nothing else', () => {
    renderRunner({ currentIndex: 1, strictForward: true })
    expect(screen.queryByRole('button', { name: /^Back$/ })).not.toBeInTheDocument()
    // The paper is not shortened: question 2 of 2 still offers the finish.
    expect(screen.getByRole('button', { name: /Finish and submit/ })).toBeInTheDocument()
  })
})

describe('QuizRunner — the clock', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers() })

  it('is derived from expiresAt, so time while the app was shut is time spent', () => {
    const start = new Date('2026-08-20T10:00:00Z').getTime()
    vi.setSystemTime(start)
    renderRunner({ attempt: { attemptId: 'a1', expiresAtMs: start + 90 * 60_000 } })
    expect(screen.getByRole('timer')).toHaveTextContent('90:00')

    // The phone slept for twenty minutes. A counted-down clock would resume at
    // 90:00 or at 89:59; a derived one has lost the twenty minutes, because
    // that is what happened.
    act(() => { vi.setSystemTime(start + 20 * 60_000); vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('timer')).toHaveTextContent('69:5')
  })

  it('turns amber at ten minutes and red at five, and never earlier', () => {
    const start = new Date('2026-08-20T10:00:00Z').getTime()
    vi.setSystemTime(start)
    renderRunner({ attempt: { attemptId: 'a1', expiresAtMs: start + 11 * 60_000 } })
    expect(document.querySelector('.pq-timer')).not.toHaveClass('is-warn')

    act(() => { vi.setSystemTime(start + 60_000 + 500); vi.advanceTimersByTime(1000) })
    expect(document.querySelector('.pq-timer')).toHaveClass('is-warn')

    act(() => { vi.setSystemTime(start + 6 * 60_000 + 500); vi.advanceTimersByTime(1000) })
    expect(document.querySelector('.pq-timer')).toHaveClass('is-danger')
  })

  it('auto-submits when the clock runs out, once', () => {
    const start = new Date('2026-08-20T10:00:00Z').getTime()
    vi.setSystemTime(start)
    const props = renderRunner({ attempt: { attemptId: 'a1', expiresAtMs: start + 2000 } })
    act(() => { vi.setSystemTime(start + 3000); vi.advanceTimersByTime(1000) })
    expect(props.onSubmit).toHaveBeenCalledWith({ reason: 'timeup' })
    // A second tick must not fire a second submission.
    act(() => { vi.advanceTimersByTime(3000) })
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('practice has no clock at all', () => {
    renderRunner({ mode: QUIZ_MODE.PRACTICE, attempt: null })
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByText('Practice')).toBeInTheDocument()
  })
})

describe('QuizRunner — practice mode', () => {
  it('waits for a tap rather than offering a Next button', () => {
    renderRunner({ mode: QUIZ_MODE.PRACTICE, attempt: null, questions: QUESTIONS })
    expect(screen.getByText('Tap the answer you think is right')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Next$/ })).not.toBeInTheDocument()
  })

  it('reveals the verdict and the coaching once answered', () => {
    renderRunner({
      mode: QUIZ_MODE.PRACTICE,
      attempt: null,
      questions: QUESTIONS.map((q) => ({ ...q, explanationStatus: 'approved', why: 'Vowel sound.' })),
      answers: { q1: 0 },
      revealed: { q1: true },
    })
    expect(document.querySelector('.pq-opt.is-correct')).toBeTruthy()
    expect(document.querySelector('.pq-opt.is-wrong')).toBeTruthy()
    expect(screen.getByText('Vowel sound.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeInTheDocument()
  })

  it('offers no flag, no review grid and no exit sheet', async () => {
    const props = renderRunner({ mode: QUIZ_MODE.PRACTICE, attempt: null, questions: QUESTIONS })
    expect(screen.queryByRole('button', { name: /^Flag$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Review all questions/ })).not.toBeInTheDocument()
    // Leaving practice is free (§1) — no warning, no void.
    await userEvent.click(screen.getByRole('button', { name: /Leave practice/ }))
    expect(props.onExit).toHaveBeenCalled()
    expect(props.onAbandon).not.toHaveBeenCalled()
  })
})
