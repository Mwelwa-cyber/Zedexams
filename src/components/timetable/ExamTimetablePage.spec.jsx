import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import useExamTimetables from '../../hooks/useExamTimetables'
import { PSLE_2026 } from '../../config/examTimetable2026'
import ExamTimetablePage from './ExamTimetablePage.jsx'

// The page under test owns the season logic + rendering; everything with a
// Firebase dependency is mocked. Times are pinned with fake timers so each
// season phase (before / during / after) is reproducible.
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useExamTimetables', () => ({ default: vi.fn() }))
vi.mock('../layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../utils/runtime', () => ({ isNativePlatform: () => false }))

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
    expect(container.querySelector('.animate-shimmer')).toBeTruthy()
    expect(screen.queryByText(/starts in/i)).not.toBeInTheDocument()
  })

  it('BEFORE the season: countdown hero, progress, and the next exam', () => {
    renderPage()
    expect(screen.getByText('Primary School Leaving Examination')).toBeInTheDocument()
    expect(screen.getByText(/starts in/i)).toBeInTheDocument()
    expect(screen.getByText('Days')).toBeInTheDocument()
    expect(screen.getByText('0 of 8 papers written')).toBeInTheDocument()
    // Next Exam panel features the first paper (not the briefing day).
    expect(screen.getByText('Next Exam')).toBeInTheDocument()
    expect(screen.getAllByText('English Language').length).toBeGreaterThan(0)
  })

  it('DURING a paper: live time remaining and the next examination', () => {
    at('2026-10-27T08:30:00+02:00') // 30 min into English Language
    renderPage()
    expect(screen.getByText("Today's Examination")).toBeInTheDocument()
    expect(screen.getByText(/time remaining/i)).toBeInTheDocument()
    expect(screen.getByText('01:00:00')).toBeInTheDocument() // ends 09:30
    expect(screen.getByText('Next Examination')).toBeInTheDocument()
    expect(screen.getAllByText('Integrated Science').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
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
    // Completed session cards also link to /notes, so match any of them.
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

  it('search filters the day cards by subject', () => {
    renderPage()
    expect(screen.getAllByText('Mathematics').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole('searchbox', { name: /search subjects/i }), {
      target: { value: 'math' },
    })
    expect(screen.getAllByText('Mathematics').length).toBeGreaterThan(0)
    // English still shows in the hero's Next Exam panel, but its day card
    // (with the paper-code pill) is gone.
    expect(screen.queryByText('Paper 1/1')).not.toBeInTheDocument()
    expect(screen.getByText('Paper 3/1')).toBeInTheDocument()
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

  it('persists reminder preferences per learner + timetable', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '1 day before' }))
    const stored = JSON.parse(localStorage.getItem('zx_exam_reminders_u1_g7-2026'))
    expect(stored.offsets).toContain('1d')
  })

  it('lists archived years under Past Exam Timetables', () => {
    setData({ archived: [ARCHIVED_2025] })
    renderPage()
    expect(screen.getByText('Past Exam Timetables')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /2025 Primary School Leaving Examination/i })
    fireEvent.click(row)
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(1)
  })
})
