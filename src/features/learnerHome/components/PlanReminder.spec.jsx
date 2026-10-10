/**
 * PlanReminder — the learner shell's own plan reminder.
 *
 * The bug it answers: the app-root strip was painted over by the shell's fixed
 * sidebar, so a learner read half a sentence. jsdom cannot measure that, so the
 * guarantees pinned here are the structural ones that make it impossible: the
 * card is rendered INSIDE the shell's page column (not beside it), it claims
 * the slot so the root strips stand down, and the cadence is daily.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let mockAuth
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
let mockPlan
vi.mock('../../../services/entitlements', async (importOriginal) => ({
  ...(await importOriginal()),
  useEntitlements: () => ({ planState: mockPlan }),
}))
let mockReminder
vi.mock('../../../hooks/useSubscriptionReminder', () => ({
  useSubscriptionReminder: () => mockReminder,
}))

import PlanReminder, { DISMISS_KEY, localDayKey, resolvePlanReminder } from './PlanReminder'
import LearnerShell from './LearnerShell'
import { isReminderHostClaimed } from '../../../shared/utils/reminderHost'
import { PLAN_STATUS } from '../../../services/entitlements'
import { SUB_STATUS } from '../../../engines/payment-engine/subscriptionStatus'

const LEARNER = { id: 'u1', role: 'learner', isMinor: false }

function renderAt(path, ui = <PlanReminder />) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
        <Route path="/my-subscription" element={<div>MY SUBSCRIPTION</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockAuth = { currentUser: { uid: 'u1' }, userProfile: LEARNER }
  mockPlan = { status: PLAN_STATUS.EXPIRED }
  mockReminder = { status: SUB_STATUS.EXPIRED, shouldRemind: true, isExpired: true }
})
afterEach(() => { vi.useRealTimers() })

describe('resolvePlanReminder — which reminder, if any', () => {
  const now = new Date('2026-10-10T10:00:00Z').getTime()

  it('grace beats everything and says how many days are left', () => {
    const r = resolvePlanReminder({
      planStatus: PLAN_STATUS.GRACE,
      graceEndsAt: new Date(now + 2 * 24 * 3600 * 1000),
      subStatus: SUB_STATUS.EXPIRED, shouldRemind: true, now,
    })
    expect(r.tone).toBe('grace')
    expect(r.sub).toMatch(/2 days of access left/)
  })

  it('says "1 day", not "1 days"', () => {
    const r = resolvePlanReminder({
      planStatus: PLAN_STATUS.GRACE, graceEndsAt: new Date(now + 3600 * 1000),
      subStatus: SUB_STATUS.EXPIRED, shouldRemind: true, now,
    })
    expect(r.sub).toMatch(/1 day of access/)
  })

  it('expired is its own, firmer state', () => {
    const r = resolvePlanReminder({ planStatus: PLAN_STATUS.EXPIRED, subStatus: SUB_STATUS.EXPIRED, shouldRemind: true, now })
    expect(r.tone).toBe('expired')
    expect(r.title).toMatch(/expired/i)
  })

  it('free is the quietest, and a paying account sees nothing', () => {
    expect(resolvePlanReminder({ planStatus: PLAN_STATUS.FREE, subStatus: SUB_STATUS.FREE, shouldRemind: true, now }).tone).toBe('free')
    expect(resolvePlanReminder({ planStatus: PLAN_STATUS.PAID, subStatus: SUB_STATUS.PRO, shouldRemind: false, now })).toBeNull()
  })

  it('never prints a Kwacha figure in any state (Android may not, web shows it a tap later)', () => {
    for (const args of [
      { planStatus: PLAN_STATUS.GRACE, graceEndsAt: new Date(now + 86400000), subStatus: SUB_STATUS.EXPIRED, shouldRemind: true },
      { planStatus: PLAN_STATUS.EXPIRED, subStatus: SUB_STATUS.EXPIRED, shouldRemind: true },
      { planStatus: PLAN_STATUS.FREE, subStatus: SUB_STATUS.FREE, shouldRemind: true },
    ]) {
      const r = resolvePlanReminder({ ...args, now })
      expect(`${r.title} ${r.sub} ${r.cta}`).not.toMatch(/\bK\s?\d|ZMW|US\$/)
    }
  })
})

describe('PlanReminder', () => {
  it('shows the expired card and Renew goes to My Subscription', () => {
    renderAt('/dashboard')
    expect(screen.getByText(/Your plan has expired/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }))
    expect(screen.getByText('MY SUBSCRIPTION')).toBeInTheDocument()
  })

  it('hides until tomorrow when closed, and returns the next day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 10, 9, 0, 0))
    const { unmount } = renderAt('/dashboard')
    fireEvent.click(screen.getByRole('button', { name: /Hide until tomorrow/i }))
    expect(screen.queryByText(/Your plan has expired/i)).toBeNull()
    expect(localStorage.getItem(DISMISS_KEY)).toBe(localDayKey(new Date(2026, 9, 10)))
    unmount()

    // Same day, fresh mount: still hidden.
    renderAt('/dashboard')
    expect(screen.queryByText(/Your plan has expired/i)).toBeNull()
  })

  it('comes back the next calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 10, 23, 30, 0))
    localStorage.setItem(DISMISS_KEY, localDayKey(new Date(2026, 9, 10)))
    vi.setSystemTime(new Date(2026, 9, 11, 0, 5, 0))
    renderAt('/dashboard')
    expect(screen.getByText(/Your plan has expired/i)).toBeInTheDocument()
  })

  it('stays quiet on immersive and marketing routes, and for a signed-out visitor', () => {
    renderAt('/quiz/abc')
    expect(screen.queryByText(/Your plan has expired/i)).toBeNull()
  })

  it('renders nothing without a profile', () => {
    mockAuth = { currentUser: null, userProfile: null }
    renderAt('/dashboard')
    expect(screen.queryByText(/plan/i)).toBeNull()
  })

  it('renders nothing for a paying account', () => {
    mockPlan = { status: PLAN_STATUS.PAID }
    mockReminder = { status: SUB_STATUS.PRO, shouldRemind: false, isExpired: false }
    renderAt('/dashboard')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('claims the reminder slot while mounted — even when it has nothing to show — and releases it', () => {
    mockPlan = { status: PLAN_STATUS.PAID }
    mockReminder = { status: SUB_STATUS.PRO, shouldRemind: false, isExpired: false }
    const { unmount } = renderAt('/dashboard')
    expect(isReminderHostClaimed()).toBe(true)
    unmount()
    expect(isReminderHostClaimed()).toBe(false)
  })
})

describe('in the learner shell', () => {
  it('is drawn INSIDE the page column — the place the sidebar and top bar cannot cover', () => {
    const { container } = renderAt('/dashboard', <LearnerShell><p>page</p></LearnerShell>)
    const card = container.querySelector('.lhx-plan-reminder')
    expect(card).not.toBeNull()
    expect(card.closest('.lhx-page')).not.toBeNull()
    // And not inside the fixed navigation.
    expect(card.closest('.lhx-nav')).toBeNull()
  })
})
