/**
 * The free-set results screen — the single most important rule in the design.
 *
 * ACCEPTANCE 12: the free set's own results are NEVER gated. On `plan: 'free'`
 * the screen renders the score, the full wrong-answer review with the correct
 * answers, and the weak topic, and the review is reachable and unblurred.
 * Charging for feedback on work already done earns one refusal and costs the
 * habit — the review screen is why the learner opens the app tomorrow.
 *
 * ACCEPTANCE 15: `PaperContinueLock` always states its reset date. A missing
 * `resetsAt` renders NO LOCK rather than a bare one, which this asserts
 * directly, because a lock that will not say when it lifts reads as extortion.
 *
 * ACCEPTANCE 10: the lock stays tappable — no `pointer-events:none`, no
 * `disabled`, no conditional removal from the tree.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mockProfile = { current: { role: 'learner', isMinor: true } }
const planStateOverride = { current: null }

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: mockProfile.current,
    updateProfileFields: vi.fn(async () => {}),
  }),
}))
vi.mock('../../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => ({ data: null, loading: false, error: null }),
  TOOL_TO_FEATURE: { lesson_plan: 'plans' },
}))
const capture = vi.fn()
vi.mock('../../../utils/analytics', () => ({ capture: (...a) => capture(...a) }))

const requestUnlock = vi.fn()
vi.mock('../../../services/entitlements', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useUnlockFlow: () => ({
      requestUnlock,
      closeUnlock: vi.fn(),
      isUnder18: mockProfile.current?.isMinor !== false,
      route: mockProfile.current?.isMinor === false ? 'checkout' : 'guardian',
    }),
    useEntitlements: () => ({
      planState: planStateOverride.current || {
        plan: 'free',
        status: 'active',
        role: 'learner',
        ageBand: 'under18',
        unlocked: false,
        quotas: { papersThisWeek: 3 },
        used: { papersThisWeek: 3 },
        // A Monday, five days after the "now" the format helper compares to.
        resetsAt: { papersThisWeek: new Date(Date.now() + 5 * 864e5) },
      },
      isLocked: () => true,
      quotaLeft: () => 0,
      openPaper: () => ({ allowed: false, counted: false }),
      chipLabel: '0 left',
      chipTone: 'warn',
    }),
  }
})

import FreeSetResults from './FreeSetResults'
import FreeSetReview from './FreeSetReview'

const PAPER = { id: 'p1', title: '2025 ECZ · English Paper 1', year: 2025 }
const FREE_SET = {
  toQuestion: 20,
  total: 60,
  remaining: 40,
  sectionLabel: 'Section A, Part 1',
  sectionTitle: 'Grammar & sentence completion',
  coversWholePaper: false,
  lockedSectionTitles: ['Spelling', 'Punctuation', 'Word meaning'],
}

function renderResults(props = {}) {
  return render(
    <MemoryRouter>
      <FreeSetResults
        paper={PAPER}
        freeSet={FREE_SET}
        score={14}
        outOf={20}
        wrongCount={6}
        weakTopic={{ topic: 'sentence completion', detail: '4 of your 6 misses were joining words' }}
        onReview={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockProfile.current = { role: 'learner', isMinor: true }
  planStateOverride.current = null
  capture.mockClear()
  requestUnlock.mockClear()
})

describe('ACCEPTANCE 12 — the free set’s own results are never gated', () => {
  it('renders the score, the review entry point and the weak topic on plan: free', () => {
    renderResults()
    expect(screen.getByRole('img', { name: /you scored 14 out of 20/i })).toBeTruthy()
    expect(screen.getByText(/Section A, Part 1 done/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /review the 6 you got wrong/i })).toBeTruthy()
    expect(screen.getByText(/work on: sentence completion/i)).toBeTruthy()
  })

  it('the review button is enabled and unblurred — nothing gates it', () => {
    renderResults()
    const review = screen.getByRole('button', { name: /review the 6 you got wrong/i })
    expect(review.hasAttribute('disabled')).toBe(false)
    const style = window.getComputedStyle(review)
    expect(style.pointerEvents).not.toBe('none')
    expect(review.className).not.toMatch(/blur/)
  })

  it('opening the review reports it, because it is the funnel step to watch', async () => {
    const user = userEvent.setup()
    const onReview = vi.fn()
    renderResults({ onReview })
    await user.click(screen.getByRole('button', { name: /review the 6 you got wrong/i }))
    expect(onReview).toHaveBeenCalled()
    expect(capture).toHaveBeenCalledWith('results_review_opened', {
      paper_id: 'p1', wrong_count: 6,
    })
  })

  it('the review itself shows every wrong answer WITH the correct one', () => {
    render(
      <FreeSetReview
        answers={[
          { questionId: 'q1', order: 0, selectedIndex: 0, correctIndex: 1, correct: false },
          { questionId: 'q2', order: 1, selectedIndex: 1, correctIndex: 1, correct: true },
        ]}
        questions={[
          { id: 'q1', text: 'She was tired, ___ she finished her homework.', options: ['because', 'but', 'so', 'unless'], explanation: '"But" joins two contrasting ideas.' },
          { id: 'q2', text: 'Another question', options: ['a', 'b'] },
        ]}
        onBack={vi.fn()}
      />,
    )
    // `.closest('p')` because the label and the value are separate nodes —
    // the assertion is about what the learner reads on that line, not about
    // which span happens to carry the text.
    expect(screen.getByText(/you chose:/i).closest('p').textContent).toMatch(/because/)
    expect(screen.getByText(/correct answer:/i).closest('p').textContent).toMatch(/but/)
    expect(screen.getByText(/joins two contrasting ideas/i)).toBeTruthy()
    // Only the wrong one is listed — the correct answer needs no review.
    expect(screen.queryByText(/Another question/)).toBeNull()
  })
})

describe('ACCEPTANCE 15 — the lock always states its reset date', () => {
  it('renders the reset date derived from resetsAt', () => {
    renderResults()
    expect(screen.getByText(/your next free set unlocks on/i)).toBeTruthy()
  })

  it('renders NO lock at all when resetsAt is missing', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    planStateOverride.current = {
      plan: 'free', status: 'active', role: 'learner', ageBand: 'under18',
      unlocked: false, quotas: { papersThisWeek: 3 }, used: { papersThisWeek: 3 },
      resetsAt: {},
    }
    renderResults()
    // The offer is gone — not a lock with no way out.
    expect(screen.queryByText(/40 more questions/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /unlock/i })).toBeNull()
    // The score and review survive: the results screen is never the casualty.
    expect(screen.getByRole('button', { name: /review the 6 you got wrong/i })).toBeTruthy()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('ACCEPTANCE 10 — the lock is rendered and tappable', () => {
  it('routes an under-18 learner to the guardian, with no price on screen', async () => {
    const user = userEvent.setup()
    renderResults()
    const cta = screen.getByRole('button', { name: /ask your guardian to unlock/i })
    expect(cta.hasAttribute('disabled')).toBe(false)
    expect(window.getComputedStyle(cta).pointerEvents).not.toBe('none')
    // No figure anywhere on the results screen for a child.
    expect(screen.getByText(/40 more questions/i).closest('section').textContent)
      .not.toMatch(/K\s?\d/)

    await user.click(cta)
    expect(requestUnlock).toHaveBeenCalledWith('PAPER_CONTINUE', expect.objectContaining({
      paperId: 'p1', remaining: 40,
    }))
    expect(capture).toHaveBeenCalledWith('paper_continue_lock_tapped', {
      paper_id: 'p1', remaining: 40, route: 'guardian',
    })
  })

  it('quotes the cheapest rung to an adult instead', () => {
    mockProfile.current = { role: 'learner', isMinor: false }
    renderResults()
    expect(screen.getByRole('button', { name: /unlock — from K5/i })).toBeTruthy()
  })

  it('"Not now" keeps the learner on the results screen with the review intact', async () => {
    const user = userEvent.setup()
    const onDismissLock = vi.fn()
    renderResults({ onDismissLock })
    await user.click(screen.getByRole('button', { name: /not now/i }))
    expect(onDismissLock).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /review the 6 you got wrong/i })).toBeTruthy()
  })

  it('a paid learner sees no lock at all', () => {
    renderResults({ unlocked: true })
    expect(screen.queryByText(/40 more questions/i)).toBeNull()
    expect(screen.getByRole('button', { name: /review the 6 you got wrong/i })).toBeTruthy()
  })
})
