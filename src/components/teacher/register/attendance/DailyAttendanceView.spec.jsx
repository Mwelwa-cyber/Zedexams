import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// The real service module initialises Firebase — the view only needs the
// error-copy map.
vi.mock('../../../../utils/attendanceService', () => ({
  ATTENDANCE_ERROR_MESSAGES: {
    TERM_LOCKED: 'This term’s register is locked — ask an administrator to reopen it. Your changes are kept until then.',
  },
}))

import DailyAttendanceView from './DailyAttendanceView'
import { buildTermDays, resolveTermInfo } from '../../../../utils/attendanceCalendarResolver'

const TODAY = '2026-06-15'
const termInfo = resolveTermInfo({ term: 'Term 2', year: 2026 })
const days = buildTermDays({ termInfo, todayIso: TODAY })

function makeHook(overrides = {}) {
  return {
    roster: [
      { id: 'a', fullName: 'Amos Banda', learnerNumber: 'ADM-1', order: 1, status: 'active' },
      { id: 'b', fullName: 'Bwalya Mwansa', learnerNumber: 'ADM-2', order: 2, status: 'active' },
      { id: 'late-joiner', fullName: 'Chanda Phiri', order: 3, status: 'active', joinedClassOn: '2026-07-01' },
    ],
    termInfo,
    days,
    todayIso: TODAY,
    selectedDate: TODAY,
    setSelectedDate: vi.fn(),
    displayedRecords: {},
    setStatus: vi.fn(),
    setNote: vi.fn(),
    markAllPresent: vi.fn(() => 2),
    undoLast: vi.fn(),
    canUndo: false,
    saveState: 'idle',
    pendingCount: 0,
    pendingLearnerIds: new Set(),
    syncIssues: [],
    retry: vi.fn(),
    saveNow: vi.fn(),
    hydrated: true,
    remoteEditNotice: null,
    dismissRemoteEditNotice: vi.fn(),
    resolveConflict: vi.fn(),
    retryRejected: vi.fn(),
    discardRejected: vi.fn(),
    ...overrides,
  }
}

const CAN_MARK = { allowed: true, reason: 'ok' }

describe('DailyAttendanceView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows only learners enrolled on the date, with marking progress', () => {
    render(<DailyAttendanceView registerHook={makeHook()} canMark={CAN_MARK} />)
    expect(screen.getByText('Amos Banda')).toBeInTheDocument()
    expect(screen.getByText('Bwalya Mwansa')).toBeInTheDocument()
    // joined 1 July → not eligible on 15 June
    expect(screen.queryByText('Chanda Phiri')).not.toBeInTheDocument()
    expect(screen.getByText('0 of 2 marked')).toBeInTheDocument()
    expect(screen.getByText('2 unmarked')).toBeInTheDocument()
  })

  it('mark-all-present drives the fast path', () => {
    const hook = makeHook()
    render(<DailyAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all present' }))
    expect(hook.markAllPresent).toHaveBeenCalledTimes(1)
  })

  it('marking a learner calls setStatus with the learner id', () => {
    const hook = makeHook()
    render(<DailyAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    const rows = screen.getAllByRole('radiogroup')
    fireEvent.click(rows[0].querySelector('[aria-label="Absent"]'))
    expect(hook.setStatus).toHaveBeenCalledWith('a', 'absent', {})
  })

  it('search filters the learner list', () => {
    render(<DailyAttendanceView registerHook={makeHook()} canMark={CAN_MARK} />)
    fireEvent.change(screen.getByLabelText('Search learner'), { target: { value: 'bwalya' } })
    expect(screen.queryByText('Amos Banda')).not.toBeInTheDocument()
    expect(screen.getByText('Bwalya Mwansa')).toBeInTheDocument()
  })

  it('locked terms show the blocked banner and disable marking controls', () => {
    render(<DailyAttendanceView registerHook={makeHook()} canMark={{ allowed: false, reason: 'locked' }} />)
    expect(screen.getByText(/register is locked/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all present' })).toBeDisabled()
  })

  it('a past date shows the correction notice and reason field', () => {
    render(<DailyAttendanceView registerHook={makeHook({ selectedDate: '2026-06-10' })} canMark={CAN_MARK} />)
    expect(screen.getByText(/correcting a past register day/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Reason for correction (optional)')).toBeInTheDocument()
  })

  it('shows retry when the save failed and the remote-edit warning when flagged', () => {
    render(<DailyAttendanceView
      registerHook={makeHook({ saveState: 'error', pendingCount: 1, remoteEditNotice: { date: TODAY, by: 'x' } })}
      canMark={CAN_MARK}
    />)
    expect(screen.getByText('Save failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
    expect(screen.getByText(/Another device updated/i)).toBeInTheDocument()
  })

  it('server rejections stay visible with retry/discard — never silently saved', () => {
    const hook = makeHook({
      saveState: 'rejected',
      pendingCount: 1,
      syncIssues: [{ date: TODAY, kind: 'rejected', code: 'TERM_LOCKED', learnerIds: ['a'] }],
    })
    render(<DailyAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(screen.getByText(/register is locked — ask an administrator/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(hook.retryRejected).toHaveBeenCalledWith(TODAY)
    fireEvent.click(screen.getByRole('button', { name: 'Discard my changes' }))
    expect(hook.discardRejected).toHaveBeenCalledWith(TODAY)
  })

  it('conflicts offer an explicit keep-mine / keep-theirs decision', () => {
    const hook = makeHook({
      saveState: 'conflict',
      syncIssues: [{ date: TODAY, kind: 'conflict', code: 'STALE_VERSION', learnerIds: ['a'] }],
    })
    render(<DailyAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(screen.getByText(/another teacher also changed Amos Banda/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my marks' }))
    expect(hook.resolveConflict).toHaveBeenCalledWith(TODAY, 'mine')
    fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
    expect(hook.resolveConflict).toHaveBeenCalledWith(TODAY, 'theirs')
  })

  it('empty roster shows the no-learners state', () => {
    render(<DailyAttendanceView registerHook={makeHook({ roster: [] })} canMark={CAN_MARK} />)
    expect(screen.getByText(/No learners are enrolled/i)).toBeInTheDocument()
  })
})
