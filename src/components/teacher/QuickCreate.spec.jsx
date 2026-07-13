import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QuickCreate from './QuickCreate'
import { capture } from '../../utils/analytics'

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

describe('QuickCreate', () => {
  it('renders the four primary actions routed to the existing studios', () => {
    render(
      <MemoryRouter>
        <QuickCreate />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /lesson plan/i }))
      .toHaveAttribute('href', '/teacher/generate/lesson-plan')
    expect(screen.getByRole('link', { name: /weekly focus/i }))
      .toHaveAttribute('href', '/teacher/generate/weekly-forecast')
    expect(screen.getByRole('link', { name: /worksheet/i }))
      .toHaveAttribute('href', '/teacher/generate/worksheet')
    expect(screen.getByRole('link', { name: /test paper/i }))
      .toHaveAttribute('href', '/teacher/test-papers/new')
  })

  it('links "View all teacher tools" to the workspace anchor and tracks selections', () => {
    render(
      <MemoryRouter>
        <QuickCreate />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /view all teacher tools/i }))
      .toHaveAttribute('href', '#teacher-workspace')
    fireEvent.click(screen.getByRole('link', { name: /worksheet/i }))
    expect(capture).toHaveBeenCalledWith('quick_create_selected', { tool: 'worksheet' })
  })

  it('shows a short description on every card', () => {
    render(
      <MemoryRouter>
        <QuickCreate />
      </MemoryRouter>,
    )
    expect(screen.getByText(/teaching stages, resources and assessment/i)).toBeInTheDocument()
    expect(screen.getByText(/from your scheme of work and timetable/i)).toBeInTheDocument()
    expect(screen.getByText(/practice, exercises and consolidation/i)).toBeInTheDocument()
    expect(screen.getByText(/weekly, mid-term and end-of-term tests/i)).toBeInTheDocument()
  })
})
