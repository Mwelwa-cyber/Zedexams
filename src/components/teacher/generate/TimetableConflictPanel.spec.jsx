/**
 * Vitest (jsdom) tests for the Timetable conflicts panel — summary counts,
 * presentation filters, resolution-action callbacks, coverage display and
 * the loading / error / offline / stale / empty / success states.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TimetableConflictPanel from './TimetableConflictPanel'

const block = (over = {}) => ({
  blockId: 'blk_monday_1',
  day: 'monday',
  startTime: '08:15',
  endTime: '08:55',
  startMinutes: 495,
  endMinutes: 535,
  length: 1,
  timeReview: false,
  subjectDisplayName: 'English Language',
  ...over,
})

const teacherConflict = {
  conflictId: 'cf__teacher__cur__blk_monday_1__sib1__blk_monday_2',
  type: 'teacher',
  severity: 'error',
  teacherId: 'uid_1',
  teacherDisplayName: 'Mahenga Mwelwa',
  currentBlock: block(),
  siblingBlock: block({ blockId: 'blk_monday_2', subjectDisplayName: 'Mathematics', startTime: '08:35', endTime: '09:15' }),
  siblingTimetableId: 'sib1',
  siblingTimetableTitle: 'Grade 6 Green · Term 1 · 2026',
  message: 'Mahenga Mwelwa is scheduled for Grade 5 Blue English Language and Grade 6 Green Mathematics on Monday from 08:35 to 08:55.',
}

const roomWarning = {
  conflictId: 'cf__room__cur__blk_tuesday_1__sib2__blk_tuesday_1',
  type: 'room',
  severity: 'warning',
  identityUnverified: true,
  roomDisplayName: 'Room 12',
  currentBlock: block({ blockId: 'blk_tuesday_1', day: 'tuesday', subjectDisplayName: 'Science' }),
  siblingBlock: block({ blockId: 'blk_tuesday_1x', day: 'tuesday', subjectDisplayName: 'Maths' }),
  siblingTimetableId: 'sib2',
  siblingTimetableTitle: 'Grade 4 Red · Term 1 · 2026',
  message: 'Rooms named “Room 12” are booked in two classes at overlapping times on Tuesday.',
}

const coverage = {
  status: 'partial',
  siblingsChecked: 2,
  blocksChecked: 30,
  blocksWithTeacherIds: 24,
  legacyTeacherNameBlocks: 6,
  blocksWithRoomIds: 4,
  labelOnlyRoomBlocks: 2,
  timeNormalisationFailures: 0,
  conflictCount: 2,
  notes: ['6 blocks carry a teacher name without a linked teacher account — teacher conflicts for those blocks could not be verified reliably.'],
}

function renderPanel(over = {}) {
  const handlers = {
    onRefresh: vi.fn(),
    onSelectConflict: vi.fn(),
    onOpenTimetable: vi.fn(),
    onChangeTeacher: vi.fn(),
    onChangeRoom: vi.fn(),
    onMoveLesson: vi.fn(),
  }
  const utils = render(
    <TimetableConflictPanel
      conflicts={[teacherConflict, roomWarning]}
      coverage={coverage}
      status="ready"
      lastCheckedAt={Date.now()}
      currentTimetableId="cur"
      currentClassName="Grade 5 Blue"
      days={['Monday', 'Tuesday']}
      {...handlers}
      {...over}
    />,
  )
  return { ...utils, handlers }
}

describe('TimetableConflictPanel', () => {
  it('shows correct summary counts per category', () => {
    renderPanel()
    // 1 teacher error, 0 confirmed room errors, 0 class errors, 1 warning.
    expect(screen.getByText('Teacher conflicts').previousSibling.textContent).toBe('1')
    expect(screen.getByText('Room conflicts').previousSibling.textContent).toBe('0')
    expect(screen.getByText('Class conflicts').previousSibling.textContent).toBe('0')
    // "Warnings" is also a filter chip — scope to the summary card label.
    const warningsCard = screen.getAllByText('Warnings').find((el) => el.previousSibling)
    expect(warningsCard.previousSibling.textContent).toBe('1')
  })

  it('renders conflict details with severity text (not colour alone) and the source timetable', () => {
    renderPanel()
    expect(screen.getByText(/Error · Teacher conflict/)).toBeInTheDocument()
    expect(screen.getByText(/Warning · Room conflict · identity unverified/)).toBeInTheDocument()
    expect(screen.getByText(/vs Grade 6 Green · Term 1 · 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Mahenga Mwelwa is scheduled/)).toBeInTheDocument()
  })

  it('filters are presentation-only: Teacher filter hides the room warning', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Teacher' }))
    expect(screen.getByText(/Error · Teacher conflict/)).toBeInTheDocument()
    expect(screen.queryByText(/Warning · Room conflict/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Warnings' }))
    expect(screen.queryByText(/Error · Teacher conflict/)).not.toBeInTheDocument()
    expect(screen.getByText(/Warning · Room conflict/)).toBeInTheDocument()
  })

  it('day filter narrows the list to the selected day', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Filter conflicts by day'), { target: { value: 'Tuesday' } })
    expect(screen.queryByText(/Error · Teacher conflict/)).not.toBeInTheDocument()
    expect(screen.getByText(/Warning · Room conflict/)).toBeInTheDocument()
  })

  it('wires the resolution actions to their callbacks', () => {
    const { handlers } = renderPanel()
    fireEvent.click(screen.getAllByRole('button', { name: /Show the affected/ })[0])
    expect(handlers.onSelectConflict).toHaveBeenCalledWith(expect.objectContaining({ conflictId: teacherConflict.conflictId }))
    fireEvent.click(screen.getAllByRole('button', { name: /Open the conflicting timetable/ })[0])
    expect(handlers.onOpenTimetable).toHaveBeenCalledWith('sib1')
    fireEvent.click(screen.getByRole('button', { name: 'Change teacher' }))
    expect(handlers.onChangeTeacher).toHaveBeenCalledWith('blk_monday_1')
    fireEvent.click(screen.getByRole('button', { name: 'Change room' }))
    expect(handlers.onChangeRoom).toHaveBeenCalledWith('blk_tuesday_1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move lesson' })[0])
    expect(handlers.onMoveLesson).toHaveBeenCalledWith('blk_monday_1')
  })

  it('refresh button calls onRefresh and shows the checking state', () => {
    const { handlers } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Refresh conflicts/ }))
    expect(handlers.onRefresh).toHaveBeenCalled()
    renderPanel({ status: 'loading' })
    expect(screen.getByText('Checking conflicts…')).toBeInTheDocument()
  })

  it('states account-level coverage honestly — never claims all school timetables were checked', () => {
    renderPanel()
    expect(screen.getByText(/Conflict coverage: Account-level/)).toBeInTheDocument()
    expect(screen.getByText(/Timetables owned by other school accounts may not be included/)).toBeInTheDocument()
    expect(screen.queryByText(/All school timetables checked/i)).not.toBeInTheDocument()
  })

  it('shows partial coverage so "0 conflicts" is never fully trusted, and the failure state', () => {
    renderPanel({ conflicts: [] })
    expect(screen.getByText(/Account-level · Partial/)).toBeInTheDocument()
    expect(screen.getByText(/No confirmed conflicts — checked against/)).toBeInTheDocument()
    expect(screen.getByText(/could not be fully checked/)).toBeInTheDocument()
    renderPanel({ status: 'error', errorMessage: 'network down' })
    expect(screen.getByText(/Conflict check failed — network down/)).toBeInTheDocument()
  })

  it('renders the clean success and no-siblings empty states', () => {
    renderPanel({
      conflicts: [],
      coverage: { ...coverage, status: 'complete', legacyTeacherNameBlocks: 0, labelOnlyRoomBlocks: 0, notes: [] },
    })
    expect(screen.getByText(/No conflicts — checked against/)).toBeInTheDocument()
    renderPanel({ conflicts: [], coverage: { ...coverage, siblingsChecked: 0, notes: [] } })
    expect(screen.getByText(/No conflicts — no other active class timetables were found/)).toBeInTheDocument()
  })

  it('marks offline results as potentially stale and lists freshly-updated siblings', () => {
    renderPanel({ offline: true, staleSiblings: ['Grade 6 Green · Term 1 · 2026'] })
    expect(screen.getByText(/You are offline/)).toBeInTheDocument()
    expect(screen.getByText(/Updated since your last check/)).toBeInTheDocument()
    expect(screen.getByText(/Grade 6 Green · Term 1 · 2026 — results below already reflect/)).toBeInTheDocument()
  })
})
