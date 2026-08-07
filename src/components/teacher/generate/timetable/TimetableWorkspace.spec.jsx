/**
 * TimetableWorkspace — Phase 2 of the Class Timetable Studio.
 *
 * What these tests pin is the behaviour the long-page version could not
 * offer: status is readable without scrolling (top-bar chips), a subject is
 * placed by tapping rather than by hunting a per-cell dropdown, and the
 * export actions refuse — with a reason — while the grid is empty.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TimetableWorkspace from './TimetableWorkspace'

// A two-period Monday/Tuesday week: enough for placement, joining and the
// band row, without standing up the whole curriculum resolver.
const gridModel = {
  rows: [
    { id: 'p1', kind: 'lesson', slot: 1, label: 'Period 1', start: '07:45', end: '08:25' },
    { id: 'b1', kind: 'break', label: 'BREAK', start: '08:25', end: '08:45' },
    { id: 'p2', kind: 'lesson', slot: 2, label: 'Period 2', start: '08:45', end: '09:25' },
  ],
  subjects: ['Mathematics', 'English'],
}

function renderWorkspace(over = {}) {
  const props = {
    classLabel: 'Grade 5 · 2026 — Class timetable',
    filled: 0,
    allocated: 4,
    conflictsCount: 0,
    paletteSubjects: [
      { label: 'Mathematics', placed: 0, target: 2 },
      { label: 'English', placed: 0, target: 2 },
    ],
    tints: { Mathematics: '#fbe7c8', English: '#dbe7f4' },
    gridModel,
    blocks: [],
    segments: [],
    subjectLabels: ['Mathematics', 'English'],
    days: ['Monday', 'Tuesday'],
    visibleDays: ['Monday', 'Tuesday'],
    mobileDay: 'all',
    setMobileDay: vi.fn(),
    displayPreferences: { periodLabelMode: 'both' },
    onSetCell: vi.fn(),
    onJoinDown: vi.fn(),
    onSplit: vi.fn(),
    onToggleLock: vi.fn(),
    onEditDetails: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    onRequestClear: vi.fn(),
    onExportPdf: vi.fn(),
    onExportDocx: vi.fn(),
    onExportXlsx: vi.fn(),
    onSaveDraft: vi.fn(),
    onFinalCheckAndSave: vi.fn(),
    onEditSetup: vi.fn(),
    schoolDayContent: <p>day times drawer body</p>,
    subjectsContent: <p>subjects drawer body</p>,
    layoutContent: <p>layout drawer body</p>,
    conflictsContent: <p>conflicts drawer body</p>,
    previewContent: <p>preview drawer body</p>,
    validationPanel: null,
    ...over,
  }
  return { props, ...render(<TimetableWorkspace {...props} />) }
}

describe('TimetableWorkspace — status is readable without scrolling', () => {
  it('shows the class, the placed count and a green no-conflicts chip in the top bar', () => {
    renderWorkspace({ filled: 3 })
    expect(screen.getByText('Grade 5 · 2026 — Class timetable')).toBeInTheDocument()
    expect(screen.getByText('3/4 placed')).toBeInTheDocument()
    expect(screen.getByText('No conflicts')).toBeInTheDocument()
  })

  it('turns the conflicts chip amber and counts them when there are conflicts', () => {
    renderWorkspace({ conflictsCount: 2 })
    expect(screen.getByText('2 conflicts')).toBeInTheDocument()
    expect(screen.queryByText('No conflicts')).not.toBeInTheDocument()
  })

  it('surfaces an unresolved knock-off overrun as a chip that opens Day times', async () => {
    renderWorkspace({ knockOffDelta: 25 })
    const chip = screen.getByLabelText(/25 minutes past knock-off/i)
    await userEvent.click(chip)
    expect(screen.getByText('day times drawer body')).toBeInTheDocument()
  })
})

describe('TimetableWorkspace — tap-to-place', () => {
  it('places the selected subject in the cell that is tapped next', async () => {
    const { props } = renderWorkspace()
    // Before a palette pick the cells are the fallback dropdowns.
    expect(screen.getByLabelText('Period 1 Monday')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Mathematics 0\/2/ }))
    expect(screen.getByText(/Tap a cell to place Mathematics/)).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Period 1 Monday — empty'))
    expect(props.onSetCell).toHaveBeenCalledWith('Monday', 1, 'Mathematics')
  })

  it('clears a cell that already holds the selected subject', async () => {
    const block = { blockId: 'b1', day: 'Monday', slot: 1, length: 1, label: 'Mathematics', type: 'curriculum' }
    // cellState() reads the placed block off the model, not off `blocks`.
    const model = { ...gridModel, cells: { Monday: { 1: { state: 'filled', block } } } }
    const { props } = renderWorkspace({ blocks: [block], gridModel: model, filled: 1 })
    await userEvent.click(screen.getByRole('button', { name: /Mathematics 0\/2/ }))
    await userEvent.click(screen.getByLabelText('Period 1 Monday — Mathematics'))
    expect(props.onSetCell).toHaveBeenCalledWith('Monday', 1, '')
  })

  it('deselects the palette subject when its pill is tapped again', async () => {
    renderWorkspace()
    const pill = screen.getByRole('button', { name: /English 0\/2/ })
    await userEvent.click(pill)
    expect(pill).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pill)
    expect(pill).toHaveAttribute('aria-pressed', 'false')
    // Back to the dropdown fallback, so the grid is never unusable.
    expect(screen.getByLabelText('Period 1 Monday')).toBeInTheDocument()
  })
})

describe('TimetableWorkspace — drawers, not navigation', () => {
  it.each([
    ['Day times', 'day times drawer body'],
    ['Subjects', 'subjects drawer body'],
  ])('opens %s over the grid and closes again', async (button, body) => {
    renderWorkspace()
    expect(screen.queryByText(body)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: button }))
    expect(screen.getByText(body)).toBeInTheDocument()
    // The grid is still mounted underneath — this is a drawer, not a page.
    expect(screen.getByText('Grade 5 · 2026 — Class timetable')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByText(body)).not.toBeInTheDocument()
  })

  it('opens the conflicts panel from the status chip', async () => {
    renderWorkspace({ conflictsCount: 1 })
    await userEvent.click(screen.getByLabelText(/1 conflict — open the conflicts panel/i))
    expect(screen.getByText('conflicts drawer body')).toBeInTheDocument()
  })
})

describe('TimetableWorkspace — save and export refuse honestly while empty', () => {
  it('disables Save and every download item, with a reason, when nothing is placed', async () => {
    renderWorkspace({ filled: 0 })
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Download/ }))
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(3)
    items.forEach((item) => {
      expect(item).toBeDisabled()
      expect(item).toHaveAttribute('title', expect.stringMatching(/place/i))
    })
  })

  it('enables them once lessons are on the grid, and Save runs the final check', async () => {
    const { props } = renderWorkspace({ filled: 4 })
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(props.onFinalCheckAndSave).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Download/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Word/ }))
    expect(props.onExportDocx).toHaveBeenCalled()
  })
})
