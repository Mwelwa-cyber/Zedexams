/**
 * Term-grid behaviour: sticky header/identity pinning (with opaque
 * backgrounds and layered z-index at the intersection), month windowing at
 * realistic scale (60 learners), and click-to-cycle marking.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AttendanceGridView from './AttendanceGridView'
import { buildTermDays, resolveTermInfo } from '../../../../utils/attendanceCalendarResolver'
import { resolveAttendancePolicy } from '../../../../utils/attendanceConstants'

const TODAY = '2026-06-15'
const termInfo = resolveTermInfo({ term: 'Term 2', year: 2026 })
const days = buildTermDays({ termInfo, todayIso: TODAY })

function makeHook(overrides = {}) {
  const roster = Array.from({ length: 60 }, (_, i) => ({
    id: `L${i + 1}`,
    fullName: `Learner ${i + 1}`,
    learnerNumber: `ADM-${i + 1}`,
    order: i + 1,
    status: 'active',
  }))
  return {
    roster,
    termInfo,
    daysWithRecords: days.map((d) => ({ ...d, records: {} })),
    todayIso: TODAY,
    setStatusOn: vi.fn(),
    ...overrides,
  }
}

describe('AttendanceGridView', () => {
  it('renders a full 60-learner roster with month-windowed columns and sticky headers', () => {
    const { container } = render(
      <AttendanceGridView registerHook={makeHook()} canEdit policy={resolveAttendancePolicy()} />,
    )
    expect(screen.getByText('Learner 1')).toBeInTheDocument()
    expect(screen.getByText('Learner 60')).toBeInTheDocument()

    // Vertical scrolling happens inside the container so sticky top works.
    const scroller = container.querySelector('.overflow-auto')
    expect(scroller).not.toBeNull()

    // Date headers pin vertically (top offsets), identity columns pin left,
    // and their intersection sits on the top layer with an opaque background.
    const headerCells = container.querySelectorAll('thead th')
    for (const th of headerCells) {
      expect(th.className).toContain('sticky')
      expect(/top-0|top-8/.test(th.className)).toBe(true)
      expect(th.className).toContain('theme-card') // opaque, nothing shows through
    }
    const intersection = container.querySelector('thead th.left-0')
    expect(intersection.className).toContain('z-40')

    // Only ONE month of day columns is mounted at a time (June has 22
    // weekdays) — not the full ~65-day term.
    const firstRowCells = container.querySelectorAll('tbody tr:first-child button[data-cell]')
    expect(firstRowCells.length).toBeGreaterThan(15)
    expect(firstRowCells.length).toBeLessThan(30)
  })

  it('clicking a markable cell cycles the status via setStatusOn', () => {
    const hook = makeHook()
    render(<AttendanceGridView registerHook={hook} canEdit policy={resolveAttendancePolicy()} />)
    const cell = document.querySelector(`button[data-cell="L1|${TODAY}"]`)
    fireEvent.click(cell)
    expect(hook.setStatusOn).toHaveBeenCalledWith(TODAY, 'L1', 'present')
  })

  it('locked registers make cells read-only', () => {
    const hook = makeHook()
    render(<AttendanceGridView registerHook={hook} canEdit={false} policy={resolveAttendancePolicy()} />)
    const cell = document.querySelector(`button[data-cell="L1|${TODAY}"]`)
    fireEvent.click(cell)
    expect(hook.setStatusOn).not.toHaveBeenCalled()
  })
})
