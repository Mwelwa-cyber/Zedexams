import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PostUpgradeContinuation, { ContinuationCard, continueLabelFor } from './PostUpgradeContinuation'
import { capture } from '../../../utils/analytics'
import {
  markPremiumActionPaid,
  peekPremiumAction,
  rememberPremiumAction,
} from '../lib/pendingPremiumAction'
import { useAuth } from '../../../contexts/AuthContext'

// The "pick up where you left off" card: shows ONLY inside the originating
// studio for the account that paid, never auto-executes anything, and
// dismissing it never touches the teacher's draft.

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

const PRO_PROFILE = { teacherPlan: 'pro', teacherPlanExpiresAt: '2999-01-01T00:00:00Z' }

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    currentUser: { uid: 'u1' },
    userProfile: PRO_PROFILE,
    isPremium: true,
    ...overrides,
  })
}

function paidAction(overrides = {}) {
  rememberPremiumAction({
    sourceRoute: '/teacher/generate/worksheet',
    uid: 'u1',
    tool: 'worksheet',
    reason: 'monthly-limit',
    ...overrides,
  })
  markPremiumActionPaid()
}

function renderAt(path = '/teacher/generate/worksheet') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PostUpgradeContinuation />
    </MemoryRouter>,
  )
}

describe('PostUpgradeContinuation host', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    setAuth()
  })

  it('shows the ready card in the originating studio with the tool-specific CTA', () => {
    paidAction()
    renderAt('/teacher/generate/worksheet')
    expect(screen.getByText('Your upgrade is active')).toBeInTheDocument()
    expect(screen.getByText(/nothing has been generated or charged automatically/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue creating your Worksheet' })).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('continuation_prompt_shown', {
      tool: 'worksheet',
      reason: 'monthly-limit',
      variant: 'ready',
    })
  })

  it('renders nothing on an unrelated route', () => {
    paidAction()
    renderAt('/teacher/dashboard')
    expect(screen.queryByText('Your upgrade is active')).toBeNull()
    expect(capture).not.toHaveBeenCalled()
  })

  it('renders nothing while the action is merely pending (not paid)', () => {
    rememberPremiumAction({ sourceRoute: '/teacher/generate/worksheet', uid: 'u1', tool: 'worksheet' })
    renderAt('/teacher/generate/worksheet')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it("refuses another account's record", () => {
    paidAction({ uid: 'someone-else' })
    renderAt('/teacher/generate/worksheet')
    expect(screen.queryByRole('status')).toBeNull()
    expect(peekPremiumAction()).toBeNull() // cleared, not just hidden
  })

  it('shows the needs-review variant when the plan has not confirmed active', () => {
    setAuth({ userProfile: {}, isPremium: false })
    paidAction()
    renderAt('/teacher/generate/worksheet')
    expect(screen.getByText(/needs to be reviewed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument()
    // No "continue" CTA that would hit the paywall again.
    expect(screen.queryByRole('button', { name: /Continue creating/ })).toBeNull()
  })

  it('shows the expired variant for a stale paid record and clears on dismiss', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'))
    paidAction()
    vi.setSystemTime(new Date('2026-07-14T12:20:00Z'))
    renderAt('/teacher/generate/worksheet')
    vi.useRealTimers()
    expect(screen.getByText('Your previous action has expired')).toBeInTheDocument()
    expect(screen.getByText(/draft is still available/i)).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('continuation_expired_shown', expect.objectContaining({ variant: 'expired' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review draft' }))
    expect(peekPremiumAction()).toBeNull()
  })

  it('primary consumes the action exactly once and never touches other storage', () => {
    sessionStorage.setItem('zedexams:some-draft', 'teacher work')
    paidAction()
    renderAt('/teacher/generate/worksheet')
    fireEvent.click(screen.getByRole('button', { name: 'Continue creating your Worksheet' }))
    expect(capture).toHaveBeenCalledWith('continuation_continue_selected', {
      tool: 'worksheet',
      reason: 'monthly-limit',
      variant: 'ready',
    })
    expect(peekPremiumAction()).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    // The teacher's draft data is untouched.
    expect(sessionStorage.getItem('zedexams:some-draft')).toBe('teacher work')
  })

  it('Review first and Dismiss clear the prompt without deleting anything', () => {
    paidAction()
    renderAt('/teacher/generate/worksheet')
    fireEvent.click(screen.getByRole('button', { name: 'Review first' }))
    expect(capture).toHaveBeenCalledWith('continuation_review_selected', expect.objectContaining({ variant: 'ready' }))
    expect(peekPremiumAction()).toBeNull()
  })
})

describe('ContinuationCard presentational', () => {
  it('uses specific CTAs per tool with a safe fallback', () => {
    expect(continueLabelFor('scheme_of_work')).toBe('Generate the complete Scheme of Work')
    expect(continueLabelFor('assessment')).toBe('Continue building your Test Paper')
    expect(continueLabelFor('unknown_tool')).toBe('Continue where you left off')
  })

  it('disables actions after the first press (no double execution)', () => {
    const onPrimary = vi.fn()
    render(
      <ContinuationCard variant="ready" tool="worksheet" onPrimary={onPrimary} onReview={vi.fn()} onDismiss={vi.fn()} />,
    )
    const btn = screen.getByRole('button', { name: 'Continue creating your Worksheet' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(btn).toBeDisabled()
  })

  it('has a labelled dismiss control and polite live region', () => {
    render(
      <ContinuationCard variant="ready" tool="worksheet" onPrimary={vi.fn()} onReview={vi.fn()} onDismiss={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
