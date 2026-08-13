import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { TeacherLayout } from '../../teacherShell'
import TeacherDashboardLive from './TeacherDashboardLive'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 2, open: false, setOpen: () => {} }),
}))
// Pulls useTeacherUsage → firebase; plan reminders have their own tests.
vi.mock('../../../components/subscription/UsageReminderBanner', () => ({ default: () => null }))

const logout = vi.fn().mockResolvedValue()
// The mobile hero's plan badge is resolved from users.teacherPlan via the
// authoritative resolveTeacherPlan (the same entitlement StudioGate uses), so
// the profile carries a teacherPlan here.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    logout,
    isAdmin: false,
    currentUser: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
    userProfile: { teacherPlan: 'pro', displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
  }),
}))
// Reads Firestore; not under test here.
vi.mock('../../teacherShell/components/TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))

const hookData = {
  teacher: {
    name: 'Bwalya Chanda',
    firstName: 'Bwalya',
    shortName: 'Bwalya',
    initials: 'BC',
    role: 'Teacher',
    email: 'bwalya@example.com',
  },
  loading: false,
  termChip: '15 Jul — Term 2 • Week 10',
  lastOpened: { subject: 'Integrated Science', grade: 'Grade 4', ago: '2d ago', to: '/teacher/library/g1' },
  documents: [
    { id: 'g1', title: 'Living Things Lesson', meta: 'Lesson Plan • Grade 4 • Science', date: '2d ago', status: 'Ready', tool: 'lesson_plan', to: '/teacher/library/g1' },
  ],
  savedCounts: { scheme_of_work: 1, weekly_forecast: 0, lesson_plan: 4, record_of_work: 0 },
  checklist: [{ id: 'focus', label: 'Weekly Focus: 2 of 5 days prepared', done: 2, total: 5, to: '/x' }],
  feed: [{ id: 'feed-error', kind: 'error', title: 'Couldn’t load your library', body: 'Check your connection and try again.', retry: true }],
  activity: [{ id: 'g1', title: 'Lesson Plan created', meta: 'Lesson Plan • Grade 4', time: '2d ago', tool: 'lesson_plan', to: '/teacher/library/g1' }],
  recommendations: [
    { id: 'r1', title: 'Mathematics is not planned yet', text: 'Create a Scheme of Work.', actionLabel: 'Create Scheme', to: '/teacher/generate/scheme-of-work' },
    { id: 'r2', title: 'Record of Work needs updating', text: 'Log this week.', actionLabel: 'Update record', to: '/teacher/generate/record-of-work' },
  ],
  reload: vi.fn(),
}
vi.mock('../hooks/useTeacherDashboardData', () => ({
  default: () => hookData,
}))

function renderLive() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher']}>
        <Routes>
          {/* Composed exactly as the route does: the shell owns the sidebar,
              the account menu and logout; the page owns the content. */}
          <Route
            path="/teacher"
            element={(
              <TeacherLayout variant="dashboard">
                <TeacherDashboardLive />
              </TeacherLayout>
            )}
          />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('TeacherDashboardLive', () => {
  beforeEach(() => {
    logout.mockClear()
    hookData.reload.mockClear()
    // Suppress the first-run tour — covered in OnboardingTour.spec.jsx.
    localStorage.setItem('zedexams:tdv2-tour', 'done')
  })

  it('renders real data from the hook: greeting name, docs, counts, chip', () => {
    renderLive()
    expect(screen.getByRole('heading', { level: 1, name: 'Bwalya' })).toBeInTheDocument()
    // The classic desktop workspace shows studio cards with saved pills
    expect(screen.getByRole('region', { name: 'Teacher Workspace' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Lesson Plans.*Open studio$/)).toBeInTheDocument()
    expect(screen.getByText('4 SAVED')).toBeInTheDocument()
    // Recent Documents card is back on desktop
    expect(screen.getByText('Living Things Lesson')).toBeInTheDocument()
    expect(screen.getByText('15 Jul — Term 2 • Week 10')).toBeInTheDocument()
    expect(screen.getByText('Mathematics is not planned yet')).toBeInTheDocument()
    // Second recommendation renders as a compact row below the primary card
    expect(screen.getByText('Record of Work needs updating')).toBeInTheDocument()
    expect(screen.getByText('Weekly Focus: 2 of 5 days prepared')).toBeInTheDocument()
    // No preview chrome on the live dashboard
    expect(screen.queryByText(/Preview Mode/)).not.toBeInTheDocument()
  })

  it('feed Retry re-runs the library fetch', async () => {
    const user = userEvent.setup()
    renderLive()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(hookData.reload).toHaveBeenCalledTimes(1)
  })

  it('logs out only after confirmation, then lands on /login', async () => {
    const user = userEvent.setup()
    renderLive()
    await user.click(screen.getByRole('button', { name: /Bwalya Chanda/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(logout).not.toHaveBeenCalled()

    const dialog = screen.getByRole('alertdialog', { name: 'Log out of ZedExams?' })
    await user.click(within(dialog).getByRole('button', { name: 'Log out' }))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })
})
