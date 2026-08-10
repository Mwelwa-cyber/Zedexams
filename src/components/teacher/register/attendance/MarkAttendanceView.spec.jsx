/**
 * MarkAttendanceView — the behaviours a register of 86 learners depends on.
 *
 * Four of these are rules rather than features, and each has burned somebody
 * in a real register somewhere:
 *
 *   Unmarked is counted apart from absent, always.
 *   Mark-all-present exists and does not have to be undone learner by learner.
 *   Keyboard shortcuts stop while the teacher is typing, or searching for
 *     "Phiri" marks four children present, sick and absent on the way.
 *   A learner outside their enrolment window is not on the day at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import MarkAttendanceView from './MarkAttendanceView'

vi.mock('../../../ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// Desktop by default, so the keyboard path is exercised.
vi.mock('../../../../shared/hooks/useIsMobile', () => ({ default: () => false }))

const TERM = { startDate: '2026-05-11', endDate: '2026-08-07' }
const TODAY = '2026-05-14'

function makeRoster(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i + 1}`,
    order: i + 1,
    fullName: `Learner ${i + 1}`,
    admissionNumber: `ADM-${String(i + 1).padStart(3, '0')}`,
  }))
}

function makeHook(over = {}) {
  const setStatus = vi.fn()
  const markAllPresent = vi.fn(() => 3)
  return {
    roster: makeRoster(3),
    termInfo: TERM,
    days: [{ date: TODAY, markable: true, isFuture: false }],
    todayIso: TODAY,
    selectedDate: TODAY,
    setSelectedDate: vi.fn(),
    displayedRecords: {},
    setStatus,
    setNote: vi.fn(),
    markAllPresent,
    undoLast: vi.fn(() => true),
    canUndo: false,
    saveState: 'saved',
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
    ...over,
  }
}

const CAN_MARK = { allowed: true, reason: 'ok' }

function totalFor(label) {
  const list = screen.getByLabelText('Attendance totals for this day')
  const tile = within(list).getByText(label).closest('li')
  return tile.querySelector('p:last-child').textContent
}

describe('MarkAttendanceView — unmarked is never absent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts an unmarked learner as unmarked, and absent stays zero', () => {
    render(<MarkAttendanceView registerHook={makeHook()} canMark={CAN_MARK} />)
    expect(totalFor('Unmarked')).toBe('3')
    expect(totalFor('Absent')).toBe('0')
    expect(totalFor('Total')).toBe('3')
  })

  it('moves a learner out of unmarked when they are marked, into their own status', () => {
    const hook = makeHook({
      displayedRecords: { l1: { status: 'present' }, l2: { status: 'absent' } },
    })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(totalFor('Present')).toBe('1')
    expect(totalFor('Absent')).toBe('1')
    expect(totalFor('Unmarked')).toBe('1')
  })

  it('offers Unmarked as its own filter, separate from Absent', async () => {
    const hook = makeHook({ displayedRecords: { l1: { status: 'present' } } })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByRole('button', { name: /^Unmarked 2$/ }))
    expect(screen.getByText('Learner 2')).toBeInTheDocument()
    expect(screen.queryByText('Learner 1')).not.toBeInTheDocument()
  })
})

describe('MarkAttendanceView — exception-first marking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the whole class present in one press', async () => {
    const hook = makeHook()
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark all present' }))
    expect(hook.markAllPresent).toHaveBeenCalledTimes(1)
  })

  it('lets a single learner be changed afterwards without touching the rest', async () => {
    const hook = makeHook({
      displayedRecords: { l1: { status: 'present' }, l2: { status: 'present' }, l3: { status: 'present' } },
    })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByRole('button', { name: 'Absent — Learner 2' }))
    expect(hook.setStatus).toHaveBeenCalledTimes(1)
    expect(hook.setStatus).toHaveBeenCalledWith('l2', 'absent', {})
  })

  it('keeps late, excused and not-applicable off the row, behind More', async () => {
    render(<MarkAttendanceView registerHook={makeHook()} canMark={CAN_MARK} />)
    expect(screen.queryByRole('button', { name: 'Late — Learner 1' })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /More attendance options/ })[0])
    expect(screen.getByRole('button', { name: /^L\s*Late$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Clear status/ })).toBeInTheDocument()
  })
})

describe('MarkAttendanceView — keyboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the focused learner from the keyboard', async () => {
    const hook = makeHook()
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByText('Learner 2'))
    await userEvent.keyboard('a')
    expect(hook.setStatus).toHaveBeenCalledWith('l2', 'absent', {})
  })

  it('clears a status with Delete', async () => {
    const hook = makeHook({ displayedRecords: { l1: { status: 'present' } } })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByText('Learner 1'))
    await userEvent.keyboard('{Delete}')
    expect(hook.setStatus).toHaveBeenCalledWith('l1', null, {})
  })

  it('does NOT fire while the teacher is typing in the search box', async () => {
    const hook = makeHook()
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.type(screen.getByLabelText('Search learner'), 'Phiri')
    expect(hook.setStatus).not.toHaveBeenCalled()
  })
})

describe('MarkAttendanceView — one-by-one mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows one learner at a time with their position in the class', async () => {
    render(<MarkAttendanceView registerHook={makeHook()} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByRole('button', { name: 'One by one' }))
    expect(screen.getByText('Learner 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('ADM-001')).toBeInTheDocument()
    expect(screen.queryByText('Learner 3')).not.toBeInTheDocument()
  })

  it('advances to the next learner after a mark', async () => {
    const hook = makeHook()
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.click(screen.getByRole('button', { name: 'One by one' }))
    await userEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(hook.setStatus).toHaveBeenCalledWith('l1', 'present', {})
    expect(screen.getByText('Learner 2 of 3')).toBeInTheDocument()
  })
})

describe('MarkAttendanceView — days and enrolment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says plainly when the day is not a teaching day, and disables marking', () => {
    render(<MarkAttendanceView registerHook={makeHook()} canMark={{ allowed: false, reason: 'non_teaching' }} />)
    expect(screen.getByText(/not a scheduled teaching day/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all present' })).toBeDisabled()
  })

  it('leaves a learner off a day before their admission date', () => {
    const hook = makeHook({
      roster: [
        { id: 'l1', order: 1, fullName: 'Already Here', admissionNumber: 'ADM-001' },
        { id: 'l2', order: 2, fullName: 'Joins Later', admissionNumber: 'ADM-002', joinedClassOn: '2026-06-01' },
      ],
    })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(screen.getByText('Already Here')).toBeInTheDocument()
    expect(screen.queryByText('Joins Later')).not.toBeInTheDocument()
    expect(totalFor('Total')).toBe('1')
  })

  it('leaves a learner off a day after they left', () => {
    const hook = makeHook({
      roster: [
        { id: 'l1', order: 1, fullName: 'Still Here', admissionNumber: 'ADM-001' },
        { id: 'l2', order: 2, fullName: 'Transferred Out', admissionNumber: 'ADM-002', leftClassOn: '2026-05-12' },
      ],
    })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(screen.queryByText('Transferred Out')).not.toBeInTheDocument()
  })

  it('asks for a reason when a past day is being corrected', () => {
    const hook = makeHook({ selectedDate: '2026-05-12', todayIso: TODAY })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(screen.getByLabelText(/Reason for correcting a past day/i)).toBeInTheDocument()
    expect(screen.getByText(/recorded in the audit trail/i)).toBeInTheDocument()
  })
})

describe('MarkAttendanceView — offline and sync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says the work is saved on the device, not that it is lost', () => {
    render(<MarkAttendanceView registerHook={makeHook({ saveState: 'offline' })} canMark={CAN_MARK} />)
    expect(screen.getByText(/Saved on this device/i)).toBeInTheDocument()
  })

  it('surfaces a conflict with both resolutions rather than picking one', () => {
    const hook = makeHook({
      saveState: 'conflict',
      syncIssues: [{ kind: 'conflict', date: TODAY, learnerIds: ['l1'] }],
    })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Learner 1')
    expect(screen.getByRole('button', { name: 'Keep my marks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument()
  })
})

describe('MarkAttendanceView — a class of 100', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders every learner and counts them all as unmarked', () => {
    const hook = makeHook({ roster: makeRoster(100) })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    expect(totalFor('Total')).toBe('100')
    expect(totalFor('Unmarked')).toBe('100')
    expect(screen.getByText('Learner 100')).toBeInTheDocument()
    expect(screen.getByText('0 of 100 learners marked')).toBeInTheDocument()
  })

  it('narrows a hundred learners to one with the search box', async () => {
    const hook = makeHook({ roster: makeRoster(100) })
    render(<MarkAttendanceView registerHook={hook} canMark={CAN_MARK} />)
    await userEvent.type(screen.getByLabelText('Search learner'), 'ADM-042')
    expect(screen.getByText('Learner 42')).toBeInTheDocument()
    expect(screen.queryByText('Learner 43')).not.toBeInTheDocument()
  })
})
