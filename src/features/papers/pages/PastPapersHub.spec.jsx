/**
 * The public past-paper hub, and the one card on it that is not public.
 *
 * `/papers` is unguarded and mounts the learner shell, so a teacher browsing
 * the archive sees this page. Above the paper list it drew a full-width
 * gradient "2026 Exam Timetable" card linking to `/timetable` — a
 * `<LearnerOnlyRoute>` page — so tapping it answered a teacher with "Teacher
 * accounts stay in the teacher portal". It is the same defect as the learner
 * tab bar's Home tab, in ordinary page content rather than a nav registry,
 * which is why the tab bar's fix left it standing.
 *
 * The card is DROPPED for a refused account rather than retargeted: unlike
 * Home, there is no teacher equivalent of the learner exam timetable to point
 * at, and it is supplementary content beside the list rather than the way out
 * of the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({
  default: {},
  auth: {},
  db: {},
  whenAppCheckReady: () => Promise.resolve(),
}))

const mockAuth = { currentUser: null, userProfile: null }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

// A live timetable with a session still ahead, so the card's own reasons to
// hide (no timetable, exams finished) are out of the way and the only thing
// under test is the audience.
vi.mock('../../../hooks/useExamTimetables', () => ({
  default: () => ({
    active: {
      year: 2026,
      board: 'ECZ',
      startsAt: '2026-10-26T08:00:00+02:00',
      endsAt: '2026-10-30T12:00:00+02:00',
      papers: [{ subject: 'Mathematics', start: '2100-10-26T08:00:00+02:00' }],
    },
    loading: false,
  }),
}))
vi.mock('../../../utils/examTimetableLogic', () => ({
  getNextPaperSession: () => ({ start: '2100-10-26T08:00:00+02:00', subject: 'Mathematics' }),
}))
vi.mock('../../../utils/pastPapers', () => ({
  PAPER_GRADES: [7],
  getCachedPublishedPapers: () => [],
  loadPublishedPapers: () => Promise.resolve([]),
}))

import PastPapersHub from './PastPapersHub'

const timetableCard = () => screen.queryByText(/2026 Exam Timetable/i)

function mount() {
  render(
    <MemoryRouter initialEntries={['/papers']}>
      <PastPapersHub />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockAuth.currentUser = null
  mockAuth.userProfile = null
})

describe('PastPapersHub exam-timetable card', () => {
  it('is hidden from a teacher, who cannot open /timetable', async () => {
    mockAuth.currentUser = { uid: 'u1' }
    mockAuth.userProfile = { role: 'teacher' }
    mount()
    // Wait for the page itself, so absence is measured on a settled render
    // rather than on the frame before the card would have appeared.
    await screen.findByRole('heading', { name: /Grade \d+ Past Papers/i })
    expect(timetableCard()).not.toBeInTheDocument()
  })

  it('is shown to a learner', async () => {
    mockAuth.currentUser = { uid: 'u1' }
    mockAuth.userProfile = { role: 'learner' }
    mount()
    await screen.findByRole('heading', { name: /Grade \d+ Past Papers/i })
    await waitFor(() => expect(timetableCard()).toBeInTheDocument())
    expect(timetableCard().closest('a')).toHaveAttribute('href', '/timetable')
  })

  it('is shown to a signed-out visitor, whose sign-in returns them to it', async () => {
    mount()
    await waitFor(() => expect(timetableCard()).toBeInTheDocument())
  })
})
