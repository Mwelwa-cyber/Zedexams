/**
 * Behaviour tests for the learner home (LearnerHomePage) and its shell.
 * The view-model hook is stubbed with fixture data so these exercise the
 * render contract: the prototype's five blocks in its order, greeting/
 * meta, real-data-only rendering (no fake values), empty states, the
 * conditional countdown and Today's-Quiz cards, and the bottom-nav
 * information architecture (Games present, Profile absent).
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
  streak: 3,
  xp: 120,
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
        <Route path="/timetable" element={<div>TIMETABLE ROUTE</div>} />
        <Route path="/exam/:examId" element={<div>EXAM ROUTE</div>} />
        <Route path="/exams/leaderboard" element={<div>LEADERBOARD ROUTE</div>} />
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

  it('renders the four Explore tiles in the prototype order', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'Explore' }).closest('section')
    const tiles = Array.from(section.querySelectorAll('.lhx-tile .lhx-tile-name')).map((n) => n.textContent)
    expect(tiles).toEqual(['Past Papers', 'Notes', 'Games', 'Timetable'])
  })

  it('the Timetable tile opens the timetable', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: /Timetable — Exam dates/i }))
    expect(screen.getByText('TIMETABLE ROUTE')).toBeInTheDocument()
  })

  it('shows the Continue hero with subject, term and progress', () => {
    renderHome()
    expect(screen.getByText('CONTINUE WHERE YOU LEFT OFF')).toBeInTheDocument()
    expect(screen.getByText('The Human Body — Respiratory System')).toBeInTheDocument()
    expect(screen.getByText('Integrated Science · Term 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue learning/ })).toBeInTheDocument()
    // Progress is a real bar, not a number the card invented.
    const bar = screen.getByRole('progressbar', { name: /Respiratory System: 57% complete/ })
    expect(bar.firstChild.style.width).toBe('57%')
  })

  it('draws no progress bar when the resume has not been started', () => {
    mockDashboard.data = { ...baseData, learningResume: { ...baseData.learningResume, percent: 0 } }
    renderHome()
    expect(screen.queryByRole('progressbar', { name: /Respiratory System/ })).toBeNull()
  })

  it('shows the Continue Learning empty state with no resume signal', () => {
    mockDashboard.data = { ...baseData, learningResume: null }
    renderHome()
    expect(screen.getByText('Choose a subject below to begin learning.')).toBeInTheDocument()
  })

  it("shows Today's Quiz with what is left, and starts the next exam", () => {
    renderHome()
    expect(screen.getByText('Today’s Quiz')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 left · with Zed · keep your 🔥 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Today’s Quiz'))
    expect(screen.getByText('EXAM ROUTE')).toBeInTheDocument()
  })

  it("Today's Quiz flips to the leaderboard once every exam is done", () => {
    mockDashboard.data = {
      ...baseData,
      todaysExams: {
        exams: baseData.todaysExams.exams,
        locks: { mathematics: { status: 'submitted' }, science: { status: 'submitted' } },
      },
    }
    renderHome()
    expect(screen.getByText('Done for today ✓ · see the leaderboard')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Today’s Quiz'))
    expect(screen.getByText('LEADERBOARD ROUTE')).toBeInTheDocument()
  })

  it("renders no Today's Quiz card when no exam is open", () => {
    mockDashboard.data = { ...baseData, todaysExams: { exams: [], locks: {} } }
    renderHome()
    expect(screen.queryByText('Today’s Quiz')).toBeNull()
  })

  it('shows subject rows with term-scoped progress', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'My subjects' }).closest('section')
    expect(within(section).getByText('Integrated Science')).toBeInTheDocument()
    expect(within(section).getByText('82%')).toBeInTheDocument()
  })

  it('shows the countdown card naming the next paper when a timetable is published', () => {
    // Countdown target is the first sat paper (English, Tue 27 Oct 08:00).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-09-01T10:00:00+02:00')))
    mockDashboard.timetables = { active: PSLE_2026, archived: [], loading: false, error: null }
    renderHome()
    const card = screen.getByRole('button', { name: /2026 PSLE — 55 days to go/i })
    expect(card.classList.contains('lhx-exam-card')).toBe(true)
    expect(within(card).getByText('EXAMS ARE COMING')).toBeInTheDocument()
    // The card names the paper as well as counting the days — the chip it
    // replaced could only ever count.
    expect(within(card).getByText(/Next paper: Tue 27 Oct · English Language/)).toBeInTheDocument()
    expect(within(card).getByText('55')).toBeInTheDocument()
    fireEvent.click(card)
    expect(screen.getByText('TIMETABLE ROUTE')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('names the NEXT unsat paper mid-season, not the first of the week', () => {
    // Wednesday morning: English (Tue) is behind the learner. Naming it
    // would tell them to revise for a paper they already sat.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-10-28T06:00:00+02:00')))
    mockDashboard.timetables = { active: PSLE_2026, archived: [], loading: false, error: null }
    renderHome()
    expect(screen.queryByText(/English Language/)).toBeNull()
    expect(screen.getByText(/Next paper: Wed 28 Oct/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('renders no countdown card without a published timetable', () => {
    renderHome()
    expect(document.querySelector('.lhx-exam-card')).toBeNull()
    expect(screen.queryByText('The examination timetable has not been published yet.')).toBeNull()
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
