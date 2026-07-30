import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import TeacherLayout from '../TeacherLayout'
import TeacherDashboardV2 from './TeacherDashboardV2'
import { TOUR_STORAGE_KEY } from './onboardingTourCore'

// These specs exercise the mobile IA chrome — suppress the first-run tour
// (its own behaviour is covered in OnboardingTour.spec.jsx).
// The AI-recommendation dismiss store is keyed per signed-in teacher; the auth
// mock below has no current user, so the effective key is the :anon scope.
const REC_HIDDEN_KEY = 'zedexams:tdv2m-recs-hidden:anon'

beforeEach(() => {
  localStorage.setItem(TOUR_STORAGE_KEY, 'done')
  localStorage.removeItem(REC_HIDDEN_KEY)
  localStorage.removeItem('zedexams:teacher-recents:anon')
})

// Force the mobile information architecture regardless of jsdom viewport.
vi.mock('./useIsMobile', () => ({ default: () => true }))
// Not part of the mobile IA under test, and it boots Firebase.
vi.mock('../TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
// The drawer's profile card belongs to the shell, so it shows the SIGNED-IN
// teacher (auth) — not mockData's TEACHER, which only drives the page content.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isTeacher: true,
    isAdmin: false,
    currentUser: { displayName: 'Mahenga Mwelwa', email: 'mahenga@example.com' },
    userProfile: { displayName: 'Mahenga Mwelwa', email: 'mahenga@example.com' },
    logout: vi.fn().mockResolvedValue(),
  }),
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 3, open: false, setOpen: () => {} }),
}))

