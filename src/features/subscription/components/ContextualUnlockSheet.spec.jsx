/**
 * The two guarantees the contextual sheet exists to make.
 *
 *   1. It opens ONLY from a tap. Mounting the host renders nothing — not on
 *      first paint, not on a route change, not on sign-in.
 *   2. An under-18 learner is never shown a price. Not "usually not", not
 *      "unless a flag is wrong": the rendered tree contains no `K<digit>` and
 *      no pay button, asserted here because the structural guarantee
 *      (GuardianAskSheet imports no pricing module) is only half of it.
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

const sendRequest = vi.fn(async () => ({ outcome: 'sent' }))
vi.mock('../../../services/entitlements/guardianRequest', () => ({
  GUARDIAN_REQUEST: { SENT: 'sent', RATE_LIMITED: 'rate_limited', NO_GUARDIAN: 'no_guardian', FAILED: 'failed' },
  requestGuardianUnlock: (...args) => sendRequest(...args),
}))

// The checkout modal reaches Firebase; the sheet only needs to be observed
// handing off to it, so it is stubbed at the module boundary.
vi.mock('./UpgradeModal', () => ({ default: () => <div data-testid="checkout" /> }))

import { interruptionBudget, unlockSheet } from '../../../services/entitlements'
import UnlockSheetHost from './UnlockSheetHost'

/** Everything a rendered tree must not contain for an under-18 learner. */
const PRICE_PATTERN = /K\s?\d/

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
  sendRequest.mockClear()
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
      unlockSheet.open({ gate: 'PAPER_OFFLINE', route: 'guardian', context: {} })
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('ACCEPTANCE 2 — an under-18 learner is never shown a price', () => {
  it('renders no price and no pay button in the guardian variant', () => {
    settleBudget()
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({
        gate: 'PAPER_CONTINUE',
        route: 'guardian',
        context: { remaining: 40, paperYear: '2025' },
      })
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toMatch(PRICE_PATTERN)
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /mtn|airtel/i })).toBeNull()
    // What it DOES offer.
    expect(screen.getByRole('button', { name: /send request/i })).toBeTruthy()
    expect(dialog.textContent).toMatch(/ask your guardian/i)
  })

  it('sends the request through the callable and reports the outcome', async () => {
    settleBudget()
    const user = userEvent.setup()
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({ gate: 'PAPER_OFFLINE', route: 'guardian', context: {} })
    })

    await user.click(screen.getByRole('button', { name: /send request/i }))
    expect(sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'PAPER_OFFLINE' }),
    )
    expect((await screen.findByRole('status')).textContent).toMatch(/sent to your guardian/i)
  })

  it('names the 3-day rule rather than reporting an error when rate limited', async () => {
    settleBudget()
    sendRequest.mockResolvedValueOnce({ outcome: 'rate_limited', retryAfterMs: 1000 })
    const user = userEvent.setup()
    render(<UnlockSheetHost />)
    act(() => {
      unlockSheet.open({ gate: 'PAPER_OFFLINE', route: 'guardian', context: {} })
    })
    await user.click(screen.getByRole('button', { name: /send request/i }))
    expect((await screen.findByRole('status')).textContent).toMatch(/every 3 days/i)
  })
})

describe('the adult variant', () => {
  it('shows the ladder with the Term Pass highlighted and a Lenco CTA', () => {
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
    expect(dialog.textContent).toMatch(/K120/)
    expect(dialog.textContent).toMatch(/BEST FOR EXAMS/)
    // The saving is computed from the ladder, never typed into the component.
    expect(dialog.textContent).toMatch(/Save K80 vs Monthly/)
    expect(screen.getByRole('button', { name: /pay with mtn \/ airtel/i })).toBeTruthy()
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
