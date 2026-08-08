import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeacherWorkspace, { PRIMARY_GROUPS, MORE_GROUPS } from './TeacherWorkspace'
import { capture } from '../../utils/analytics'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

function renderWs(props = {}) {
  return render(
    <MemoryRouter>
      <TeacherWorkspace
        librarySummary={props.librarySummary ?? { total: 0, byTool: {} }}
        isFreePlan={props.isFreePlan ?? false}
        expanded={props.expanded}
        onToggle={props.onToggle}
      />
    </MemoryRouter>,
  )
}

describe('TeacherWorkspace', () => {
  it('defines the three primary groups from the spec', () => {
    expect(PRIMARY_GROUPS.map((g) => g.label)).toEqual(['Planning', 'Teaching Materials', 'Assessment'])
    expect(PRIMARY_GROUPS[0].items).toHaveLength(4)
    expect(PRIMARY_GROUPS[1].items).toHaveLength(4)
    // Assessment merged its Test Papers + Exam Studio tiles into one
    // Assessment Paper Studio tile, and the Question Bank stopped being a
    // destination of its own (it is a view inside that studio) — 2 items.
    expect(PRIMARY_GROUPS[2].items).toHaveLength(2)
    expect(PRIMARY_GROUPS[0].items.map((i) => i.title))
      .toEqual(['Schemes of Work', 'Weekly Focus', 'Lesson Plans', 'Record of Work'])
    expect(PRIMARY_GROUPS[2].items.map((i) => i.title))
      .toEqual(['Assessment Paper Studio', 'Mark Schedule'])
  })

  it('shows only primary tools by default; the rest appear after expanding', () => {
    renderWs()
    expect(screen.getByText('Schemes of Work')).toBeInTheDocument()
    expect(screen.getByText('Notes Studio')).toBeInTheDocument()
    // Worksheet Studio is withdrawn behind a feature flag; its tile is
    // filtered out of the group rather than removed from the catalogue.
    expect(screen.queryByText('Worksheets')).not.toBeInTheDocument()
    // Secondary tools are hidden until expansion — nothing is deleted.
    expect(screen.queryByText('Flashcards')).not.toBeInTheDocument()
    expect(screen.queryByText('SBA Studio')).not.toBeInTheDocument()
    expect(screen.queryByText('My Library')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /view all teacher tools/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText('Flashcards')).toBeInTheDocument()
    expect(screen.getByText('SBA Studio')).toBeInTheDocument()
    expect(screen.getByText('My Library')).toBeInTheDocument()
    expect(screen.getByText('Recovery Centre')).toBeInTheDocument()
    expect(screen.getByText('Curriculum')).toBeInTheDocument()

    const collapse = screen.getByRole('button', { name: /show fewer tools/i })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)
    expect(screen.queryByText('Flashcards')).not.toBeInTheDocument()
  })

  it('never renders a "0 saved" badge but shows real counts with accessible labels', () => {
    renderWs({ librarySummary: { total: 3, byTool: { lesson_plan: 3, scheme_of_work: 0 } } })
    const badge = screen.getByText('3 saved')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', '3 saved documents')
    expect(screen.queryByText('0 saved')).not.toBeInTheDocument()
  })

  it('summary unavailable (query failed → empty) hides counts but keeps tools usable', () => {
    renderWs({ librarySummary: { total: 0, byTool: {} } })
    expect(screen.queryByText(/\d+ saved/)).not.toBeInTheDocument()
    expect(screen.getByText('Lesson Plans').closest('a'))
      .toHaveAttribute('href', '/teacher/lesson-plans/new')
  })

  it('tracks tool selections with their area and collapse events', () => {
    renderWs()
    fireEvent.click(screen.getByText('Notes Studio').closest('a'))
    expect(capture).toHaveBeenCalledWith('workspace_tool_selected', { tool: 'Notes Studio', area: 'primary' })
    fireEvent.click(screen.getByRole('button', { name: /view all teacher tools/i }))
    fireEvent.click(screen.getByText('Flashcards').closest('a'))
    expect(capture).toHaveBeenCalledWith('workspace_tool_selected', { tool: 'Flashcards', area: 'expanded' })
    fireEvent.click(screen.getByRole('button', { name: /show fewer tools/i }))
    expect(capture).toHaveBeenCalledWith('teacher_workspace_collapsed', { from: 'workspace' })
  })

  it('badges Pro/Max-only tiles as Sample for Free teachers', () => {
    renderWs({ isFreePlan: true })
    // Scheme of Work is gated; Lesson Plans stays open for Free.
    expect(screen.getAllByText(/🔒 Sample/).length).toBeGreaterThan(0)
    const lessonCard = screen.getByText('Lesson Plans').closest('a')
    expect(lessonCard).not.toHaveTextContent('Sample')
  })

  it('every tool remains reachable — expanded set covers the full catalogue', () => {
    const all = [...PRIMARY_GROUPS, ...MORE_GROUPS].flatMap((g) => g.items.map((i) => i.to))
    for (const route of [
      '/teacher/generate/scheme-of-work', '/teacher/generate/weekly-forecast',
      '/teacher/lesson-plans/new', '/teacher/generate/record-of-work',
      '/teacher/generate/worksheet', '/teacher/generate/notes', '/teacher/generate/homework',
      '/teacher/visual-studio', '/teacher/assessment-papers',
      '/teacher/generate/mark-schedule',
      '/teacher/syllabi', '/teacher/curriculum', '/teacher/calendar', '/teacher/templates',
      '/teacher/register', '/teacher/generate/class-timetable',
      '/teacher/generate/flashcards',
      '/teacher/generate/sba', '/teacher/generate/sba-tracker', '/teacher/generate/sba-planner',
      '/teacher/library', '/teacher/drafts',
    ]) {
      expect(all).toContain(route)
    }
    // Rubric Studio is retired: its tile is gone from the catalogue, not
    // merely hidden, so nothing can route a teacher back into it.
    expect(all).not.toContain('/teacher/generate/rubric')
  })
})
