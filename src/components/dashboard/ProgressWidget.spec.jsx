import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressWidget from './ProgressWidget'

// ProgressWidget shows a learner's streak, weekly-goal ring, and 7-day
// activity bars from already-fetched results (zero extra queries). The logic
// that matters: only results from the last 7 days count toward the weekly
// goal (5), the "goal hit" badge appears at/above the threshold, and the streak
// is surfaced. Results are dated relative to now so the current-week bucketing
// is exercised deterministically.

const today = () => new Date()
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
const results = (n, when = today) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, completedAt: when() }))

describe('ProgressWidget', () => {
  it('shows a skeleton while loading (no content yet)', () => {
    render(<ProgressWidget loading />)
    expect(screen.queryByText(/Your Progress/)).not.toBeInTheDocument()
  })

  it('renders the widget with the streak surfaced', () => {
    render(<ProgressWidget results={[]} streak={4} loading={false} />)
    expect(screen.getByText(/Your Progress/)).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/day streak/)).toBeInTheDocument()
  })

  it('shows the weekly-goal-hit badge once 5 quizzes land this week', () => {
    render(<ProgressWidget results={results(5)} streak={2} />)
    expect(screen.getByText(/Weekly goal hit/)).toBeInTheDocument()
  })

  it('does not show the goal badge below the threshold', () => {
    render(<ProgressWidget results={results(3)} streak={2} />)
    expect(screen.queryByText(/Weekly goal hit/)).not.toBeInTheDocument()
  })

  it('excludes results older than 7 days from the weekly count', () => {
    // 5 completions, but all 10 days ago → none count → no goal badge.
    render(<ProgressWidget results={results(5, () => daysAgo(10))} streak={0} />)
    expect(screen.queryByText(/Weekly goal hit/)).not.toBeInTheDocument()
  })

  it('handles an empty result set without crashing', () => {
    render(<ProgressWidget results={[]} streak={0} />)
    expect(screen.getByText(/Your Progress/)).toBeInTheDocument()
  })
})
