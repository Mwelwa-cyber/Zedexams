/**
 * Behaviour tests for the learner home (LearnerHomePage) and its shell.
 * The view-model hook is stubbed with fixture data so these exercise the
 * render contract: the mockup's section list and NOTHING ELSE, the
 * greeting/meta, real-data-only rendering (no fake values), empty
 * states, and the bottom-nav information architecture (Games present,
 * Profile absent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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
import { PSLE_2026 } from '../../../config/examTimetable2026'

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
        {/* Stub destinations — the v6 topbar bell/avatar NAVIGATE. */}
        <Route path="/profile" element={<div>PROFILE ROUTE</div>} />
        <Route path="/notifications" element={<div>NOTIFICATIONS ROUTE</div>} />
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

  it('is EXACTLY the mockup\u2019s sections, in order, and nothing else', () => {
    mockDashboard.timetables = { active: PSLE_2026, archived: [], loading: false, error: null }
    mockDashboard.data = { ...baseData, gameChallenge: { id: 'g1', title: 'Number Path', grade: 7 } }
    renderHome()
    // Every section heading the page renders, top to bottom.
    const headings = Array.from(document.querySelectorAll('main h2, h2')).map((h) => h.textContent.trim())
    expect(headings).toEqual(['Explore', 'My subjects'])
    // The sections earlier passes carried over from the old dashboard —
    // none of them is in prototype v3\u2013v6, so none may come back.
    for (const gone of ['Quick Access', 'Recommended for You', 'Recent Activity', 'My Achievements', 'Today\u2019s Exams']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })

  it('Explore has the mockup\u2019s four tiles and no Lessons or Quizzes', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'Explore' }).closest('section')
    const tiles = Array.from(section.querySelectorAll('a'))
    expect(tiles.map((a) => a.getAttribute('href'))).toEqual(['/papers', '/notes', '/games', '/timetable'])
    expect(tiles.map((a) => a.querySelector('.lhx-tile-name').textContent))
      .toEqual(['Past Papers', 'Notes', 'Games', 'Timetable'])
    // The retired Quick Access grid linked both of these; the mockup has
    // neither anywhere on Home.
    expect(document.querySelector('a[href="/quizzes"]')).toBeNull()
    expect(document.querySelector('a[href="/lessons"]')).toBeNull()
  })

  it("shows the Today's Quiz slim card when a daily challenge exists", () => {
    mockDashboard.data = { ...baseData, gameChallenge: { id: 'g1', title: 'Number Path', grade: 7 } }
    renderHome()
    const card = screen.getByText('Today\u2019s Quiz').closest('button')
    expect(card.classList.contains('lhx-daily-slim')).toBe(true)
    expect(within(card).getByText(/keep your 3-day/)).toBeInTheDocument()
    expect(within(card).getByText('Play')).toBeInTheDocument()
  })

  it("renders no Today's Quiz card when there is no daily challenge", () => {
    renderHome() // baseData.gameChallenge is null
    expect(screen.queryByText('Today\u2019s Quiz')).toBeNull()
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
    expect(screen.getByText('Choose a subject below to begin learning.')).toBeInTheDocument()
  })

  it('shows every subject the grade takes, even ones with nothing published', () => {
    // The list used to be filtered to subjects that already had material,
    // so a learner saw one card where the mockup shows seven, and the
    // list changed shape as content landed.
    mockDashboard.data = {
      ...baseData,
      subjects: [
        { id: 'english', label: 'English', topicCount: 6, percent: 0, hasMaterial: false },
        { id: 'mathematics', label: 'Mathematics', topicCount: 13, percent: 40, hasMaterial: true },
        { id: 'science', label: 'Integrated Science', topicCount: 5, percent: 0, hasMaterial: false },
      ],
    }
    renderHome()
    const section = screen.getByRole('heading', { name: 'My subjects' }).closest('section')
    for (const label of ['English', 'Mathematics', 'Integrated Science']) {
      expect(within(section).getByText(label)).toBeInTheDocument()
    }
  })

  it('shows subject rows with term-scoped progress', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'My subjects' }).closest('section')
    expect(within(section).getByText('Integrated Science')).toBeInTheDocument()
    expect(within(section).getByText('82%')).toBeInTheDocument()
  })

  it('shows the coral exam-countdown CARD when a timetable is published', () => {
    // Countdown target is the first sat paper (English, Tue 27 Oct 08:00).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-09-01T10:00:00+02:00')))
    mockDashboard.timetables = { active: PSLE_2026, archived: [], loading: false, error: null }
    renderHome()
    const card = screen.getByRole('button', { name: /exams in 55 days/i })
    // The mockup's card, not the chip an earlier pass shrank it to.
    expect(card.classList.contains('lhx-exam-card')).toBe(true)
    expect(within(card).getByText('EXAMS ARE COMING')).toBeInTheDocument()
    expect(within(card).getByText('55')).toBeInTheDocument()
    expect(within(card).getByText('DAYS')).toBeInTheDocument()
    expect(within(card).getByText(/First paper: Tue 27 Oct · English Language 1\/1/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('renders no countdown at all without a published timetable', () => {
    renderHome()
    expect(screen.queryByRole('button', { name: /exams in/i })).toBeNull()
    expect(document.querySelector('.lhx-exam-card')).toBeNull()
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

  it('the topbar avatar navigates to the Profile view (prototype-v6)', () => {
    renderHome()
    const account = screen.getByRole('button', { name: /my profile, Lydia Mwansa/i })
    expect(account).toBeInTheDocument()
    // Profile is absent from the bottom navigation by design, so the
    // avatar affordance has to live here.
    expect(account.classList.contains('lhx-avatar-btn')).toBe(true)
    fireEvent.click(account)
    expect(screen.getByText('PROFILE ROUTE')).toBeInTheDocument()
  })

  it('the topbar bell navigates to the Notifications view (prototype-v6)', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Alerts, 3 unread' }))
    expect(screen.getByText('NOTIFICATIONS ROUTE')).toBeInTheDocument()
  })

  it('shows a retryable error state when the dashboard load fails', () => {
    mockDashboard.error = new Error('boom')
    mockDashboard.data = null
    renderHome()
    expect(screen.getByText(/couldn’t load your dashboard/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
