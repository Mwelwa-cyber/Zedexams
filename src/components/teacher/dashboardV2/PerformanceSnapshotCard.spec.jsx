import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PerformanceSnapshotCard from './PerformanceSnapshotCard'

function renderCard(props) {
  return render(
    <MemoryRouter>
      <PerformanceSnapshotCard {...props} />
    </MemoryRouter>,
  )
}

const CLASS_PERF = {
  hasData: true,
  series: [
    { endMs: 1, yourClass: 40, classAverage: 50 },
    { endMs: 2, yourClass: 55, classAverage: 52 },
  ],
}

describe('PerformanceSnapshotCard', () => {
  it('renders the two-line class mode when class data is available', () => {
    renderCard({ classPerformance: CLASS_PERF, series: [{ date: 'x', created: 1 }] })
    expect(screen.getByText('Performance Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Class Average')).toBeInTheDocument()
    expect(screen.getByText('Your Class')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View full report/ })).toHaveAttribute(
      'href',
      '/teacher/classes',
    )
  })

  it('falls back to the activity trend without chartable class data', () => {
    renderCard({ classPerformance: { hasData: false, series: [] }, series: [{ date: 'x', created: 1 }] })
    expect(screen.getByText('Activity Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Documents created')).toBeInTheDocument()
    expect(screen.queryByText('Class Average')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View full report/ })).toHaveAttribute(
      'href',
      '/teacher/library',
    )
  })

  it('shows the empty state when neither data source has anything', () => {
    renderCard({ classPerformance: null, series: [] })
    expect(screen.getByText(/Create documents to see your weekly trend/)).toBeInTheDocument()
  })
})
