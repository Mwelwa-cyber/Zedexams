import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Controlled context so we can drive open/unread state directly.
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: vi.fn(),
}))

import { useNotifications } from '../../../contexts/NotificationContext'
import NotificationBell from './NotificationBell'

const setOpen = vi.fn()

function setCtx(over = {}) {
  useNotifications.mockReturnValue({
    notifications: [],
    unreadCount: 0,
    loading: false,
    hasMore: false,
    open: false,
    setOpen,
    loadMore: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    remove: vi.fn(),
    removeAll: vi.fn(),
    ...over,
  })
}

const renderBell = (props) =>
  render(
    <MemoryRouter>
      <NotificationBell {...props} />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NotificationBell', () => {
  it('opens the Notification Center on click', () => {
    setCtx()
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(setOpen).toHaveBeenCalledWith(true)
  })

  it('shows the unread count badge and announces it', () => {
    setCtx({ unreadCount: 3 })
    renderBell()
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the panel when open', () => {
    setCtx({ open: true })
    renderBell()
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('does NOT mount the panel when withPanel is false', () => {
    // Navbar mounts two bells (desktop + mobile clusters). The panel portals
    // to <body>, so only one bell may own it or two overlays stack.
    setCtx({ open: true })
    renderBell({ withPanel: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
