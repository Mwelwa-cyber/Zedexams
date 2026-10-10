/**
 * The guarantees the contextual sheet exists to make.
 *
 *   1. It opens ONLY from a tap. Mounting the host renders nothing — not on
 *      first paint, not on a route change, not on sign-in.
 *   2. There is one sheet for everyone (the guardian-ask variant that mailed a
 *      Lenco link out of the Android app is gone). It lists Weekly and Monthly
 *      only; Day, Term and Exam stay in the catalogue but are not offered.
 *   3. On the web an under-18 learner gets the same ladder, worded so that a
 *      parent is the one who pays.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockProfile = { current: null }

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

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

// The checkout modal reaches Firebase; the sheet only needs to be observed
// handing off to it, so it is stubbed at the module boundary.
vi.mock('./UpgradeModal', () => ({ default: () => <div data-testid="checkout" /> }))

import { interruptionBudget, unlockSheet } from '../../../services/entitlements'
import UnlockSheetHost from './UnlockSheetHost'

function settleBudget() {
  // Clear the new-account grace and the app-open quiet period so a tapped lock
  // is not refused for a reason unrelated to what is under test.
  interruptionBudget.hydrate({
    sessions: 20,
    firstSeenAt: new Date(Date.now() - 30 * 864e5).toISOString(),
  })
}

beforeEach(() => {
  interruptionBudget.__reset()
  unlockSheet.close()
  mockProfile.current = { role: 'learner', isMinor: true }
})

afterEach(() => {
  unlockSheet.close()
  interruptionBudget.__reset()
})

describe('ACCEPTANCE 1 + 3 — nothing opens on its own', () => {
  it('renders no overlay on mount for an expired account', () => {
    mockProfile.current = {
      role: 'learner',
      isMinor: false,
      subscriptionPlan: 'monthly',
      subscriptionPaymentId: 'pay_1',
      // Well past the grace window: this is the account the deleted
      // interstitial used to greet with "Your Premium has ended".
      subscriptionExpiry: new Date(Date.now() - 60 * 864e5),
    }
    const { container } = render(<UnlockSheetHost />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing for a free learner either', () => {
    const { container } = render(<UnlockSheetHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens only once something calls unlockSheet.open', () => {
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({ gate: 'PAPER_OFFLINE', route: 'checkout', context: {} })
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('the sheet for an under-18 learner on the web', () => {
  function openCheckoutSheet() {
    settleBudget()
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({
        gate: 'PAPER_CONTINUE',
        route: 'checkout',
        context: { remaining: 40, paperYear: '2025' },
      })
    })
    return screen.getByRole('dialog')
  }

  it('shows Weekly and Monthly only, and says a parent pays with their own number', () => {
    mockProfile.current = { role: 'learner', isMinor: true }
    const dialog = openCheckoutSheet()
    expect(dialog.textContent).toMatch(/K15/)
    expect(dialog.textContent).toMatch(/K50/)
    expect(dialog.textContent).not.toMatch(/K120|K99|K5\b/)
    expect(dialog.textContent).toMatch(/A parent pays for this/i)
    expect(screen.getByRole('button', { name: /pay with a parent.s number/i })).toBeTruthy()
  })

  it('treats an unknown age the same way — it fails towards "a parent pays"', () => {
    mockProfile.current = { role: 'learner' }
    const dialog = openCheckoutSheet()
    expect(dialog.textContent).toMatch(/A parent pays for this/i)
  })

  it('hands off to the checkout when the CTA is tapped', async () => {
    mockProfile.current = { role: 'learner', isMinor: true }
    const user = userEvent.setup()
    openCheckoutSheet()
    await user.click(screen.getByRole('button', { name: /pay with a parent.s number/i }))
    expect(await screen.findByTestId('checkout')).toBeTruthy()
  })

  it('does not tell an adult to ask a parent', () => {
    mockProfile.current = { role: 'learner', isMinor: false }
    const dialog = openCheckoutSheet()
    expect(dialog.textContent).not.toMatch(/parent/i)
    expect(screen.getByRole('button', { name: /pay with mobile money/i })).toBeTruthy()
  })
})

describe('the adult variant', () => {
  it('highlights Monthly and offers a mobile-money CTA', () => {
    settleBudget()
    mockProfile.current = { role: 'learner', isMinor: false }
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({
        gate: 'PAPER_CONTINUE',
        route: 'checkout',
        context: { remaining: 40, paperYear: '2025' },
      })
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/K15/)
    expect(dialog.textContent).toMatch(/K50/)
    expect(dialog.textContent).not.toMatch(/BEST FOR EXAMS|K120/)
    expect(screen.getByRole('button', { name: /pay with mobile money/i })).toBeTruthy()
  })

  it('offers a real ✕ from the first frame, at the same weight as the CTA', () => {
    settleBudget()
    mockProfile.current = { role: 'learner', isMinor: false }
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({ gate: 'PAPER_OPEN', route: 'checkout', context: {} })
    })
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /not now/i })).toBeTruthy()
  })
})
