/**
 * Term-grid behaviour: sticky header/identity pinning (with opaque
 * backgrounds and layered z-index at the intersection), month windowing at
 * realistic scale (60 learners), and click-to-cycle marking.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AttendanceGridView from './AttendanceGridView'
import { buildTermDays, markableDays, resolveTermInfo } from '../../../../utils/attendanceCalendarResolver'
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

  it('with no records: every % cell is —, and Elig counts markable days only', () => {
    const { container } = render(
      <AttendanceGridView registerHook={makeHook()} canEdit policy={resolveAttendancePolicy()} />,
    )
    // The totals engine must be fed the FILTERED calendar — weekends, holidays
    // and future dates never inflate the eligible-day denominator.
    const expectedElig = String(markableDays(days).length)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(60)
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')]
      const eligCell = cells[cells.length - 2]
      const percentCell = cells[cells.length - 1]
      expect(eligCell.textContent).toBe(expectedElig)
      expect(percentCell.textContent).toBe('—')
      expect(percentCell.getAttribute('title')).toBe('Calculates as you mark')
    }
  })

  it('renders a six-entry legend in the mark colours plus the % note', () => {
    render(<AttendanceGridView registerHook={makeHook()} canEdit policy={resolveAttendancePolicy()} />)
    const legend = within(screen.getByTestId('attendance-grid-legend'))
    for (const label of ['Present', 'Absent', 'Sick', 'Late', 'Excused', 'Not applicable']) {
      expect(legend.getByText(label)).toBeInTheDocument()
    }
    // Squares carry each status's chipClass so the key matches the cells.
    expect(legend.getByText('P').className).toContain('bg-green-100')
    expect(legend.getByText('–').className).toContain('bg-gray-100')
    expect(legend.getByText('% appears once days are marked')).toBeInTheDocument()
  })

  describe('input-aware helper text', () => {
    afterEach(() => { delete window.matchMedia })

    it('shows tap wording on coarse-pointer (touch) devices', () => {
      window.matchMedia = vi.fn((query) => ({ matches: query === '(pointer: coarse)' }))
      render(<AttendanceGridView registerHook={makeHook()} canEdit policy={resolveAttendancePolicy()} />)
      expect(screen.getByText('Tap a cell to cycle P → A → S → L → E → –')).toBeInTheDocument()
      expect(screen.queryByText(/arrow keys to move/)).toBeNull()
    })

    it('shows click + arrow-key wording on fine-pointer devices', () => {
      window.matchMedia = vi.fn(() => ({ matches: false }))
      render(<AttendanceGridView registerHook={makeHook()} canEdit policy={resolveAttendancePolicy()} />)
      expect(
        screen.getByText('Click a cell to cycle P → A → S → L → E → – · arrow keys to move'),
      ).toBeInTheDocument()
    })
  })
})
