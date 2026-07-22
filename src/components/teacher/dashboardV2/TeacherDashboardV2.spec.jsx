import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import TeacherDashboardV2 from './TeacherDashboardV2'

// recharts' ResponsiveContainer needs real layout measurements jsdom can't
// provide; stub the chart card so the rest of the dashboard renders.
vi.mock('./PerformanceSnapshotCard', () => ({
  default: () => <section aria-label="Performance Snapshot (stub)" />,
}))
// The header bell reads the app-wide NotificationProvider (main.jsx); specs
// mount without it, so stub the hook.
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

function renderDashboard() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/dashboard-preview']}>
        <TeacherDashboardV2 />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('TeacherDashboardV2 greeting (fake clock)', () => {
  // Only the greeting needs a controlled clock; interaction tests below run
  // on real timers because userEvent + fake timers deadlock in this setup.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('greets by local time: morning before 12:00', () => {
    vi.setSystemTime(new Date(2026, 6, 15, 8, 30))
    renderDashboard()
    expect(screen.getByText(/Good morning,/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Mahenga' })).toBeInTheDocument()
  })

  it('greets afternoon from 12:00 and evening from 18:00', () => {
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0))
    const { unmount } = renderDashboard()
    expect(screen.getByText(/Good afternoon,/)).toBeInTheDocument()
    unmount()

    vi.setSystemTime(new Date(2026, 6, 15, 18, 0))
    renderDashboard()
    expect(screen.getByText(/Good evening,/)).toBeInTheDocument()
  })
})

describe('TeacherDashboardV2', () => {
  const user = () => userEvent.setup()

  it('opens the account menu on click, closes on Escape and restores trigger focus', async () => {
    const u = user()
    renderDashboard()

    const trigger = screen.getByRole('button', { name: /Mahenga Mwelwa/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await u.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByText('mahenga@example.com')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument()

    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes the account menu on outside click', async () => {
    const u = user()
    renderDashboard()

    await u.click(screen.getByRole('button', { name: /Mahenga Mwelwa/ }))
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument()

    await u.click(screen.getByRole('heading', { level: 1, name: 'Mahenga' }))
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('Log out asks for confirmation before doing anything', async () => {
    const u = user()
    renderDashboard()

    await u.click(screen.getByRole('button', { name: /Mahenga Mwelwa/ }))
    await u.click(screen.getByRole('menuitem', { name: 'Log out' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Log out of ZedExams?' })
    expect(
      within(dialog).getByText('You will need to sign in again to access your dashboard.'),
    ).toBeInTheDocument()

    // Cancel keeps the session (dashboard still rendered).
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Mahenga' })).toBeInTheDocument()
  })

  it('renders the required dashboard sections from mock data', () => {
    renderDashboard()

    expect(screen.getByText('Quick Create')).toBeInTheDocument()
    expect(screen.getByText('AI Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Mathematics is not planned yet')).toBeInTheDocument()
    expect(screen.getByText('Recent Documents')).toBeInTheDocument()
    expect(screen.getByText('GRADE FOUR END OF TERM 2 TEST - 2026')).toBeInTheDocument()
    expect(screen.getByText('Teacher Workspace')).toBeInTheDocument()
    expect(screen.getByText('Checklist Completion')).toBeInTheDocument()
    expect(screen.getByText('Feed & Status')).toBeInTheDocument()
    expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    expect(screen.getByText(/Preview Mode — Changes are not live\./)).toBeInTheDocument()
  })

  it('View all teacher tools expands the full tool grid in place', async () => {
    const u = user()
    renderDashboard()
    const toggle = screen.getByRole('button', { name: /View all teacher tools \(\d+ more\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /Question Bank/ })).not.toBeInTheDocument()

    await u.click(toggle)
    expect(screen.getByRole('link', { name: /Question Bank/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Class Timetable/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hide extra tools/ })).toBeInTheDocument()
  })

  it('sidebar puts Dashboard above the CREATE group', () => {
    renderDashboard()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const html = nav.innerHTML
    expect(html.indexOf('Dashboard')).toBeGreaterThan(-1)
    expect(html.indexOf('Dashboard')).toBeLessThan(html.indexOf('Create'))
    expect(html.indexOf('Create')).toBeLessThan(html.indexOf('Manage'))
    expect(html.indexOf('Manage')).toBeLessThan(html.indexOf('Settings'))
  })
})
