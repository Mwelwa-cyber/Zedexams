/**
 * LearnerNotificationsPage.spec — the prototype-v6 notification centre
 * (step 10). Pins: Today/Earlier grouping, unread accent + mark-all-read,
 * tap = mark read + deep-link via action.url, and the all-caught-up
 * empty state. The data layer is the existing NotificationContext.
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

import LearnerNotificationsPage from './LearnerNotificationsPage'

const HOUR = 60 * 60 * 1000
const now = Date.now()
const todayMorning = new Date(now)
todayMorning.setHours(6, 30, 0, 0)

const seed = [
  {
    id: 'n1',
    category: 'assessments',
    title: 'Exams in 12 days',
    body: 'Term 2 exams start soon. Tap to see your timetable.',
    read: false,
    action: { label: 'Timetable', url: '/timetable' },
    createdAt: { toMillis: () => now - 1 * HOUR },
  },
  {
    id: 'n2',
    category: 'learning',
    title: "Today's quiz is ready",
    body: 'Keep your streak alive!',
    read: true,
    action: null,
    createdAt: { toMillis: () => todayMorning.getTime() },
  },
  {
    id: 'n3',
    category: 'announcements',
    title: 'New badge: Number Ninja',
    body: 'See it on your shelf.',
    read: true,
    action: { label: 'Games', url: '/games' },
    createdAt: { toMillis: () => now - 30 * HOUR },
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<LearnerNotificationsPage />} />
        <Route path="/timetable" element={<div>TIMETABLE ROUTE</div>} />
        <Route path="/dashboard" element={<div>HOME ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  markRead.mockClear()
  markAllRead.mockClear()
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

describe('LearnerNotificationsPage (prototype-v6)', () => {
  it('groups into Today and Earlier and accents unread cards', () => {
    renderPage()
    const today = screen.getByRole('region', { name: 'Today' })
    const earlier = screen.getByRole('region', { name: 'Earlier' })
    expect(within(today).getByText('Exams in 12 days')).toBeInTheDocument()
    expect(within(today).getByText("Today's quiz is ready")).toBeInTheDocument()
    expect(within(earlier).getByText('New badge: Number Ninja')).toBeInTheDocument()
    const unread = within(today).getByText('Exams in 12 days').closest('button')
    expect(unread.classList.contains('is-unread')).toBe(true)
  })

  it('mark all read goes through the context', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(markAllRead).toHaveBeenCalledTimes(1)
  })

  it('tapping a card marks it read and deep-links to its action url', () => {
    renderPage()
    fireEvent.click(screen.getByText('Exams in 12 days').closest('button'))
    expect(markRead).toHaveBeenCalledWith('n1')
    expect(screen.getByText('TIMETABLE ROUTE')).toBeInTheDocument()
  })

  it('a read card without an action neither re-marks nor navigates', () => {
    renderPage()
    fireEvent.click(screen.getByText("Today's quiz is ready").closest('button'))
    expect(markRead).not.toHaveBeenCalled()
    expect(screen.queryByText('TIMETABLE ROUTE')).not.toBeInTheDocument()
  })

  it('shows the all-caught-up empty state when the feed is empty', () => {
    mockValue = { ...mockValue, notifications: [], unreadCount: 0 }
    renderPage()
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
  })

  it('offers Show earlier when the context has more pages', () => {
    mockValue = { ...mockValue, hasMore: true }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })
})
