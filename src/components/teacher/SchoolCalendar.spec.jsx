/**
 * Regression: CountdownChip rendered a calendar-day delta as "N working days
 * left" and computed pct = (workingDays - d) / workingDays, mixing units with
 * the result that the bar clamps to 0% for the first ~4 weeks. Fix: relabel to
 * "days left" and compute pct from residentDays (the full calendar span), matching
 * the learner widget (LearnerCalendar.jsx:132-134).
 *
 * Pin system time to 2026-07-11 (inside 2026 Term 2: open 05-11, close 08-07,
 * residentDays=89, workingDays=61).  With today = 2026-07-11:
 *   d   = daysUntil('2026-08-07') = 27 calendar days
 *   pct = round((89-27)/89*100)   = round(69.66) = 70 %   (fixed)
 *   old = round((61-27)/61*100)   = round(55.74) = 56 %   (buggy)
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import SchoolCalendar from './SchoolCalendar.jsx'

// 2026-07-11 is inside 2026 Term 2 (Second Term, residentDays=89, workingDays=61)
const PINNED_DATE = new Date('2026-07-11T00:00:00')
vi.setSystemTime(PINNED_DATE)
afterAll(() => vi.useRealTimers())

describe('SchoolCalendar CountdownChip', () => {
  it('labels the countdown as "days left" — not "working days left"', () => {
    render(<SchoolCalendar />)
    // The chip must say "27 days left" (plain calendar days).
    expect(screen.getByText('27 days left')).toBeInTheDocument()
    // Must NOT contain "working days" anywhere in the chip.
    expect(screen.queryByText(/working days left/i)).not.toBeInTheDocument()
  })

  it('computes the elapsed percentage from residentDays (calendar span)', () => {
    render(<SchoolCalendar />)
    // pct = round((89-27)/89*100) = 70, not 56 (which the old workingDays formula gave).
    expect(screen.getByText('70% elapsed')).toBeInTheDocument()
  })
})
