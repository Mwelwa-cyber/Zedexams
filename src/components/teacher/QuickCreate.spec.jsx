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
      .toHaveAttribute('href', '/teacher/lesson-plans/new')
    expect(screen.getByRole('link', { name: /weekly focus/i }))
      .toHaveAttribute('href', '/teacher/generate/weekly-forecast')
    expect(screen.getByRole('link', { name: /worksheet/i }))
      .toHaveAttribute('href', '/teacher/generate/worksheet')
    expect(screen.getByRole('link', { name: /assessment paper/i }))
      .toHaveAttribute('href', '/teacher/assessment-papers/new')
  })

  it('"View all teacher tools" scrolls to the workspace and moves focus to its heading', () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    render(
      <MemoryRouter>
        <div>
          <QuickCreate />
          <div id="teacher-workspace">
            <h2 id="teacher-workspace-title" tabIndex={-1}>Teacher Workspace</h2>
          </div>
        </div>
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: /view all teacher tools/i })
    fireEvent.click(btn)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(document.activeElement).toBe(document.getElementById('teacher-workspace-title'))
    // No #hash is written into the URL.
    expect(window.location.hash).toBe('')
    expect(capture).toHaveBeenCalledWith('teacher_workspace_expanded', { from: 'quick-create' })
  })

  it('tracks card selections', () => {
    render(
      <MemoryRouter>
        <QuickCreate />
      </MemoryRouter>,
    )
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
    expect(screen.getByText(/tests, mock exams and formal examinations/i)).toBeInTheDocument()
  })
})