// The mobile header, drawer and dock are TeacherLayout's; the dashboard
// supplies only the content below them. Rendered together exactly as the
// route composes them.
function renderMobile() {
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

describe('MobileDashboardView (via preview page)', () => {
  it('renders the mobile IA: opaque header, hero, checklist, AI rec, recent tools, dock', () => {
    renderMobile()
    // Desktop sidebar must never render on mobile
    expect(screen.queryByLabelText('Teacher navigation')).not.toBeInTheDocument()

    // Floating dock: Home, Register, Library, Assessments — plus the
    // separate Quick Create button. No "More" tab in the dock.
    const dock = screen.getByRole('navigation', { name: 'Quick navigation' })
    for (const label of ['Home', 'Register', 'Library', 'Assessments']) {
      expect(within(dock).getByText(label)).toBeInTheDocument()
    }
    expect(within(dock).queryByText('More')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quick create' })).toBeInTheDocument()

    // Hero: greeting + school + term progress + teaching days + plan badge
    expect(screen.getByRole('heading', { level: 1, name: /Mahenga/ })).toBeInTheDocument()
    expect(screen.getByText('Jemareen Academy')).toBeInTheDocument()
    expect(screen.getByText(/Term 2 · Week 10 of 14/)).toBeInTheDocument()
    expect(screen.getByText('18 teaching days left')).toBeInTheDocument()
    expect(screen.getByText('Max Plan')).toBeInTheDocument()

    // Compact checklist + collapsed AI recommendation + recent tools
    expect(screen.getByText('This Week’s Checklist')).toBeInTheDocument()
    expect(screen.getByText('AI Recommendation')).toBeInTheDocument()
    expect(screen.getByText('Recently Used')).toBeInTheDocument()
    expect(screen.getByText('All Teacher Tools')).toBeInTheDocument()

    // Notification badge from the real feed hook
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
  })

  it('Register dock tab links to the Class Register (/teacher/attendance)', () => {
    renderMobile()
    const dock = screen.getByRole('navigation', { name: 'Quick navigation' })
    const register = within(dock).getByText('Register').closest('a')
    expect(register).toHaveAttribute('href', '/teacher/attendance')
  })

  it('checklist shows at most two incomplete items; the full list opens in a sheet', async () => {
    const user = userEvent.setup()
    renderMobile()
    // Mock data: 4 items, 0 fully complete → overall count + first two only
    const card = screen.getByRole('region', { name: 'This Week’s Checklist' })
    expect(within(card).getByText('0 of 4 complete')).toBeInTheDocument()
    expect(within(card).getByText('Weekly Focus: 2 of 5 days')).toBeInTheDocument()
    expect(within(card).getByText('Lesson Plans')).toBeInTheDocument()
    expect(within(card).queryByText('Record of Work')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /View full checklist/ }))
    const sheet = screen.getByRole('dialog', { name: 'This Week’s Checklist' })
    expect(within(sheet).getByText('Record of Work')).toBeInTheDocument()
    expect(within(sheet).getByText('Worksheets')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'This Week’s Checklist' })).not.toBeInTheDocument()
  })

  it('AI recommendation is collapsed; tapping opens the detail sheet with actions', async () => {
    const user = userEvent.setup()
    renderMobile()
    // Collapsed: title + count badge visible, full text NOT rendered
    expect(screen.getByText('Mathematics is not planned yet')).toBeInTheDocument()
    expect(screen.queryByText(/Create a Scheme of Work using the Grade 4 syllabus/)).not.toBeInTheDocument()

    await user.click(screen.getByText('Mathematics is not planned yet'))
    const sheet = screen.getByRole('dialog', { name: 'AI Recommendation' })
    expect(within(sheet).getByText(/Create a Scheme of Work using the Grade 4 syllabus/)).toBeInTheDocument()
    const create = within(sheet).getByRole('link', { name: /Create Scheme/ })
    expect(create).toHaveAttribute('href', '/teacher/generate/scheme-of-work')
    expect(within(sheet).getByRole('button', { name: /Remind me later/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /Dismiss/ })).toBeInTheDocument()
  })

  it('dismissing the recommendation hides it and remembers per device', async () => {
    const user = userEvent.setup()
    renderMobile()
    await user.click(screen.getByText('Mathematics is not planned yet'))
    const sheet = screen.getByRole('dialog', { name: 'AI Recommendation' })
    await user.click(within(sheet).getByRole('button', { name: /Dismiss/ }))
    expect(screen.queryByText('Mathematics is not planned yet')).not.toBeInTheDocument()
    expect(screen.getByText('You’re all caught up')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(REC_HIDDEN_KEY))
    expect(stored['scheme-mathematics']).toBe('dismissed')
  })

  it('the plus button opens the Quick Create sheet with the four creation flows', async () => {
    const user = userEvent.setup()
    renderMobile()
    await user.click(screen.getByRole('button', { name: 'Quick create' }))
    const sheet = screen.getByRole('dialog', { name: 'Quick Create' })
    const expected = [
      ['Lesson Plans', '/teacher/lesson-plans/new'],
      ['Worksheets', '/teacher/generate/worksheet'],
      ['Assessments', '/teacher/assessment-papers/new'],
      ['Weekly Focus', '/teacher/generate/weekly-forecast'],
    ]
    for (const [label, href] of expected) {
      const link = within(sheet).getByText(label).closest('a')
      expect(link).toHaveAttribute('href', href)
    }
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Quick Create' })).not.toBeInTheDocument()
  })

  it('All Teacher Tools opens the full-screen launcher with categories and search', async () => {
    const user = userEvent.setup()
    renderMobile()
    await user.click(screen.getByText('Explore all studios and resources'))
    const toolsScreen = screen.getByRole('dialog', { name: 'All Teacher Tools' })
    // Grouped categories from the canonical registry
    for (const cat of ['Planning', 'Teaching Materials', 'Assessment', 'Planning & Setup']) {
      expect(within(toolsScreen).getByRole('tab', { name: cat })).toBeInTheDocument()
    }
    expect(within(toolsScreen).getByLabelText('Search teacher tools')).toBeInTheDocument()
    // Routes preserved — e.g. Class Register still points at /teacher/attendance
    const register = within(toolsScreen).getByRole('link', { name: /Class Register/ })
    expect(register).toHaveAttribute('href', '/teacher/attendance')

    // Search narrows the grid
    await user.type(within(toolsScreen).getByLabelText('Search teacher tools'), 'rubric')
    expect(within(toolsScreen).getByRole('link', { name: /Rubrics/ })).toBeInTheDocument()
    expect(within(toolsScreen).queryByRole('link', { name: /Class Register/ })).not.toBeInTheDocument()

    // Back button returns to the dashboard
    await user.click(within(toolsScreen).getByRole('button', { name: 'Back to dashboard' }))
    expect(screen.queryByRole('dialog', { name: 'All Teacher Tools' })).not.toBeInTheDocument()
  })

  it('shows at most four recently used tools', () => {
    renderMobile()
    const region = screen.getByRole('region', { name: /Recently Used/i })
    expect(region.querySelectorAll('.tdv2m-recent-tool').length).toBeLessThanOrEqual(4)
  })

  it('with real recent visits, shows only those — never padded with defaults', () => {
    // Two genuine visits on this device (anon recents store). "Recently Used"
    // must reflect exactly the activity signal, not top up to four with
    // studios the teacher has never opened.
    localStorage.setItem(
      'zedexams:teacher-recents:anon',
      JSON.stringify({ ids: ['rubrics', 'homework'], at: { rubrics: 2, homework: 1 } }),
    )
    renderMobile()
    const region = screen.getByRole('region', { name: /Recently Used/i })
    expect(region.querySelectorAll('.tdv2m-recent-tool').length).toBe(2)
    // A default like the Assessment Paper Studio must NOT appear when real
    // recents exist.
    expect(within(region).queryByRole('link', { name: /Assessment Paper Studio/ })).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { level: 1, name: /Mahenga/ })).toBeInTheDocument()
  })
})
