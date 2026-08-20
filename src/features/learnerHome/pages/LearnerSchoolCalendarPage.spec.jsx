/**
 * LearnerSchoolCalendarPage.spec — the learner's read of the MoE calendar.
 *
 * The clock is frozen rather than the calendar mocked. The bug this screen
 * answers was the real calendar not being consulted, so a stub that returns
 * the expected term would have passed on every day of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

import LearnerSchoolCalendarPage from './LearnerSchoolCalendarPage'

const IN_TERM = new Date('2026-05-25T09:00:00') // Term 2, week 3
const HOLIDAY = new Date('2026-08-20T09:00:00') // 18 days before Term 3 opens

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/school-calendar']}>
      <LearnerSchoolCalendarPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LearnerSchoolCalendarPage', () => {
  it('names the holiday, counts to the next term, and says why the app still shows last term', () => {
    vi.setSystemTime(HOLIDAY)
    renderPage()

    expect(screen.getByText('School is closed')).toBeInTheDocument()
    expect(screen.getByText('Third Term opens in 18 days')).toBeInTheDocument()
    expect(screen.getByText('Opens on 7 September 2026.')).toBeInTheDocument()
    // The sentence that connects this screen to the rest of the app.
    expect(screen.getByText(/Your subjects are still showing/)).toBeInTheDocument()
    expect(screen.getByText(/that is what you were\s+taught last/)).toBeInTheDocument()
  })

  it('reports the running term and the week when school is open', () => {
    vi.setSystemTime(IN_TERM)
    renderPage()

    expect(screen.getByText('School is open')).toBeInTheDocument()
    expect(screen.getByText('Second Term · Week 3 of 13')).toBeInTheDocument()
    expect(screen.getByText('Ends on 7 August 2026.')).toBeInTheDocument()
    // No holiday explanation while school is in session.
    expect(screen.queryByText(/Your subjects are still showing/)).not.toBeInTheDocument()
  })

  it('lists the year as three terms with the holidays between them', () => {
    vi.setSystemTime(HOLIDAY)
    const { container } = renderPage()

    // Scoped to the row list: "Second Term" also appears in the hero's
    // explanation of what the app is still showing.
    const names = [...container.querySelectorAll('.lhx-cal-term-name')].map((n) => n.textContent)
    expect(names).toEqual(['First Term', 'Second Term', 'Third Term'])

    expect(screen.getByText('Holiday after First Term')).toBeInTheDocument()
    expect(screen.getByText('Holiday after Second Term')).toBeInTheDocument()
    // The December holiday crosses into the next year and is still listed.
    expect(screen.getByText('Holiday after Third Term')).toBeInTheDocument()
    expect(screen.getByText('5 Dec 2026 – 10 Jan 2027 · 37 days')).toBeInTheDocument()
    // The break we are actually in says so, and it is the only one that does.
    expect(screen.getByText('8 Aug – 6 Sept 2026 · 30 days')).toBeInTheDocument()
    expect(container.querySelectorAll('.lhx-cal-break.is-now')).toHaveLength(1)
  })

  it('marks which term is running and never draws progress on one that is not', () => {
    vi.setSystemTime(IN_TERM)
    const { container } = renderPage()

    const active = container.querySelector('.lhx-cal-term.is-active')
    expect(active).toBeTruthy()
    expect(within(active).getByText('Second Term')).toBeInTheDocument()
    expect(within(active).getByText('Week 3 of 13')).toBeInTheDocument()

    // Exactly one progress bar on the page — the running term's.
    expect(container.querySelectorAll('.lhx-cal-week-fill')).toHaveLength(1)
  })

  it('draws no progress bar at all during a holiday', () => {
    vi.setSystemTime(HOLIDAY)
    const { container } = renderPage()
    expect(container.querySelector('.lhx-cal-term.is-active')).toBeNull()
    expect(container.querySelectorAll('.lhx-cal-week-fill')).toHaveLength(0)
  })

  it('past the end of the calendar it says it does not know, rather than declaring a closure', () => {
    vi.setSystemTime(new Date('2031-03-01T09:00:00'))
    renderPage()
    expect(screen.getByText('Calendar unavailable')).toBeInTheDocument()
    expect(screen.getByText('We don’t have term dates for this year yet.')).toBeInTheDocument()
    // "School is closed" is a claim about the school; we cannot see one here.
    expect(screen.queryByText('School is closed')).not.toBeInTheDocument()
    expect(screen.queryByText('School is open')).not.toBeInTheDocument()
  })

  it('says the dates are the Ministry’s and that a school may vary them', () => {
    vi.setSystemTime(HOLIDAY)
    renderPage()
    expect(screen.getByText(/Ministry of Education school calendar/)).toBeInTheDocument()
    expect(screen.getByText(/may open\s+or close a day or two either side/)).toBeInTheDocument()
  })
})
