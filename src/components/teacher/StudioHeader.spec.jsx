import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import StudioHeader from './StudioHeader'

function renderHeader(props = {}) {
  return render(
    <MemoryRouter>
      <StudioHeader
        eyebrow="Planning"
        title="Lesson Plan Studio"
        description="Create smart lesson plans in minutes."
        icon={Sparkles}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('StudioHeader', () => {
  it('renders the studio name as the page heading', () => {
    renderHeader()
    expect(screen.getByRole('heading', { level: 1, name: 'Lesson Plan Studio' })).toBeInTheDocument()
  })

  it('carries the workspace category as the eyebrow, not the surface name', () => {
    const { container } = renderHeader()
    const eyebrow = container.querySelector('.studio-header__eyebrow')
    expect(eyebrow.textContent).toBe('Planning')
    // "Teacher Studio" named the thing the teacher is already looking at.
    expect(container.textContent).not.toMatch(/teacher studio/i)
  })

  it('draws the studio mark as an SVG in the white circle, never an emoji', () => {
    const { container } = renderHeader()
    const circle = container.querySelector('.studio-header__icon')
    expect(circle.querySelector('svg')).toBeTruthy()
    // The band carries no text outside the eyebrow/title/description.
    const band = container.querySelector('.studio-header__band')
    expect(band.textContent).toBe('PlanningLesson Plan StudioCreate smart lesson plans in minutes.')
  })

  it('puts the back link and the status chip in ONE utility row', () => {
    const { container } = renderHeader({
      backTo: '/teacher/lesson-plans',
      backLabel: 'Back to Lesson Plans',
      status: <span data-testid="chip">Saved just now</span>,
    })
    const rows = container.querySelectorAll('.studio-header__utility')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.contains(screen.getByRole('link', { name: /back to lesson plans/i }))).toBe(true)
    expect(row.contains(screen.getByTestId('chip'))).toBe(true)
  })

  it('keeps secondary navigation beside Back rather than in a second cluster', () => {
    const { container } = renderHeader({
      backTo: '/teacher/lesson-plans',
      actions: <button type="button">My lessons</button>,
    })
    const left = container.querySelector('.studio-header__utility-left')
    expect(left.contains(screen.getByRole('link'))).toBe(true)
    expect(left.contains(screen.getByRole('button', { name: 'My lessons' }))).toBe(true)
  })

  it('omits the utility row entirely when there is nothing to put in it', () => {
    const { container } = renderHeader()
    expect(container.querySelector('.studio-header__utility')).toBeNull()
  })
})
