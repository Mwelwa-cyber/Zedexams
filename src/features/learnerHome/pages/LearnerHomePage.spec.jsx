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
// Today's Quiz card fetches its own state through the ONE daily-quiz read
// path rather than from the dashboard view-model, so the spec drives it here.
const mockDaily = { payload: null, error: null }
vi.mock('../../dailyQuiz', async () => {
  const core = await vi.importActual('../../dailyQuiz/lib/dailyQuizCore.js')
  return {
    ...core,
    getTodaysQuiz: vi.fn(async () => {
      if (mockDaily.error) throw mockDaily.error
      return mockDaily.payload
    }),
  }
})
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
    { id: 'science', label: 'Integrated Science', topicCount: 5, percent: 57, started: true, hasMaterial: true },
    { id: 'mathematics', label: 'Mathematics', topicCount: 6, percent: 82, started: true, hasMaterial: true },
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
        <Route path="/daily" element={<div>DAILY ROUTE</div>} />
        <Route path="/daily/leaderboard" element={<div>LEADERBOARD ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Default: a ready ranked quiz. Individual tests override.
  mockDaily.payload = {
    ranked: true, grade: '7', alreadyPlayed: false,
    questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
  }
  mockDaily.error = null
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

  it('renders THREE Explore tiles — no Timetable', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'Explore' }).closest('section')
    const tiles = Array.from(section.querySelectorAll('.lhx-tile .lhx-tile-name')).map((n) => n.textContent)
    expect(tiles).toEqual(['Past Papers', 'Notes', 'Games'])
  })

  it('the timetable is reached from the countdown card, not a second Explore tile', () => {
    // Two doors to one room, a scroll apart, is clutter. The countdown
    // card sits directly above Explore and already opens the timetable.
    renderHome()
    expect(screen.queryByRole('button', { name: /Timetable — Exam dates/i })).toBeNull()
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

  it("shows Today's Quiz and opens the runner", async () => {
    mockDaily.payload = {
      ranked: true, grade: '7', alreadyPlayed: false,
      questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    }
    renderHome()
    expect(await screen.findByText(/5 questions · once a day/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Today’s Quiz'))
    expect(screen.getByText('DAILY ROUTE')).toBeInTheDocument()
  })

  it("Today's Quiz flips to the leaderboard once it has been played", async () => {
    mockDaily.payload = {
      ranked: true, grade: '7', alreadyPlayed: true,
      questions: [{ id: 'a' }],
      result: { credited: 4, total: 5, points: 40, ranked: true },
    }
    renderHome()
    expect(await screen.findByText(/4 out of 5 · \+40 points/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Today’s Quiz'))
    expect(screen.getByText('LEADERBOARD ROUTE')).toBeInTheDocument()
  })

  it('offers a labelled practice set when the bank is too thin to rank', async () => {
    // The ONLY honest empty state. "No quiz today" with nothing to tap is
    // what this whole feature replaced, so the card must never render it.
    mockDaily.payload = {
      ranked: false, grade: '7', alreadyPlayed: false,
      questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    }
    renderHome()
    expect(await screen.findByText(/don’t count towards the board/)).toBeInTheDocument()
    expect(screen.queryByText(/No quiz today/)).toBeNull()
    fireEvent.click(screen.getByText('Practise five'))
    expect(screen.getByText('DAILY ROUTE')).toBeInTheDocument()
  })

  it('a failed read is honest, and still goes somewhere real', async () => {
    // The card used to read the daily-exam picker's output directly, so an
    // empty or unreadable day rendered "No quiz today — see the ones you've
    // done" with nothing behind it. A failed call is not evidence that there
    // is nothing to play, and it must not be reported as if it were.
    mockDaily.payload = null
    mockDaily.error = new Error('offline')
    renderHome()
    expect(await screen.findByText(/We could not load it just now/)).toBeInTheDocument()
    expect(screen.queryByText(/No quiz today/)).toBeNull()
    fireEvent.click(screen.getByText('Today’s Quiz'))
    expect(screen.getByText('DAILY ROUTE')).toBeInTheDocument()
  })

  it('shows subject rows with term-scoped progress once started', () => {
    renderHome()
    const section = screen.getByRole('heading', { name: 'My subjects' }).closest('section')
    expect(within(section).getByText('Integrated Science')).toBeInTheDocument()
    expect(within(section).getByText('82%')).toBeInTheDocument()
  })

  it('a subject nobody has opened shows no percentage and no bar', () => {
    // "0%" beside an empty bar is not a measurement — it is five subjects'
    // worth of zeroes to read past to find the one that was started.
    mockDashboard.data = {
      ...baseData,
      subjects: [
        { id: 'english', label: 'English', topicCount: 7, percent: 0, started: false },
        { id: 'science', label: 'Integrated Science', topicCount: 3, percent: 82, started: true },
      ],
    }
    renderHome()
    const section = screen.getByRole('heading', { name: 'My subjects' }).closest('section')
    const englishRow = within(section).getByText('English').closest('button')
    expect(within(englishRow).queryByText('0%')).toBeNull()
    expect(englishRow.querySelector('[role="progressbar"]')).toBeNull()
    // The started one is unaffected.
    const sciRow = within(section).getByText('Integrated Science').closest('button')
    expect(within(sciRow).getByText('82%')).toBeInTheDocument()
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
