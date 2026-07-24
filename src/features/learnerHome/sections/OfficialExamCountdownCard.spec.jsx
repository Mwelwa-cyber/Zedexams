/**
 * Countdown card transitions: upcoming (real countdown values),
 * in-progress ("Exam in progress"), completed, and missing-data
 * ("not published") — driven by real timetable-session shapes.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

import OfficialExamCountdownCard from './OfficialExamCountdownCard'

const mkTimetable = (offsetMs, durMs = 2 * 3600_000) => ({
  year: 2026,
  board: 'ECZ',
  days: [
    {
      date: '2026-10-26',
      sessions: [
        {
          key: 's1',
          title: 'English Paper 1',
          start: new Date(Date.now() + offsetMs).toISOString(),
          end: new Date(Date.now() + offsetMs + durMs).toISOString(),
          papers: [{ name: 'English Paper 1' }],
        },
      ],
    },
  ],
})

const renderCard = (timetables) => render(
  <MemoryRouter>
    <OfficialExamCountdownCard grade="7" timetables={timetables} />
  </MemoryRouter>,
)

describe('OfficialExamCountdownCard', () => {
  it('shows the countdown for the next upcoming paper', () => {
    renderCard({ active: mkTimetable(3 * 86_400_000 + 5 * 3600_000), loading: false })
    expect(screen.getByText(/English Paper 1/)).toBeInTheDocument()
    const timer = screen.getByRole('timer')
    expect(timer.textContent).toContain('days')
    expect(timer.textContent).toContain('3') // real derived value, not a placeholder
  })

  it('switches to "Exam in progress" during a session', () => {
    renderCard({ active: mkTimetable(-60_000), loading: false })
    expect(screen.getByText('Exam in progress')).toBeInTheDocument()
  })

  it('shows the completed state after every session ends', () => {
    renderCard({ active: mkTimetable(-10 * 3600_000, 3600_000), loading: false })
    expect(screen.getByText(/Examinations completed/)).toBeInTheDocument()
  })

  it('handles missing timetable data gracefully', () => {
    renderCard({ active: null, loading: false })
    expect(screen.getByText('The examination timetable has not been published yet.')).toBeInTheDocument()
  })
})
