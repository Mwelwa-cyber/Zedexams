/**
 * The free-set continuation lock, wired into the LIVE results screen.
 *
 * Before this, `PaperContinueLock` was built and tested in isolation
 * (`FreeSetResults.spec.jsx`) against a results screen (`FreeSetResults`)
 * that nothing in the app actually rendered — `PaperQuizPage` uses this
 * component instead, and it had no entitlement awareness at all. A free
 * learner who ran out of free questions saw a plain score with no
 * explanation and no way to ask a guardian to unlock the rest. These tests
 * pin the fix at the seam that was actually missing.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const requestUnlock = vi.fn()
let mockIsUnder18 = true

// `useEntitlements`/`useUnlockFlow` are mocked below, but `importOriginal()`
// still evaluates the real module graph to build the rest of the exports —
// which reaches AuthContext and, through it, the Firebase config. Mock these
// two out from under it so that import never runs.
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null }),
}))
vi.mock('../../../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => ({ data: null, loading: false, error: null }),
  TOOL_TO_FEATURE: {},
}))

vi.mock('../../../../services/entitlements', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useUnlockFlow: () => ({
      requestUnlock,
      closeUnlock: vi.fn(),
      isUnder18: mockIsUnder18,
      route: mockIsUnder18 ? 'guardian' : 'checkout',
    }),
    useEntitlements: () => ({
      planState: {
        plan: 'free', status: 'active', role: 'learner', ageBand: mockIsUnder18 ? 'under18' : 'adult',
        unlocked: false, quotas: { papersThisWeek: 3 }, used: { papersThisWeek: 3 },
        resetsAt: { papersThisWeek: new Date(Date.now() + 3 * 864e5) },
      },
      isLocked: () => true,
      quotaLeft: () => 0,
      openPaper: () => ({ allowed: false, counted: false }),
      chipLabel: '0 left',
      chipTone: 'warn',
    }),
  }
})
vi.mock('../../../../utils/analytics', () => ({ capture: vi.fn() }))

import QuizResults from './QuizResults'
import { markPaper } from '../lib/attemptMarking'
import { QUIZ_MODE } from '../lib/quizModes'

const QUESTIONS = [
  { id: 'q1', n: 1, section: 'Grammar', text: 'Question one', options: ['a', 'an'], correctAnswer: 'A' },
  { id: 'q2', n: 2, section: 'Grammar', text: 'Question two', options: ['a', 'an'], correctAnswer: 'A' },
]
const ANSWERS = { q1: 0, q2: 0 } // both correct — the lock is about what's unseen, not the score

const FREE_SET = {
  toQuestion: 2,
  total: 32,
  remaining: 30,
  sectionLabel: 'Section A, Part 1',
  sectionTitle: 'Grammar',
  coversWholePaper: false,
  lockedSectionTitles: ['Spelling', 'Comprehension'],
}

function renderResults(props = {}) {
  const marked = markPaper({ questions: QUESTIONS, answers: ANSWERS })
  return render(
    <MemoryRouter>
      <QuizResults
        paper={{ id: 'p1', title: '2025 ECZ · English Paper 1', year: 2025 }}
        mode={QUIZ_MODE.PRACTICE}
        marked={marked}
        questions={QUESTIONS}
        timeUsedSec={120}
        flagCount={0}
        reason="completed"
        onFixup={vi.fn()}
        onRetry={vi.fn()}
        onDone={vi.fn()}
        onOpenNote={vi.fn()}
        onOpenGame={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('the free-set lock on the live results screen', () => {
  it('tells a free learner more questions exist and offers to ask their guardian', () => {
    mockIsUnder18 = true
    renderResults({ freeSet: FREE_SET, unlocked: false })
    expect(screen.getByText(/30 more questions in this paper/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /ask your guardian to unlock/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /try this free section again/i })).toBeTruthy()
  })

  it('quotes a price to an adult instead of the guardian ask', () => {
    mockIsUnder18 = false
    renderResults({ freeSet: FREE_SET, unlocked: false })
    expect(screen.getByRole('button', { name: /unlock — from k/i })).toBeTruthy()
  })

  it('shows no lock for an unlocked (paid) learner', () => {
    renderResults({ freeSet: FREE_SET, unlocked: true })
    expect(screen.queryByText(/more questions in this paper/i)).toBeNull()
    expect(screen.getByRole('button', { name: /try the whole paper again/i })).toBeTruthy()
  })

  it('shows no lock in exam mode even if the free set has remaining questions', () => {
    renderResults({ mode: QUIZ_MODE.EXAM, freeSet: FREE_SET, unlocked: false })
    expect(screen.queryByText(/more questions in this paper/i)).toBeNull()
  })

  it('shows no lock when the free set covers the whole paper', () => {
    renderResults({ freeSet: { ...FREE_SET, remaining: 0, coversWholePaper: true }, unlocked: false })
    expect(screen.queryByText(/more questions in this paper/i)).toBeNull()
  })
})
