/**
 * Behaviour tests for SubscriptionStatusBanner.jsx — the "Free Plan" /
 * "Expired Subscription" strip pinned under the app banners.
 *
 * Regression guard for the mobile horizontal-overflow bug: the banner's
 * flex-1 row button lacked `min-w-0`, so on phones the nested flex row could
 * not shrink below its content width (status pill + full message). The row
 * pushed the dismiss ✕ past the viewport edge, widening the document —
 * which made every learner page horizontally scrollable AND dragged the
 * right-anchored fixed elements (the bottom nav) off-screen
 * on Android Chrome. jsdom can't measure layout, so the tests pin the two
 * CSS facts that make the row shrinkable: `min-w-0` on the flex-1 button
 * and `truncate` on the message span.
 *
 * It also pins the age rule: an under-18 learner is never shown a price, a
 * plan name or a route to the checkout. The default profile in these tests
 * is therefore an ADULT learner (`isMinor: false`) — `resolveAgeBand` fails
 * closed, so a bare `{ role: 'learner' }` is a child and would get the
 * ask-a-grown-up strip instead of the priced one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const ADULT = { id: 'learner-1', role: 'learner', isMinor: false }
const CHILD = { id: 'learner-2', role: 'learner' }

let mockAuth = { userProfile: ADULT }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))



let mockReminder = { status: 'expired', shouldRemind: true, isExpired: true }
vi.mock('../../../hooks/useSubscriptionReminder', () => ({
  useSubscriptionReminder: () => mockReminder,
}))

import SubscriptionStatusBanner from './SubscriptionStatusBanner'

function renderBanner(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SubscriptionStatusBanner />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockAuth = { userProfile: ADULT }
  mockReminder = { status: 'expired', shouldRemind: true, isExpired: true }
})

describe('SubscriptionStatusBanner', () => {
  it('shows the expired strip for an expired subscription', () => {
    renderBanner()
    expect(screen.getByText('Expired Subscription')).toBeInTheDocument()
    expect(screen.getByText(/Renew to restore/i)).toBeInTheDocument()
  })

  it('keeps the row shrinkable on narrow phones (min-w-0 + truncate)', () => {
    renderBanner()
    // The flex-1 row button must be allowed to shrink below its content
    // width, and the message span must truncate — together these stop the
    // banner from widening the document on mobile (the horizontal-scroll /
    // off-screen Ask-Zed bug).
    const row = screen.getByText(/Renew to restore/i).closest('button')
    expect(row.className).toMatch(/\bmin-w-0\b/)
    expect(row.className).toMatch(/\bflex-1\b/)
    const message = screen.getByText(/Renew to restore/i)
    expect(message.className).toMatch(/\btruncate\b/)
  })

  it('renders nothing when there is no reason to remind', () => {
    mockReminder = { status: 'active', shouldRemind: false, isExpired: false }
    const { container } = renderBanner()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on suppressed paths (e.g. the exam runner)', () => {
    const { container } = renderBanner('/exam/abc123')
    expect(container).toBeEmptyDOMElement()
  })

  describe('an under-18 learner', () => {
    beforeEach(() => { mockAuth = { userProfile: CHILD } })

    it('is never shown a price, a plan name or the checkout', () => {
      mockReminder = { status: 'free', shouldRemind: true, isExpired: false }
      renderBanner()
      // No "Pro" (a teacher tier), no "Free Plan", no "Upgrade →", and no
      // kwacha figure anywhere in the rendered strip.
      expect(screen.queryByText(/Pro\b/)).toBeNull()
      expect(screen.queryByText('Free Plan')).toBeNull()
      expect(screen.queryByText(/Upgrade →/)).toBeNull()
      expect(document.body.textContent).not.toMatch(/K\d/)
      // Two matches by design — the message and the action label. Both
      // must be the ask, which is what `getAllBy` asserts here.
      expect(screen.getAllByText(/Ask a grown-up/i).length).toBeGreaterThan(0)
    })

    it('sends the tap to /ask-a-grown-up, not to the plan page', () => {
      mockReminder = { status: 'free', shouldRemind: true, isExpired: false }
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<SubscriptionStatusBanner />} />
            <Route path="/my-subscription" element={<div>PRICE LIST</div>} />
            <Route path="/ask-a-grown-up" element={<div>ASK A GROWN-UP</div>} />
          </Routes>
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByText(/Ask a grown-up to unlock/i).closest('button'))
      expect(screen.getByText('ASK A GROWN-UP')).toBeInTheDocument()
      expect(screen.queryByText('PRICE LIST')).toBeNull()
    })

    it('says the same thing when the plan has expired', () => {
      // The expired copy is where "Renew to restore your ZedExams Pro
      // access" lived. A child cannot renew any more than they can buy.
      renderBanner()
      expect(screen.queryByText(/Renew/i)).toBeNull()
      expect(screen.getAllByText(/Ask a grown-up/i).length).toBeGreaterThan(0)
    })
  })
})
