/**
 * Behaviour tests for the parent dashboard.
 *
 * What is pinned here: the child who needs attention is listed FIRST (a
 * parent should not have to read past the child who is fine), a failed
 * approvals read does not take the children list down with it, and the
 * screen never prints a figure ZedExams does not measure — no
 * time-on-task, no exam-readiness percentage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { displayName: 'Grace Phiri' } }),
}))

let mockChildren
vi.mock('../hooks/useGuardianChildren', () => ({
  default: () => mockChildren,
}))

const listGuardianFeed = vi.fn(() => Promise.resolve({ approvals: [], deletionRequests: [] }))
vi.mock('../services/parentApp', () => ({
  listGuardianFeed: (...a) => listGuardianFeed(...a),
  listGuardianApprovals: vi.fn(() => Promise.resolve([])),
  declineGuardianApproval: vi.fn(),
}))

import ParentHome from './ParentHome'

const DAY = 86_400_000

const onTrack = {
  childUid: 'kid-ok', displayName: 'Aaron Phiri', grade: '7',
  status: 'on_track', lastActiveAt: Date.now() - 2 * 3600_000, guardianCount: 1,
}
const stopped = {
  childUid: 'kid-quiet', displayName: 'Zoe Phiri', grade: '4',
  status: 'quiet', lastActiveAt: Date.now() - 20 * DAY, guardianCount: 2,
}

function renderHome() {
  return render(<MemoryRouter><ParentHome /></MemoryRouter>)
}

describe('ParentHome', () => {
  beforeEach(() => {
    listGuardianFeed.mockClear()
    listGuardianFeed.mockResolvedValue({ approvals: [], deletionRequests: [] })
    mockChildren = { loading: false, error: null, children: [onTrack, stopped], reload: vi.fn() }
  })

  it('shows a deletion request as its own alert, above the approval feed', async () => {
    listGuardianFeed.mockResolvedValue({
      approvals: [],
      deletionRequests: [
        { id: 'req1', learnerId: 'kid-ok', childName: 'Aaron Phiri', requestedAt: Date.now() - 2 * DAY },
      ],
    })
    renderHome()
    await waitFor(() => expect(screen.getByText(/wants to delete their account/)).toBeInTheDocument())
    // Days REMAINING, not days elapsed: what a parent has to act on.
    expect(screen.getByText(/5 days to reply/)).toBeInTheDocument()
  })

  it('offers NO decision on the alert itself — only a route to the screen that can inform one', async () => {
    listGuardianFeed.mockResolvedValue({
      approvals: [],
      deletionRequests: [
        { id: 'req1', learnerId: 'kid-ok', childName: 'Aaron Phiri', requestedAt: Date.now() },
      ],
    })
    renderHome()
    await waitFor(() => expect(screen.getByText(/wants to delete their account/)).toBeInTheDocument())
    // A one-tap Approve on a home-screen card would be the same mistake as a
    // one-tap purchase: the decision needs the streak, the exam countdown, the
    // two lists and the plan panel to be an informed one.
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /decline/i })).toBeNull()
    expect(screen.getByRole('link', { name: /wants to delete/ })).toHaveAttribute('href', '/family/requests/req1')
  })

  it('shows no alert when nothing is pending', async () => {
    renderHome()
    await waitFor(() => expect(listGuardianFeed).toHaveBeenCalled())
    expect(screen.queryByText(/Needs your answer/)).toBeNull()
  })

  it('greets the parent by first name', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Grace')
  })

  it('lists the child who stopped BEFORE the one who is fine', () => {
    // Alphabetically Aaron comes first; by need, Zoe does.
    renderHome()
    const names = screen.getAllByText(/Phiri|Aaron|Zoe/).map((n) => n.textContent)
    const zoeAt = names.findIndex((t) => t.includes('Zoe'))
    const aaronAt = names.findIndex((t) => t.includes('Aaron'))
    expect(zoeAt).toBeLessThan(aaronAt)
  })

  it('never prints a figure we do not measure', () => {
    renderHome()
    const text = document.body.textContent
    expect(text).not.toMatch(/\d+h\s?\d*m/)
    expect(text).not.toMatch(/exam.?ready/i)
  })

  it('a failed approvals read leaves the children list standing', async () => {
    listGuardianFeed.mockRejectedValue(new Error('offline'))
    renderHome()
    await waitFor(() => expect(listGuardianFeed).toHaveBeenCalled())
    // `getAllByText`: Zoe is named twice on this screen now — once on her
    // overview card and once on her row in the plan section. The point of
    // the test is that the list survived a failed feed read, not that the
    // name appears exactly once.
    expect(screen.getAllByText(/Zoe/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Needs your approval/)).not.toBeInTheDocument()
  })

  /* ── The plan, which used to be invisible ────────────────────────── */
  //
  // The reported failure: a guardian bought a day pass, it went through,
  // and no screen in /family said so. A paid child and a free one drew
  // identically — as nothing — and the only route to the price list ran
  // through Account → Payments → Plans.

  it('says a child is on the free plan, and offers the way to change that', () => {
    mockChildren = { loading: false, error: null, children: [onTrack], reload: vi.fn() }
    renderHome()
    expect(screen.getAllByText(/Free plan/).length).toBeGreaterThan(0)
    const unlock = screen.getByRole('link', { name: /Unlock/i })
    expect(unlock).toHaveAttribute('href', '/family/plan?child=kid-ok')
  })

  it('says a paid plan is on, and when it ends', () => {
    mockChildren = {
      loading: false,
      error: null,
      children: [{
        ...onTrack,
        premium: true,
        subscriptionPlan: 'day_pass',
        premiumExpiresAt: Date.now() + 20 * 3600_000,
        subscriptionProvider: 'lenco',
      }],
      reload: vi.fn(),
    }
    renderHome()
    expect(screen.getAllByText(/Day pass/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Ends tomorrow/)).toBeInTheDocument()
    // The one thing a guardian who has paid must never be told.
    expect(document.body.textContent).not.toMatch(/Free plan/)
  })

  it('reaches the price list and the receipts from the dashboard', () => {
    // Both were three taps into Account before this. The section carries
    // them because a parent asking "what am I paying for" is on this
    // screen, not in settings.
    renderHome()
    expect(screen.getByRole('link', { name: /Receipts/i }))
      .toHaveAttribute('href', '/family/account/billing')
    expect(screen.getAllByRole('link', { name: /Unlock/i }).length).toBe(2)
  })

  it('counts a mixed family rather than calling it “some”', () => {
    mockChildren = {
      loading: false,
      error: null,
      children: [
        { ...onTrack, premium: true, subscriptionPlan: 'monthly', premiumExpiresAt: Date.now() + 20 * DAY },
        stopped,
      ],
      reload: vi.fn(),
    }
    renderHome()
    expect(screen.getByText('1 of 2 unlocked.')).toBeInTheDocument()
  })

  it('says nothing about a plan when there is nobody to say it about', () => {
    mockChildren = { loading: false, error: null, children: [], reload: vi.fn() }
    renderHome()
    expect(screen.queryByText(/Plan and payments/)).not.toBeInTheDocument()
  })

  it('an empty family explains how to add one rather than showing a blank', () => {
    mockChildren = { loading: false, error: null, children: [], reload: vi.fn() }
    renderHome()
    expect(screen.getByText(/family code/i)).toBeInTheDocument()
  })

  it('a failed children read offers a retry', () => {
    const reload = vi.fn()
    mockChildren = { loading: false, error: 'Could not load', children: [], reload }
    renderHome()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
