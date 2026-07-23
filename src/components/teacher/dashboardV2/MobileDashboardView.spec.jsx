import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import TeacherDashboardV2 from './TeacherDashboardV2'

// Force the mobile information architecture regardless of jsdom viewport.
vi.mock('./useIsMobile', () => ({ default: () => true }))
vi.mock('./PerformanceSnapshotCard', () => ({
  default: () => <section aria-label="Activity Snapshot (stub)" />,
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 3, open: false, setOpen: () => {} }),
}))

function renderMobile() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/dashboard-preview']}>
        <TeacherDashboardV2 />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('MobileDashboardView (via preview page)', () => {
  it('renders the mobile IA: no desktop sidebar, bottom nav, mobile sections', () => {
    renderMobile()
    // Desktop sidebar must never render on mobile
    expect(screen.queryByLabelText('Teacher navigation')).not.toBeInTheDocument()
    // Bottom navigation
    const bottom = screen.getByRole('navigation', { name: 'Quick navigation' })
    for (const label of ['Home', 'My Class', 'Library', 'Assessments', 'More']) {
      expect(within(bottom).getByText(label)).toBeInTheDocument()
    }
    // Core sections in order-of-existence
    expect(screen.getByRole('heading', { level: 1, name: 'Mahenga' })).toBeInTheDocument()
    expect(screen.getByText('Quick Create')).toBeInTheDocument()
    expect(screen.getByText('AI Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Recent Documents')).toBeInTheDocument()
    // Mobile shows 4 documents, not 5
    expect(screen.getByText('GRADE FOUR END OF TERM 2 TEST - 2026')).toBeInTheDocument()
    expect(screen.queryByText('G5 Integrated Science — Term 1 Scheme of Work')).not.toBeInTheDocument()
    // Notification badge from the real feed hook
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
  })

  it('drawer opens from the hamburger, keeps Dashboard above CREATE, closes on Escape', async () => {
    const user = userEvent.setup()
    renderMobile()

    const drawerRoot = document.querySelector('.tdv2m-drawer-root')
    expect(drawerRoot).not.toHaveClass('is-open')

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(drawerRoot).toHaveClass('is-open')
    // Page behind must not scroll while open
    expect(document.body.style.overflow).toBe('hidden')

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const html = nav.innerHTML
    expect(html.indexOf('Dashboard')).toBeGreaterThan(-1)
    expect(html.indexOf('Dashboard')).toBeLessThan(html.indexOf('Create'))
    expect(html.indexOf('Create')).toBeLessThan(html.indexOf('Manage'))
    expect(html.indexOf('Manage')).toBeLessThan(html.indexOf('Settings'))

    await user.keyboard('{Escape}')
    expect(drawerRoot).not.toHaveClass('is-open')
    expect(document.body.style.overflow).toBe('')
  })

  it('drawer closes when a navigation item is selected', async () => {
    const user = userEvent.setup()
    renderMobile()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    await user.click(within(nav).getByText('My Library'))
    expect(document.querySelector('.tdv2m-drawer-root')).not.toHaveClass('is-open')
  })

  it('profile card opens the account panel; Log out requires confirmation', async () => {
    const user = userEvent.setup()
    renderMobile()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const profile = screen.getByRole('button', { name: /Mahenga Mwelwa/ })
    expect(profile).toHaveAttribute('aria-haspopup', 'menu')
    expect(profile).toHaveAttribute('aria-expanded', 'false')

    await user.click(profile)
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(within(menu).getByText('mahenga@example.com')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemcheckbox', { name: /switch to dark/ })).toBeInTheDocument()

    await user.click(within(menu).getByRole('menuitem', { name: 'Log out' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Log out of ZedExams?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // Still on the dashboard — no logout happened without confirmation
    expect(screen.getByRole('heading', { level: 1, name: 'Mahenga' })).toBeInTheDocument()
  })
})
