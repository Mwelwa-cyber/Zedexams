import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CreatedFromLessonPlanNotice from './CreatedFromLessonPlanNotice'

function renderNotice(urlDefaults) {
  return render(
    <MemoryRouter>
      <CreatedFromLessonPlanNotice urlDefaults={urlDefaults} />
    </MemoryRouter>,
  )
}

describe('CreatedFromLessonPlanNotice', () => {
  it('renders nothing without a source lesson plan id', () => {
    const { container } = renderNotice({ grade: 'G4' })
    expect(container.firstChild).toBeNull()
  })

  it('shows the inherited context label and a link back to the source plan', () => {
    renderNotice({ sourceLessonPlanId: 'plan-1', grade: 'G4', subject: 'mathematics', topic: 'Fractions', term: 2, schoolWeek: 8 })
    expect(screen.getByText('Created from Lesson Plan')).toBeInTheDocument()
    expect(screen.getByText(/Grade 4 · Mathematics · Fractions · Term 2, Week 8/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /view source lesson/i })
    expect(link).toHaveAttribute('href', '/teacher/library/plan-1')
  })

  it('still renders with only a source id (no coords)', () => {
    renderNotice({ sourceLessonPlanId: 'plan-2' })
    expect(screen.getByText('Created from Lesson Plan')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view source lesson/i })).toHaveAttribute('href', '/teacher/library/plan-2')
  })
})
