import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useExamTimetables from '../../../hooks/useExamTimetables'
import { PSLE_2026 } from '../../../config/examTimetable2026'
import ExamTimetablePage from './ExamTimetablePage.jsx'

// The page under test owns the season logic + rendering; everything with a
// Firebase dependency is mocked. Times are pinned with fake timers so each
// season phase (before / during / after) is reproducible.
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../hooks/useExamTimetables', () => ({ default: vi.fn() }))
vi.mock('../../../components/layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => false }))

const ARCHIVED_2025 = {
  ...PSLE_2026,
  id: 'g7-2025',
  year: 2025,
  shortName: '2025 PSLE',
  active: false,
}

function setData(overrides = {}) {
  useExamTimetables.mockReturnValue({
    active: PSLE_2026,
    archived: [],
    loading: false,
    error: null,
    usedFallback: true,
    ...overrides,
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/timetable']}>
      <ExamTimetablePage />
    </MemoryRouter>,
  )
}

const at = (iso) => vi.setSystemTime(new Date(Date.parse(iso)))

// Day-group headers are buttons named by their date heading.
const dayHeader = (re) => screen.getByRole('button', { name: re })

describe('ExamTimetablePage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    at('2026-09-01T10:00:00+02:00')
    useAuth.mockReturnValue({ currentUser: { uid: 'u1' }, userProfile: { grade: 7 } })
    setData()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows loading skeletons while the timetable loads', () => {
    setData({ active: null, loading: true })
    const { container } = renderPage()
    expect(container.querySelector('.zx-sk')).toBeTruthy()
    expect(screen.queryByText(/starts in/i)).not.toBeInTheDocument()
  })

  it('BEFORE the season: countdown hero, exam progress, and the next exam', () => {
    renderPage()
    expect(screen.getByText('Primary School Leaving Examination')).toBeInTheDocument()
    expect(screen.getByText(/starts in/i)).toBeInTheDocument()
    expect(screen.getByText('Days')).toBeInTheDocument()
    expect(screen.getByText('Exam Progress')).toBeInTheDocument()
    expect(screen.getByText('0 / 8 Papers Completed')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    // Next Exam panel features the first paper (not the briefing day).
    expect(screen.getByText('Next Exam')).toBeInTheDocument()
    expect(screen.getAllByText('English Language').length).toBeGreaterThan(0)
  })

  it('collapses every day except the next exam day; tapping expands', () => {
    renderPage()
    // The next exam day (Tue 27) starts open — its cards carry status pills.
    expect(screen.getByText('Paper 1/1')).toBeInTheDocument()
    expect(screen.getByText('Next')).toBeInTheDocument() // eng-p1 is the next paper
    // Wednesday's cards are collapsed to a summary row…
    expect(screen.queryByText('Paper 3/1')).not.toBeInTheDocument()
    // …until the learner taps the day header.
    fireEvent.click(dayHeader(/Wednesday, 28 October/i))
    expect(screen.getByText('Paper 3/1')).toBeInTheDocument()
    // Tapping again collapses it.
    fireEvent.click(dayHeader(/Wednesday, 28 October/i))
    expect(screen.queryByText('Paper 3/1')).not.toBeInTheDocument()
  })

  it('DURING a paper: live time remaining, In Progress + Today highlighting', () => {
    at('2026-10-27T08:30:00+02:00') // 30 min into English Language
    renderPage()
    expect(screen.getByText("Today's Examination")).toBeInTheDocument()
    expect(screen.getByText(/time remaining/i)).toBeInTheDocument()
    expect(screen.getByText('01:00:00')).toBeInTheDocument() // ends 09:30
    expect(screen.getByText('Next Examination')).toBeInTheDocument()
    expect(screen.getAllByText('Integrated Science').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
    // Today's day group is expanded automatically and flagged.
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0)
  })

  it('AFTER the season: congratulations + all five resource links, never empty', () => {
    at('2026-11-05T10:00:00+02:00')
    renderPage()
    expect(
      screen.getByText(/2026 Primary School Leaving Examination Completed/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /past papers/i })).toHaveAttribute(
      'href',
      '/papers?grade=7',
    )
    const notesLinks = screen.getAllByRole('link', { name: /revision notes/i })
    expect(notesLinks.some((l) => l.getAttribute('href') === '/notes')).toBe(true)
    expect(screen.getByRole('link', { name: /practice quizzes/i })).toHaveAttribute(
      'href',
      '/quizzes',
    )
    expect(screen.getByRole('link', { name: /mock examinations/i })).toHaveAttribute(
      'href',
      '/exams',
    )
    expect(screen.getByRole('link', { name: /grade 8 bridge lessons/i })).toHaveAttribute(
      'href',
      '/lessons',
    )
  })

  it('search expands and filters the day cards by subject', () => {
    renderPage()
    // Wednesday is collapsed before searching.
    expect(screen.queryByText('Paper 3/1')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: /search subjects/i }), {
      target: { value: 'math' },
    })
    // The search text is debounced before it drives filtering.
    act(() => { vi.advanceTimersByTime(200) })
    // The matching day auto-expands; non-matching days are pruned.
    expect(screen.getAllByText('Mathematics').length).toBeGreaterThan(0)
    expect(screen.getByText('Paper 3/1')).toBeInTheDocument()
    expect(screen.queryByText('Paper 1/1')).not.toBeInTheDocument()
  })

  it('keeps Practice Quiz + Past Paper visible and folds the rest into More', () => {
    renderPage()
    // Tuesday (next exam day) is open: English card shows the two primaries.
    expect(screen.getAllByRole('link', { name: 'Practice Quiz' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Past Paper' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Mock Exam' })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /more/i })[0])
    expect(screen.getByRole('link', { name: 'Revision Notes' })).toHaveAttribute('href', '/notes')
    expect(screen.getByRole('link', { name: 'Mock Exam' })).toHaveAttribute('href', '/exams')
    expect(screen.getByRole('link', { name: 'Study Plan' })).toHaveAttribute('href', '/study-plan')
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument()
  })

  it('language day: only the tapped language expands its actions', () => {
    renderPage()
    // Collapse the default-open Tuesday so its Practice Quiz links don't
    // shadow the language ones we assert on below.
    fireEvent.click(dayHeader(/Tuesday, 27 October/i))
    fireEvent.click(dayHeader(/Friday, 30 October/i))
    expect(screen.getByText('Choose Your Zambian Language')).toBeInTheDocument()
    // Nothing expanded yet → no per-language actions.
    expect(screen.queryByRole('link', { name: 'Revision Notes' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Cinyanja/i }))
    expect(screen.getByRole('link', { name: 'Practice Quiz' })).toHaveAttribute(
      'href',
      '/practise/7/cinyanja',
    )
    expect(screen.getByRole('link', { name: 'Past Paper' })).toHaveAttribute(
      'href',
      '/papers?grade=7&subject=cinyanja',
    )
    expect(screen.getByRole('link', { name: 'Revision Notes' })).toBeInTheDocument()
    // The pick persists per device, scoped by timetable id (keys like 'zl'
    // repeat across years).
    expect(localStorage.getItem('zx_exam_paper_choice_g7-2026_zl')).toBe('5/1')
    // Selecting another language moves the expansion, it does not stack.
    fireEvent.click(screen.getByRole('button', { name: /Icibemba/i }))
    expect(screen.queryByRole('link', { name: 'Practice Quiz' })).not.toBeInTheDocument()
  })

  it('reminder offsets hide behind the Enable Exam Reminders switch', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: '1 day before' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: /enable exam reminders/i }))
    // Enabling pre-selects "1 day before" and persists per learner + timetable.
    expect(screen.getByRole('button', { name: '1 day before' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: '1 hour before' }))
    const stored = JSON.parse(localStorage.getItem('zx_exam_reminders_u1_g7-2026'))
    expect(stored.enabled).toBe(true)
    expect(stored.offsets).toEqual(expect.arrayContaining(['1d', '1h']))
    // Switching off hides the offsets again (but keeps them stored).
    fireEvent.click(screen.getByRole('switch', { name: /enable exam reminders/i }))
    expect(screen.queryByRole('button', { name: '1 day before' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('zx_exam_reminders_u1_g7-2026')).offsets).toContain('1d')
  })

  it('status filter chips appear mid-season and partition the timeline', () => {
    at('2026-10-27T08:30:00+02:00') // English in progress; briefing done; rest upcoming
    renderPage()
    // The chip row shows because several buckets are non-empty.
    const completedChip = screen.getByRole('button', { name: /show completed exams/i })
    const todayChip = screen.getByRole('button', { name: /show today exams/i })
    // Filtering to Completed leaves only the finished briefing day in the
    // timeline (paper chips prove which subject cards render there — the
    // summary's "Next Examination" panel is unaffected by the filter).
    fireEvent.click(completedChip)
    expect(screen.getByText('Guidelines to candidates and invigilators')).toBeInTheDocument()
    expect(screen.queryByText('Paper 3/1')).not.toBeInTheDocument() // Mathematics (upcoming)
    expect(screen.queryByText('Paper 4/1')).not.toBeInTheDocument() // Science (today)
    // Switching to Today swaps the visible sessions.
    fireEvent.click(todayChip)
    expect(screen.getByText('Paper 4/1')).toBeInTheDocument() // Integrated Science, today
    expect(
      screen.queryByText('Guidelines to candidates and invigilators'),
    ).not.toBeInTheDocument()
  })

  it('does not show the filter row before the season (nothing to partition)', () => {
    renderPage() // beforeEach pins 2026-09-01 — everything is "upcoming"
    expect(screen.queryByRole('button', { name: /show upcoming exams/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show completed exams/i })).not.toBeInTheDocument()
  })

  it('offers the official PDF as view + download buttons, not the default view', () => {
    renderPage()
    expect(
      screen.getByRole('link', { name: /view official ecz timetable \(pdf\)/i }),
    ).toHaveAttribute('href', '/timetable/pdf')
    expect(screen.getByRole('link', { name: /download official pdf/i })).toHaveAttribute(
      'href',
      PSLE_2026.pdfUrl,
    )
  })

  it('lists archived years under Past Exam Timetables with collapsed days', () => {
    setData({ archived: [ARCHIVED_2025] })
    renderPage()
    expect(screen.getByText('Past Exam Timetables')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /2025 Primary School Leaving Examination/i }),
    )
    // Archived days start collapsed; expanding one reveals Archived cards.
    expect(screen.getAllByText('Archived').length).toBe(1)
    fireEvent.click(screen.getAllByRole('button', { name: /Tuesday, 27 October/i })[1])
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(1)
  })
})
