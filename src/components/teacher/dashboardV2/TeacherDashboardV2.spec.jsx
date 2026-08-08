import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import TeacherLayout from '../TeacherLayout'
import TeacherDashboardV2 from './TeacherDashboardV2'
import { TOUR_STORAGE_KEY } from './onboardingTourCore'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

// These specs exercise the dashboard chrome — suppress the first-run tour
// (its own behaviour is covered in OnboardingTour.spec.jsx).
beforeEach(() => {
  localStorage.setItem(TOUR_STORAGE_KEY, 'done')
})

// The header bell reads the app-wide NotificationProvider (main.jsx); specs
// mount without it, so stub the hook.
// The sidebar and its account menu belong to the shell, so they show the
// SIGNED-IN teacher — mockData only drives the page content.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isTeacher: true,
    isAdmin: false,
    currentUser: { displayName: 'Mahenga Mwelwa', email: 'mahenga@example.com' },
    userProfile: { displayName: 'Mahenga Mwelwa', email: 'mahenga@example.com' },
    logout: vi.fn().mockResolvedValue(),
  }),
}))
// Reads Firestore and is not under test here.
vi.mock('../TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

function renderDashboard() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/dashboard-preview']}>
        <TeacherLayout variant="dashboard">
          <TeacherDashboardV2 />
        </TeacherLayout>
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
    // The classic card workspace is the desktop surface
    expect(screen.getByRole('region', { name: 'Teacher Workspace' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Lesson Plans.*Open studio$/)).toBeInTheDocument()
    expect(screen.getByText('Checklist Completion')).toBeInTheDocument()
    expect(screen.getByText('Feed & Status')).toBeInTheDocument()
    expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    expect(screen.getByText(/Preview Mode — Changes are not live\./)).toBeInTheDocument()
  })

  it('Theme menu item toggles dark mode in place and persists it', async () => {
    localStorage.removeItem('zedexams:tdv2-theme')
    const u = user()
    const { container } = renderDashboard()
    expect(container.querySelector('.tdv2')).not.toHaveClass('is-dark')

    await u.click(screen.getByRole('button', { name: /Mahenga Mwelwa/ }))
    const themeItem = screen.getByRole('menuitemcheckbox', { name: /switch to dark/ })
    expect(themeItem).toHaveAttribute('aria-checked', 'false')

    await u.click(themeItem)
    expect(container.querySelector('.tdv2')).toHaveClass('is-dark')
    expect(localStorage.getItem('zedexams:tdv2-theme')).toBe('dark')
    // Menu stays open so the switch is reversible in place
    const backItem = screen.getByRole('menuitemcheckbox', { name: /switch to light/ })
    expect(backItem).toHaveAttribute('aria-checked', 'true')

    await u.click(backItem)
    expect(container.querySelector('.tdv2')).not.toHaveClass('is-dark')
    expect(localStorage.getItem('zedexams:tdv2-theme')).toBe('light')
    localStorage.removeItem('zedexams:tdv2-theme')
  })

  it('View all teacher tools expands the extra studios in place', async () => {
    const u = user()
    renderDashboard()
    // Featured cards render up-front; the rest sit behind the expander.
    expect(screen.getByLabelText(/^School-Based Assessment.*Open studio$/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Class Timetable.*Open studio$/)).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /View all teacher tools \(\d+ more\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await u.click(toggle)
    expect(screen.getByLabelText(/^Class Timetable.*Open studio$/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Class Register.*Open studio$/)).toBeInTheDocument()
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
