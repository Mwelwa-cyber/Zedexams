/**
 * ParentNotificationsPage — the parent prototype's inbox screen.
 *
 * The rules it renders (tiles, buckets, age wording, safe tap targets) are
 * pinned under plain node in scripts/test-parent-notification-view.mjs. What
 * is pinned HERE is the screen's own behaviour: the two heads, the unread
 * accent, mark-all-read going through the context, a tap both marking read
 * and navigating, and the empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const markRead = vi.fn()
const markAllRead = vi.fn()
const loadMore = vi.fn()
let mockValue

vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => mockValue,
}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../shared/components/Skeleton', () => ({
  default: () => <div data-testid="skeleton" />,
}))

import ParentNotificationsPage from './ParentNotificationsPage'

const HOUR = 60 * 60 * 1000

// ── The clock is FROZEN, and it has to be frozen HERE ────────────────
//
// This suite groups notifications into "Today" and "Earlier", and the
// fixture below used `Date.now() - 1 * HOUR` for a row it then asserted
// was in Today. That is false for the first hour of any local day: run
// the suite at 00:49 and "an hour ago" is yesterday, so the row lands in
// Earlier and the test fails. CI runs in UTC, so this put the whole repo
// in a nightly red window — every PR, not just the one that noticed.
//
// Freezing at MODULE SCOPE rather than in `beforeEach` is the load-bearing
// part: the fixture consts are evaluated when this module is imported,
// which is long before any hook runs. Freeze in a hook and the fixture
// still reads the real clock while the COMPONENT reads the fake one —
// which is worse than the bug, because the two would disagree.
//
// `toFake: ['Date']` leaves setTimeout/queueMicrotask real, so Testing
// Library's async utilities keep working; only the calendar is pinned.
// The instant is written WITHOUT a trailing Z so it is parsed as local
// time — 09:00 wherever the suite runs — which is what makes "an hour
// ago is still today" true in every timezone rather than only in UTC.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date('2026-05-14T09:00:00'))

const now = Date.now()
const thisMorning = new Date(now)
thisMorning.setHours(1, 0, 0, 0)
const threeDaysAgo = now - 3 * 24 * HOUR

const seed = [
  {
    id: 'n1',
    category: 'account',
    type: 'child_unlock_request',
    title: 'Milton wants Premium',
    body: 'Approve to unlock all past papers. Tap to review his progress first.',
    read: false,
    action: { label: 'Review', url: '/family/child/milton' },
    createdAt: { toMillis: () => now - 1 * HOUR },
  },
  {
    id: 'n2',
    category: 'payments',
    type: 'payment_success',
    title: 'Premium is active',
    body: 'Covers every child on your account.',
    read: true,
    action: null,
    createdAt: { toMillis: () => thisMorning.getTime() },
  },
  {
    id: 'n3',
    category: 'announcements',
    type: 'announcement',
    title: 'Term 2 exams in 12 days',
    body: 'See what Milton should focus on.',
    read: true,
    action: { label: 'Open', url: 'https://evil.example/steal' },
    createdAt: { toMillis: () => threeDaysAgo },
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/family/notifications']}>
      <Routes>
        <Route path="/family/notifications" element={<ParentNotificationsPage />} />
        <Route path="/family" element={<div>FAMILY HOME</div>} />
        <Route path="/family/child/:childUid" element={<div>CHILD ROUTE</div>} />
        <Route path="/family/account/alerts" element={<div>PARENT ALERTS</div>} />
        {/* The learner settings screen, stubbed so the test can prove the
            footer does NOT point there. ParentRouteGuard would redirect a
            guardian away from it, but a link that names the wrong screen —
            and calls it "Settings → Notifications" — is still the wrong
            link. */}
        <Route path="/settings" element={<div>LEARNER SETTINGS</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockValue = {
    notifications: seed,
    unreadCount: 1,
    loading: false,
    hasMore: false,
    loadMore,
    markRead,
    markAllRead,
  }
})

describe('ParentNotificationsPage', () => {
  it('groups the feed into Today and Earlier', () => {
    renderPage()
    const today = screen.getByRole('region', { name: 'Today' })
    const earlier = screen.getByRole('region', { name: 'Earlier' })
    expect(within(today).getByText('Milton wants Premium')).toBeInTheDocument()
    expect(within(today).getByText('Premium is active')).toBeInTheDocument()
    expect(within(earlier).getByText('Term 2 exams in 12 days')).toBeInTheDocument()
  })

  it('accents only the unread card', () => {
    renderPage()
    const unread = screen.getByText('Milton wants Premium').closest('button')
    const read = screen.getByText('Premium is active').closest('button')
    expect(unread.classList.contains('is-unread')).toBe(true)
    expect(read.classList.contains('is-unread')).toBe(false)
  })

  it('gives a child request its own tile rather than the account default', () => {
    renderPage()
    const ask = screen.getByText('Milton wants Premium').closest('button')
    const paid = screen.getByText('Premium is active').closest('button')
    const cls = (btn) => btn.querySelector('.lhx-notif-ic').className
    expect(cls(ask)).toContain('lhx-ni-streak')
    expect(cls(ask)).not.toEqual(cls(paid))
  })

  it('mark all read goes through the context, and shows once', () => {
    renderPage()
    const buttons = screen.getAllByRole('button', { name: 'Mark all read' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(markAllRead).toHaveBeenCalledTimes(1)
  })

  it('hides mark-all-read when nothing is unread', () => {
    mockValue = { ...mockValue, unreadCount: 0 }
    renderPage()
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })

  it('tapping a card marks it read and deep-links to its action url', () => {
    renderPage()
    fireEvent.click(screen.getByText('Milton wants Premium').closest('button'))
    expect(markRead).toHaveBeenCalledWith('n1')
    expect(screen.getByText('CHILD ROUTE')).toBeInTheDocument()
  })

  it('does not navigate to an action url that leaves the origin', () => {
    // The card still opens (and would still mark read) — it just refuses to
    // take a signed-in guardian off the product.
    renderPage()
    fireEvent.click(screen.getByText('Term 2 exams in 12 days').closest('button'))
    expect(screen.getByText('Term 2 exams in 12 days')).toBeInTheDocument()
    expect(screen.queryByText('CHILD ROUTE')).not.toBeInTheDocument()
  })

  it('a read card with no action neither re-marks nor navigates', () => {
    renderPage()
    fireEvent.click(screen.getByText('Premium is active').closest('button'))
    expect(markRead).not.toHaveBeenCalled()
    expect(screen.queryByText('CHILD ROUTE')).not.toBeInTheDocument()
  })

  it('the back row returns to the family home', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /back to your family home/i }))
    expect(screen.getByText('FAMILY HOME')).toBeInTheDocument()
  })

  it('shows skeletons while the feed is loading, not a blank screen', () => {
    mockValue = { ...mockValue, loading: true, notifications: [] }
    renderPage()
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
  })

  it('shows the caught-up empty state when the feed is empty', () => {
    mockValue = { ...mockValue, notifications: [], unreadCount: 0 }
    renderPage()
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
  })

  it('points at the PARENT switches, never the learner settings screen', () => {
    mockValue = { ...mockValue, notifications: [], unreadCount: 0 }
    renderPage()
    fireEvent.click(screen.getByRole('link', { name: /account.*alerts/i }))
    expect(screen.getByText('PARENT ALERTS')).toBeInTheDocument()
    expect(screen.queryByText('LEARNER SETTINGS')).not.toBeInTheDocument()
  })

  it('offers Show earlier when the context has more pages', () => {
    mockValue = { ...mockValue, hasMore: true }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })
})
