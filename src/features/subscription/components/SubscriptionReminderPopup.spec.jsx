/**
 * Behaviour tests for SubscriptionReminderPopup — the "Welcome Back" upgrade
 * nudge that self-opens ~900ms after the dashboard paints.
 *
 * These pin the anti-nag rules that keep the first-run experience calm:
 *   - it shows for an eligible (non-new, non-snoozed) free user,
 *   - it never fires on top of another upgrade modal (paywall / lockedFeature
 *     bus active) — one modal at a time,
 *   - a deferred show is NOT burned: it can still appear later in the session
 *     once the other modal is gone,
 *   - eligibility (incl. the new-account guard) lives in
 *     useSubscriptionReminder, mocked here and tested in its own spec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let mockUserProfile = { role: 'learner' }
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: mockUserProfile }),
}))

let mockReminder
vi.mock('../../../hooks/useSubscriptionReminder', () => ({
  useSubscriptionReminder: () => mockReminder,
}))

let mockPathname = '/dashboard'
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}))

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => false }))

// Visual leaves — light stubs; the popup's own chrome is what we assert on.
vi.mock('./PremiumUpgradeUI', () => ({
  BenefitPills: () => null,
  PlanPricingCards: () => null,
  TrustRow: () => null,
  LEARNER_PILLS: [],
  TEACHER_PILLS: [],
}))
vi.mock('./UpgradeModal', () => ({ default: () => null }))

import { paywall } from '../../../utils/paywall'
import { lockedFeature } from '../lib/lockedFeature'
import SubscriptionReminderPopup from './SubscriptionReminderPopup'

function eligibleReminder() {
  return {
    status: 'free',
    audience: 'learner',
    popupEligible: true,
    snoozeReminders: vi.fn(),
    recordReminderShown: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  sessionStorage.clear()
  mockUserProfile = { role: 'learner' }
  mockPathname = '/dashboard'
  mockReminder = eligibleReminder()
  paywall.hide()
  lockedFeature.hide()
})

afterEach(() => {
  vi.useRealTimers()
  paywall.hide()
  lockedFeature.hide()
})

describe('SubscriptionReminderPopup — show timing', () => {
  it('opens ~900ms after paint for an eligible free user', () => {
    render(<SubscriptionReminderPopup />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockReminder.recordReminderShown).toHaveBeenCalledTimes(1)
  })

  it('never opens when the hook says not eligible (new account / snoozed / Pro)', () => {
    mockReminder = { ...eligibleReminder(), popupEligible: false }
    render(<SubscriptionReminderPopup />)
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('SubscriptionReminderPopup — one modal at a time', () => {
  it('stays quiet while a paywall modal is already open', () => {
    paywall.show('quiz-preview-limit', {})
    render(<SubscriptionReminderPopup />)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockReminder.recordReminderShown).not.toHaveBeenCalled()
  })

  it('stays quiet while a locked-feature modal is already open', () => {
    lockedFeature.show({ feature: 'Exam mode' })
    render(<SubscriptionReminderPopup />)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a deferred show is not burned — it can still appear later in the session', () => {
    paywall.show('quiz-preview-limit', {})
    const { rerender } = render(<SubscriptionReminderPopup />)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The other modal closes, and the learner navigates — the effect re-runs
    // on pathname change and this time nothing blocks the popup.
    paywall.hide()
    mockPathname = '/quizzes'
    rerender(<SubscriptionReminderPopup />)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
