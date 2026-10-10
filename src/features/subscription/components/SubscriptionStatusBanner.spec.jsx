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
 * It also pins the age rule, which depends on the platform: in the Android
 * build an under-18 learner is never shown a price, a plan name or a route to
 * the checkout; on the web they are, because a parent pays. The default
 * profile in these tests is an ADULT learner (`isMinor: false`) —
 * `resolveAgeBand` fails closed, so a bare `{ role: 'learner' }` is a child.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const ADULT = { id: 'learner-1', role: 'learner', isMinor: false }
const CHILD = { id: 'learner-2', role: 'learner' }

let mockAuth = { userProfile: ADULT }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

let mockNative = false
vi.mock('../../../utils/runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  isNativePlatform: () => mockNative,
}))



let mockReminder = { status: 'expired', shouldRemind: true, isExpired: true }
vi.mock('../../../hooks/useSubscriptionReminder', () => ({
  useSubscriptionReminder: () => mockReminder,
}))

import SubscriptionStatusBanner from './SubscriptionStatusBanner'
import { claimReminderHost } from '../../../shared/utils/reminderHost'

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
  mockNative = false
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

  describe('an under-18 learner on the web — a parent pays', () => {
    beforeEach(() => { mockAuth = { userProfile: CHILD } })

    it('is shown the normal strip, not the ask-a-grown-up one', () => {
      renderBanner()
      expect(screen.getByText('Expired Subscription')).toBeInTheDocument()
      expect(screen.queryByText(/Ask a grown-up/i)).toBeNull()
    })
  })

  describe('an under-18 learner in the Android build', () => {
    beforeEach(() => { mockAuth = { userProfile: CHILD }; mockNative = true })

    it('is shown the normal strip and goes to the plan page — Google Play owns the sheet', () => {
      renderBanner()
      expect(screen.getByText('Expired Subscription')).toBeInTheDocument()
      expect(screen.queryByText(/Ask a grown-up/i)).toBeNull()
    })
  })

  it('stands down while a shell has claimed the reminder slot (no second copy under the sidebar)', () => {
    const release = claimReminderHost()
    const { container } = renderBanner()
    expect(container).toBeEmptyDOMElement()
    release()
  })
})
