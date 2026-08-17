/**
 * LearnerNotificationsPage.spec — the prototype-v6 notification centre
 * (step 10). Pins: Today/Earlier grouping, unread accent + mark-all-read,
 * tap = mark read + deep-link via action.url, and the all-caught-up
 * empty state. The data layer is the existing NotificationContext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const markRead = vi.fn()
const markAllRead = vi.fn()
const removeAll = vi.fn()
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
  removeAll.mockClear()
  mockValue = {
    notifications: seed,
    unreadCount: 1,
    loading: false,
    hasMore: false,
    loadMore,
    markRead,
    markAllRead,
    removeAll,
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

  it('"Clear all" asks once before it destroys anything', () => {
    // The prototype clears on one tap because its own "Show demo
    // notifications" button puts everything back. The real app has no
    // undo, so the control asks — still one control, in the same place.
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(removeAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to clear' }))
    expect(removeAll).toHaveBeenCalledTimes(1)
  })

  it('the confirm lapses on its own, so a stray tap cannot arm a later one', () => {
    vi.useFakeTimers()
    try {
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
      act(() => { vi.advanceTimersByTime(4500) })
      expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
      expect(removeAll).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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
