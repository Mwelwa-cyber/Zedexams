/**
 * ChildProgressSections — presentational render of a child's progress payload
 * (shared by the authenticated parent portal). Pure + firebase-free; these
 * lock the KPI / subject / recent-quiz rendering and the no-activity state.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../components/ui/SubjectIcon', () => ({ default: () => null }))

import ChildProgressSections from './ChildProgressSections'

const payload = {
  summary: { totalAttempts: 6, averagePercentage: 74, currentStreak: 3, windowDays: 30 },
  subjectBreakdown: [
    { subject: 'mathematics', count: 4, averagePercentage: 80 },
    { subject: 'english', count: 2, averagePercentage: 61 },
  ],
  recentResults: [
    { quizId: 'q1', quizTitle: 'Fractions', subject: 'mathematics', percentage: 82, completedAtMs: Date.now() },
  ],
}

describe('ChildProgressSections', () => {
  it('renders the three headline KPIs', () => {
    render(<ChildProgressSections data={payload} />)
    expect(screen.getByText('6')).toBeInTheDocument()          // quizzes done
    expect(screen.getByText('74%')).toBeInTheDocument()        // average
    expect(screen.getByText('3🔥')).toBeInTheDocument()        // streak with fire
    expect(screen.getByText('Quizzes done')).toBeInTheDocument()
  })

  it('renders the subject breakdown rows', () => {
    render(<ChildProgressSections data={payload} />)
    expect(screen.getByText('By subject')).toBeInTheDocument()
    expect(screen.getByText('4× · 80%')).toBeInTheDocument()
    expect(screen.getByText('2× · 61%')).toBeInTheDocument()
  })

  it('renders recent quizzes with the score', () => {
    render(<ChildProgressSections data={payload} />)
    expect(screen.getByText('Recent quizzes')).toBeInTheDocument()
    expect(screen.getByText('Fractions')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
  })

  it('shows the no-activity state and hides breakdown/recent when empty', () => {
    render(<ChildProgressSections data={{
      summary: { totalAttempts: 0, averagePercentage: null, currentStreak: 0, windowDays: 30 },
      subjectBreakdown: [],
      recentResults: [],
    }} />)
    expect(screen.getByText('No quizzes yet')).toBeInTheDocument()
    expect(screen.queryByText('By subject')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent quizzes')).not.toBeInTheDocument()
    // average renders an em-dash when null
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders nothing without a summary', () => {
    const { container } = render(<ChildProgressSections data={null} />)
    expect(container.firstChild).toBeNull()
  })
})
