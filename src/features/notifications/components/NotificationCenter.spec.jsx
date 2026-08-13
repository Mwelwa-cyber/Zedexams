import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setActiveShellNavGuard, __resetShellNavGuard } from '../../../shared/utils/shellNavGuardCore'

// Mock the context so we drive the center with a controlled notification set.
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: vi.fn(),
}))

import { useNotifications } from '../../../contexts/NotificationContext'
import NotificationCenter from './NotificationCenter'

const markRead = vi.fn()
const markAllRead = vi.fn()
const remove = vi.fn()
const removeAll = vi.fn()
const setOpen = vi.fn()
const loadMore = vi.fn()

function makeNotif(over = {}) {
  return {
    id: over.id || 'n1',
    category: 'learning',
    type: 'quiz_assigned',
    title: 'New quiz assigned',
    body: 'Your Maths quiz is ready',
    icon: 'academic-cap',
    priority: 'medium',
    action: { label: 'Open Quiz', url: '/quiz/1' },
    read: false,
    createdAt: { toDate: () => new Date(Date.now() - 60_000) },
    ...over,
  }
}

function setCtx(over = {}) {
  useNotifications.mockReturnValue({
    notifications: [],
    loading: false,
    hasMore: false,
    setOpen,
    loadMore,
    markRead,
    markAllRead,
    remove,
    removeAll,
    ...over,
  })
}

const renderCenter = () =>
  render(
    <MemoryRouter>
      <NotificationCenter />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NotificationCenter', () => {
  it('portals the overlay to document.body (not inside the opener)', () => {
    // Regression: rendered in place, the fixed-position overlay is trapped by
    // the glass navbar's backdrop-filter/will-change containing block and gets
    // squashed into the 80px nav strip — the bell then looks dead.
    setCtx({ notifications: [] })
    const { container } = renderCenter()
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    expect(dialog.parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
  })

  it('renders the empty state when there are no notifications', () => {
    setCtx({ notifications: [] })
    renderCenter()
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()
  })

  it('renders a notification with title, body and action label', () => {
    setCtx({ notifications: [makeNotif()] })
    renderCenter()
    expect(screen.getByText('New quiz assigned')).toBeInTheDocument()
    expect(screen.getByText('Your Maths quiz is ready')).toBeInTheDocument()
    expect(screen.getByText(/Open Quiz/)).toBeInTheDocument()
  })

  it('marks read on click and navigates via the action url', () => {
    setCtx({ notifications: [makeNotif()] })
    renderCenter()
    fireEvent.click(screen.getByText('New quiz assigned'))
    expect(markRead).toHaveBeenCalledWith('n1')
  })

  it('calls markAllRead and removeAll from the header actions', () => {
    setCtx({ notifications: [makeNotif()] })
    renderCenter()
    fireEvent.click(screen.getByText('Mark all read'))
    expect(markAllRead).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Clear all'))
    expect(removeAll).toHaveBeenCalled()
  })

  it('deletes a single notification via its delete button', () => {
    setCtx({ notifications: [makeNotif()] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Delete notification' }))
    expect(remove).toHaveBeenCalledWith('n1')
  })

  it('filters by the unread-only toggle', () => {
    setCtx({
      notifications: [
        makeNotif({ id: 'unread', title: 'Unread one', read: false }),
        makeNotif({ id: 'readone', title: 'Read one', read: true }),
      ],
    })
    renderCenter()
    expect(screen.getByText('Read one')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Unread'))
    expect(screen.queryByText('Read one')).not.toBeInTheDocument()
    expect(screen.getByText('Unread one')).toBeInTheDocument()
  })

  it('filters by category chips', () => {
    setCtx({
      notifications: [
        makeNotif({ id: 'l', title: 'Learning item', category: 'learning' }),
        makeNotif({ id: 'p', title: 'Payment item', category: 'payments' }),
      ],
    })
    renderCenter()
    // Click the Payments chip in the controls (not a row).
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
    expect(screen.getByText('Payment item')).toBeInTheDocument()
    expect(screen.queryByText('Learning item')).not.toBeInTheDocument()
  })

  it('filters by search text', () => {
    setCtx({
      notifications: [
        makeNotif({ id: 'a', title: 'Alpha quiz' }),
        makeNotif({ id: 'b', title: 'Beta exam' }),
      ],
    })
    renderCenter()
    fireEvent.change(screen.getByLabelText('Search notifications'), { target: { value: 'beta' } })
    expect(screen.getByText('Beta exam')).toBeInTheDocument()
    expect(screen.queryByText('Alpha quiz')).not.toBeInTheDocument()
  })

  it('closes via the close button', () => {
    setCtx({ notifications: [] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('shows the load-more affordance when more pages exist', () => {
    setCtx({ notifications: [makeNotif()], hasMore: true })
    renderCenter()
    const more = screen.getByText('Load older notifications')
    fireEvent.click(more)
    expect(loadMore).toHaveBeenCalled()
  })

  // The center's rows and settings button navigate imperatively (not <a href>),
  // so the shell's anchor-only capture listener can't see them — they consult
  // the module-scope gate directly, like the account menu does. Without this a
  // notification tap on a dirty register page discarded the unsaved marks.
  describe('unsaved-changes shell gate', () => {
    afterEach(() => __resetShellNavGuard())

    it('a denying gate blocks an in-app notification navigation (no read, no close)', () => {
      setActiveShellNavGuard(() => false)
      setCtx({ notifications: [makeNotif()] }) // action.url '/quiz/1' is in-app
      renderCenter()
      fireEvent.click(screen.getByText('New quiz assigned'))
      expect(markRead).not.toHaveBeenCalled()
      expect(setOpen).not.toHaveBeenCalled() // close() never reached
    })

    it('an allowing gate lets an in-app notification navigation through', () => {
      setActiveShellNavGuard(() => true)
      setCtx({ notifications: [makeNotif()] })
      renderCenter()
      fireEvent.click(screen.getByText('New quiz assigned'))
      expect(markRead).toHaveBeenCalledWith('n1')
    })

    it('an external (http) notification link is never gated', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      setActiveShellNavGuard(() => false) // even a denying gate must not block a new tab
      setCtx({ notifications: [makeNotif({ action: { label: 'Open', url: 'https://example.com/x' } })] })
      renderCenter()
      fireEvent.click(screen.getByText('New quiz assigned'))
      expect(markRead).toHaveBeenCalledWith('n1')
      expect(openSpy).toHaveBeenCalled()
      openSpy.mockRestore()
    })

    it('a denying gate blocks the Notification settings navigation', () => {
      setActiveShellNavGuard(() => false)
      setCtx({ notifications: [makeNotif()] })
      renderCenter()
      fireEvent.click(screen.getByRole('button', { name: 'Notification settings' }))
      expect(setOpen).not.toHaveBeenCalled()
    })
  })
})
