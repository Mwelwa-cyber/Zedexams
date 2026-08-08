import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QuickCreate from './QuickCreate'
import { capture } from '../../utils/analytics'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

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
    expect(screen.getByRole('link', { name: /assessment paper/i }))
      .toHaveAttribute('href', '/teacher/assessment-papers/new')
    // Worksheet Studio is withdrawn, so Homework — the practice-generation
    // surface in the meantime — takes the fourth slot. The row stays four.
    expect(screen.getByRole('link', { name: /homework/i }))
      .toHaveAttribute('href', '/teacher/generate/homework')
    expect(screen.queryByRole('link', { name: /worksheet/i })).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })

  it('restores the Worksheet card when the studio flag is on', async () => {
    // Re-imported under a settings stub with the flag SET, proving the tile is
    // hidden rather than deleted — and that Homework yields the slot back.
    vi.resetModules()
    vi.doMock('../../contexts/PlatformSettingsContext', () => ({
      usePlatformSettings: () => ({
        settings: { featureFlags: { worksheetStudioEnabled: true } },
        loaded: true,
        live: true,
      }),
    }))
    const { default: FlaggedQuickCreate } = await import('./QuickCreate')
    render(
      <MemoryRouter>
        <FlaggedQuickCreate />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /worksheet/i }))
      .toHaveAttribute('href', '/teacher/generate/worksheet')
    expect(screen.queryByRole('link', { name: /^homework/i })).toBeNull()
    vi.doUnmock('../../contexts/PlatformSettingsContext')
    vi.resetModules()
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
    fireEvent.click(screen.getByRole('link', { name: /weekly focus/i }))
    expect(capture).toHaveBeenCalledWith('quick_create_selected', { tool: 'weekly_focus' })
  })

  it('shows a short description on every card', () => {
    render(
      <MemoryRouter>
        <QuickCreate />
      </MemoryRouter>,
    )
    expect(screen.getByText(/teaching stages, resources and assessment/i)).toBeInTheDocument()
    expect(screen.getByText(/from your scheme of work and timetable/i)).toBeInTheDocument()
    expect(screen.getByText(/tests, mock exams and formal examinations/i)).toBeInTheDocument()
    expect(screen.getByText(/model answers and marking guidance/i)).toBeInTheDocument()
  })
})
