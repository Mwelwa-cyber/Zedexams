/**
 * Behaviour tests for the rebuilt learner home (LearnerHomePage) and its
 * shell. The view-model hook is stubbed with fixture data so these
 * exercise the render contract: approved section order presence,
 * greeting/meta, real-data-only rendering (no fake values), empty
 * states, Today's-Exams conditional visibility, and the bottom-nav
 * information architecture (Games present, Profile absent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockAuth = {
  currentUser: { uid: 'learner-1', emailVerified: true },
  userProfile: { id: 'learner-1', displayName: 'Lydia Mwansa', grade: '7', avatarCharacter: null },
  logout: vi.fn(),
  isAdmin: false,
  isTeacher: false,
}
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))

// The header chrome bar reads the app-wide notification feed and the theme.
// Both hooks throw without their provider by design, so stub them here the
// same way AuthContext is stubbed above.
const mockNotifications = { unreadCount: 3, open: false, setOpen: vi.fn() }
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => mockNotifications,
}))
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'oatmeal', setTheme: vi.fn() }),
  DEFAULT_THEME: 'oatmeal',
}))

let mockDashboard
vi.mock('../hooks/useLearnerDashboard', () => ({
  default: () => mockDashboard,
}))

import LearnerHomePage from './LearnerHomePage'
import LearnerLayout from '../components/LearnerLayout'

const baseData = {
  activeTerm: { term: 2, source: 'calendar' },
  paperResume: {
    paperId: 'p1', title: 'Mathematics Paper 1', year: 2024, subject: 'mathematics', page: 6, totalPages: 12,
  },
  papersMeta: { count: 40, yearMin: 2016, yearMax: 2025 },
  learningResume: {
    kind: 'note', id: 'n1', title: 'The Human Body — Respiratory System',
    subject: 'science', subjectLabel: 'Integrated Science', grade: '7', percent: 57, openedAt: 1,
  },
  todaysExams: {
    exams: [
      { examId: 'e1', subject: 'science', questionCount: 15, durationMinutes: 12 },
      { examId: 'e2', subject: 'mathematics', questionCount: 20, durationMinutes: 15 },
    ],
    locks: { mathematics: { status: 'submitted' } },
  },
  subjects: [
    { id: 'science', label: 'Integrated Science', topicCount: 5, percent: 57, hasMaterial: true },
    { id: 'mathematics', label: 'Mathematics', topicCount: 6, percent: 82, hasMaterial: true },
  ],
  recentActivity: [
    { type: 'quiz_completed', sourceId: 'q1', attemptId: 'a1', completedAt: Date.now() - 3600_000, title: 'The Solar System Quiz', subjectLabel: 'Integrated Science', score: 79, href: '/results/a1', icon: 'quiz' },
  ],
  recommendations: [
    { id: 'weak:mathematics:Fractions', kind: 'practice', title: 'Improve in Fractions', subject: 'mathematics', subjectLabel: 'Mathematics', grade: '7', reason: 'You scored 40% in Fractions — a focused practice can lift it.' },
  ],
  streak: 3,
  xp: 120,
  gameChallenge: null,
  notesCount: 12,
  lessonsCount: 4,
}

function renderHome() {
  // Rendered through the layout route, the way App.jsx mounts it — the
  // shell chrome (nav, page column) belongs to LearnerLayout now.
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<LearnerLayout />}>
          <Route path="/dashboard" element={<LearnerHomePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockDashboard = {
    loading: false,
    error: null,
    data: baseData,
    grade: '7',
    learner: mockAuth.userProfile,
    timetables: { active: null, archived: [], loading: false, error: null },
    setPreferredTerm: vi.fn(),
    refresh: vi.fn(),
  }
})

describe('LearnerHomePage', () => {
  it('greets the learner by first name with the Grade · Term chip and no curriculum label', () => {
    renderHome()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toMatch(/Hi, Lydia!/)
    expect(within(header).getByText(/Grade 7\s+·\s+Term 2/)).toBeInTheDocument()
    // The old header hardcoded "CBC" — wrong for Grade 7 (frameworks:
    // ['2013']) — and the prototype chip carries Grade · Term only.
    expect(within(header).queryByText(/CBC/)).toBeNull()
  })

  it('renders the Past Papers hero with the real resume data', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'Past Papers' })).toBeInTheDocument()
    expect(screen.getByText('ECZ Papers · 2016–2025')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue Reading' })).toBeInTheDocument()
    expect(screen.getByText('Mathematics Paper 1 · 2024')).toBeInTheDocument()
    expect(screen.getByText('Page 6 of 12')).toBeInTheDocument()
  })

  it('hides Continue Reading when no paper has been opened', () => {
    mockDashboard.data = { ...baseData, paperResume: null }
    renderHome()
    expect(screen.getByRole('button', { name: 'Browse Papers' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue Reading' })).toBeNull()
  })

  it('shows the Continue Learning resume with subject, term and progress', () => {
    renderHome()
    expect(screen.getByText('Integrated Science · Term 2')).toBeInTheDocument()
    expect(screen.getByText('The Human Body — Respiratory System')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue Notes' })).toBeInTheDocument()
    const card = screen.getByText('The Human Body — Respiratory System').closest('section')
    expect(within(card).getByText('57%')).toBeInTheDocument()
  })

  it('shows the Continue Learning empty state with no resume signal', () => {
    mockDashboard.data = { ...baseData, learningResume: null }
    renderHome()
    expect(screen.getByText('Choose a subject to begin learning.')).toBeInTheDocument()
  })

  it("shows Today's Exams only when exams are open, with real counts", () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'Today’s Exams' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2 completed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Next Exam' })).toBeInTheDocument()
  })

  it("renders no Today's Exams card when none are open", () => {
    mockDashboard.data = { ...baseData, todaysExams: { exams: [], locks: {} } }
    renderHome()
    expect(screen.queryByText('Today’s Exams')).toBeNull()
  })

  it('shows subject rows with term-scoped progress', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'My Subjects' }).closest('section')
    expect(within(section).getByText('Integrated Science')).toBeInTheDocument()
    expect(within(section).getByText('82%')).toBeInTheDocument()
  })

  it('states the timetable has not been published when data is missing', () => {
    renderHome()
    expect(screen.getByText('The examination timetable has not been published yet.')).toBeInTheDocument()
  })

  it('renders recommendations with their reasons', () => {
    renderHome()
    expect(screen.getByText('Improve in Fractions')).toBeInTheDocument()
    expect(screen.getByText(/You scored 40% in Fractions/)).toBeInTheDocument()
  })

  it('shows the recent-activity empty state message', () => {
    mockDashboard.data = { ...baseData, recentActivity: [] }
    renderHome()
    expect(screen.getByText('Your completed lessons, quizzes and papers will appear here.')).toBeInTheDocument()
  })

  it('bottom navigation has the four prototype tabs and no Profile', () => {
    renderHome()
    const nav = screen.getByRole('navigation', { name: 'Learner navigation' })
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(labels).toEqual(['Home', 'Papers', 'Notes', 'Games'])
    expect(labels).not.toContain('Profile')
    // Learn and Practice tabs are gone (locked scope); their routes stay
    // reachable elsewhere until step 5 retires them.
    expect(labels).not.toContain('Learn')
    expect(labels).not.toContain('Practice')
  })

  it('marks the active bottom-navigation item with aria-current', () => {
    renderHome()
    const nav = screen.getByRole('navigation', { name: 'Learner navigation' })
    const active = nav.querySelector('a[aria-current="page"]')
    expect(active).not.toBeNull()
    expect(active.textContent).toBe('Home')
  })

  it('topbar carries the Night toggle, streak pill and Alerts', () => {
    renderHome()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('button', { name: /switch to night mode/i })).toBeInTheDocument()
    expect(within(header).getByLabelText('3 day streak')).toBeInTheDocument()
    // Unread count is surfaced to assistive tech, not just as a dot.
    expect(within(header).getByRole('button', { name: 'Alerts, 3 unread' })).toBeInTheDocument()
  })

  it('profile opens from the topbar avatar button', () => {
    renderHome()
    const account = screen.getByRole('button', { name: /account menu for Lydia Mwansa/i })
    expect(account).toBeInTheDocument()
    // Profile is absent from the bottom navigation by design, so the
    // avatar affordance has to live here.
    expect(account.classList.contains('lhx-avatar-btn')).toBe(true)
  })

  it('shows a retryable error state when the dashboard load fails', () => {
    mockDashboard.error = new Error('boom')
    mockDashboard.data = null
    renderHome()
    expect(screen.getByText(/couldn’t load your dashboard/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
