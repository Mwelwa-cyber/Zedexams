/**
 * Behaviour tests for the prototype-v3 /timetable redesign. The page
 * owns the season logic + rendering; everything with a Firebase
 * dependency is mocked. Times are pinned with fake timers so each
 * season phase (before / during / after) is reproducible.
 *
 * The redesign shows the whole week at once (no search/collapse), so
 * these assert: the countdown hero per phase, all day cards visible,
 * the dimmed briefing day, that no session row carries an action, the
 * persisted choose-ONE selection, reminders, the PDF rows, and
 * archived years.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useExamTimetables from '../../../hooks/useExamTimetables'
import { PSLE_2026 } from '../../../config/examTimetable2026'
import ExamTimetablePage from './ExamTimetablePage.jsx'

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../hooks/useExamTimetables', () => ({ default: vi.fn() }))
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
    expect(container.querySelector('.lhx-skel')).toBeTruthy()
    expect(screen.queryByText(/next exam/i)).not.toBeInTheDocument()
  })

  it('BEFORE the season: hero counts down to the first sat paper, never the briefing', () => {
    renderPage()
    expect(screen.getByText('Next exam')).toBeInTheDocument()
    // English (Tue 27 Oct 08:00) is the countdown target, not Monday's briefing.
    const hero = screen.getByRole('region', { name: 'Next exam' })
    expect(hero).toHaveTextContent('English Language')
    expect(hero).toHaveTextContent('Tuesday 27 October · 08:00')
    expect(screen.getByRole('timer')).toBeInTheDocument()
    expect(screen.getByText('days')).toBeInTheDocument()
    // The exam-name strip below the hero names the exam + span.
    expect(screen.getByText('Primary School Leaving Examination')).toBeInTheDocument()
  })

  it('shows every exam day at once — no taps needed to see Wednesday', () => {
    renderPage()
    // Tuesday's and Wednesday's papers are both visible immediately.
    expect(screen.getByText(/Paper 1\/1/)).toBeInTheDocument()
    expect(screen.getByText(/Paper 3\/1/)).toBeInTheDocument()
    // The next exam day (Tuesday) carries the Next badge.
    expect(screen.getByText('Next')).toBeInTheDocument()
  })

  it('dims the briefing day and marks it "No paper written"', () => {
    renderPage()
    expect(screen.getByText('Guidelines to candidates and invigilators')).toBeInTheDocument()
    expect(screen.getByText('No paper written')).toBeInTheDocument()
    expect(screen.getByText('Guidelines to candidates and invigilators').closest('.lhx-tt-sess'))
      .toHaveClass('lhx-tt-brief')
  })

  it('no session row carries a Practise or Past papers action', () => {
    const { container } = renderPage()
    // Removed outright, not merely restyled — asserted three ways so a
    // reintroduction under a new label or link still fails: no action
    // container survives, no link points at /practise, and no link
    // carries a subject-filtered /papers query.
    expect(container.querySelector('.lhx-tt-actions')).toBeNull()
    expect(container.querySelector('.lhx-tt-act')).toBeNull()
    expect(screen.queryByRole('link', { name: /practise/i })).toBeNull()
    const links = screen.getAllByRole('link')
    expect(links.some((l) => l.getAttribute('href')?.startsWith('/practise'))).toBe(false)
    expect(links.some((l) => l.getAttribute('href')?.includes('/papers?grade='))).toBe(false)
    // The sessions themselves are untouched — time, paper code, duration.
    expect(screen.getByText(/Paper 1\/1 · 90 minutes/)).toBeInTheDocument()
  })

  it('DURING a paper: hero shows today’s exam with live time remaining', () => {
    at('2026-10-27T08:30:00+02:00') // 30 min into English Language
    renderPage()
    expect(screen.getByText(/Today's exam · in progress/i)).toBeInTheDocument()
    expect(screen.getByText('Time remaining')).toBeInTheDocument()
    expect(screen.getByText('01:00:00')).toBeInTheDocument() // ends 09:30
    // The 27th's day card is badged Today.
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('AFTER the season: congratulations + all five resource links, never empty', () => {
    at('2026-11-05T10:00:00+02:00')
    renderPage()
    expect(
      screen.getByText(/2026 Primary School Leaving Examination Completed/i),
    ).toBeInTheDocument()
    // The season-over card is now the ONLY "Past papers" link on the
    // page — the day cards carry no per-session actions.
    expect(screen.getByRole('link', { name: /past papers/i })).toHaveAttribute(
      'href',
      '/papers?grade=7',
    )
    expect(screen.getByRole('link', { name: /revision notes/i })).toHaveAttribute('href', '/notes')
    expect(screen.getByRole('link', { name: /games/i })).toHaveAttribute('href', '/games')
    // Only the mockup's destinations — Practice Quizzes and Bridge
    // Lessons pointed at surfaces the learner mockup does not have.
    expect(screen.queryByRole('link', { name: /practice quizzes/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /bridge lessons/i })).toBeNull()
  })

  it('choose-ONE sessions list every alternative; tapping one marks it and persists', () => {
    renderPage()
    // Friday's language session renders the full alternatives list.
    expect(screen.getAllByText(/Candidates sit ONE/i).length).toBeGreaterThan(0)
    const cinyanja = screen.getByRole('button', { name: 'Cinyanja' })
    expect(cinyanja).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(cinyanja)
    expect(cinyanja).toHaveAttribute('aria-pressed', 'true')
    // The pick persists per device, scoped by timetable id.
    expect(localStorage.getItem('zx_exam_paper_choice_g7-2026_zl')).toBe('5/1')
    // Selecting another language moves the selection — it does not stack.
    fireEvent.click(screen.getByRole('button', { name: 'Icibemba' }))
    expect(cinyanja).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Icibemba' })).toHaveAttribute('aria-pressed', 'true')
    // Picking a language still adds no action to the row.
    expect(screen.queryByRole('link', { name: /practise/i })).toBeNull()
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

  it('offers the official PDF as a view row + download link', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /official ecz timetable/i })).toHaveAttribute(
      'href',
      '/timetable/pdf',
    )
    expect(screen.getByRole('link', { name: /download official pdf/i })).toHaveAttribute(
      'href',
      PSLE_2026.pdfUrl,
    )
  })

  it('lists archived years collapsed; expanding shows read-only day cards', () => {
    setData({ archived: [ARCHIVED_2025] })
    renderPage()
    expect(screen.getByText('Past Exam Timetables')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /2025 Primary School Leaving Examination/i }),
    )
    // Archived day cards are read-only: their alternatives render as
    // plain pills, not buttons.
    expect(screen.getAllByText('Cinyanja').length).toBeGreaterThan(1)
    expect(screen.getAllByRole('button', { name: 'Cinyanja' })).toHaveLength(1)
    // The archived days themselves are visible (two English rows now).
    expect(screen.getAllByText('English Language').length).toBeGreaterThan(2)
  })
})
