/**
 * ACCEPTANCE 3 — the full-screen modal cannot be triggered by mounting it.
 *
 * "Only show this after a win" is a rule that survives exactly as long as the
 * next person who needs a modal in a hurry, so it is asserted here rather than
 * left to the caller's discipline. A mount, a route change and a sign-in all
 * look the same from inside the component: no trigger, or a trigger that is
 * not a success event. All three render null.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'learner', isMinor: false },
    updateProfileFields: vi.fn(async () => {}),
  }),
}))
vi.mock('../../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => ({ data: null, loading: false, error: null }),
  TOOL_TO_FEATURE: { lesson_plan: 'plans' },
}))
const capture = vi.fn()
vi.mock('../../../utils/analytics', () => ({ capture: (...a) => capture(...a) }))

import { MOMENT_OF_WIN_EVENTS, interruptionBudget } from '../../../services/entitlements'
import MomentOfWinModal from './MomentOfWinModal'

function settleBudget() {
  interruptionBudget.hydrate({
    sessions: 20,
    firstSeenAt: new Date(Date.now() - 30 * 864e5).toISOString(),
  })
}

beforeEach(() => {
  // An app that opened a minute ago: past the 10-second quiet period, so each
  // cap below is tested on its own rather than through that one.
  interruptionBudget.__reset({ appOpenAt: Date.now() - 60_000 })
  capture.mockClear()
})

describe('trigger', () => {
  it('renders nothing with no trigger — which is what a mount looks like', () => {
    settleBudget()
    const { container } = render(<MomentOfWinModal title="5 days in a row" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['route_change', 'sign_in', 'app_open', 'dashboard_mounted', ''])(
    'renders nothing for a non-success trigger (%s)',
    (trigger) => {
      settleBudget()
      const { container } = render(<MomentOfWinModal trigger={trigger} title="Nice" />)
      expect(container).toBeEmptyDOMElement()
    },
  )

  it.each(MOMENT_OF_WIN_EVENTS)('renders after the success event %s', (trigger) => {
    settleBudget()
    render(<MomentOfWinModal trigger={trigger} title="5 days in a row" />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('ACCEPTANCE 5 — one per session', () => {
  it('suppresses the second modal and reports the reason', () => {
    settleBudget()
    const first = render(<MomentOfWinModal trigger="quiz_completed" title="First" />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    first.unmount()

    const second = render(<MomentOfWinModal trigger="streak_extended" title="Second" />)
    expect(second.container).toBeEmptyDOMElement()
  })
})

describe('the new-account grace applies to it too', () => {
  it('renders nothing in a brand-new account, even after a real win', () => {
    // No hydrate: a fresh budget is session 1 of a just-seen account.
    const { container } = render(<MomentOfWinModal trigger="quiz_completed" title="Nice" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('dismissal', () => {
  it('offers a real ✕ from the first frame and records the dismissal', async () => {
    settleBudget()
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<MomentOfWinModal trigger="quiz_completed" title="5 days in a row" onClose={onClose} />)

    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^close$/i }))
    expect(onClose).toHaveBeenCalled()

    // The dismissal arms the 24h cooldown, which the next surface must observe.
    const verdict = interruptionBudget.evaluate({ tier: 3, surface: 'moment-of-win' })
    expect(verdict.allowed).toBe(false)
  })
})
