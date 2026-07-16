/**
 * useClassRegister behaviour: hydration guard, optimistic marking, debounced
 * auto-save through the merging transaction, mark-all-present, undo, retry on
 * failure — and, implicitly, that the effect graph settles (a maximum-update-
 * depth loop would crash these renders).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const subs = { roster: null, term: null, termAtt: null, day: null }

vi.mock('../utils/classRoster', () => ({
  subscribeRoster: vi.fn((classId, cb) => { subs.roster = cb; return () => {} }),
}))

const saveAttendanceDay = vi.fn()
const logAttendanceAudit = vi.fn(() => Promise.resolve())
vi.mock('../utils/attendanceService', () => ({
  subscribeAttendanceDay: vi.fn((classId, date, cb) => { subs.day = cb; return () => {} }),
  subscribeAttendanceTerm: vi.fn((classId, termId, cb) => { subs.term = cb; return () => {} }),
  subscribeTermAttendance: vi.fn((classId, termId, cb) => { subs.termAtt = cb; return () => {} }),
  saveAttendanceDay: (...args) => saveAttendanceDay(...args),
  logAttendanceAudit: (...args) => logAttendanceAudit(...args),
}))

import useClassRegister from './useClassRegister'

const register = { id: 'c1', teacherUid: 't1', className: 'Grade 4 Blue' }
const termSelection = { term: 'Term 2', year: 2026 } // MoE: 2026-05-11 → 2026-08-07

function hydrate({ roster, termDoc = null, termDays = [], day = null } = {}) {
  act(() => {
    subs.roster(roster)
    subs.term(termDoc)
    subs.termAtt(termDays)
    subs.day(day)
  })
}

const ROSTER = [
  { id: 'a', fullName: 'Amos Banda', order: 1, status: 'active' },
  { id: 'b', fullName: 'Bwalya Mwansa', order: 2, status: 'active' },
  { id: 'c', fullName: 'Chanda Phiri', order: 3, status: 'active', joinedClassOn: '2026-07-01' },
]

describe('useClassRegister', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // A Monday inside Term 2 2026 — deterministic, never the session's date.
    vi.setSystemTime(new Date('2026-06-15T09:00:00'))
    saveAttendanceDay.mockReset().mockImplementation(async ({ localChanges }) => ({
      records: { ...localChanges }, version: 2, conflicts: [],
    }))
    logAttendanceAudit.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    return renderHook(() => useClassRegister({ register, termSelection, uid: 't1' }))
  }

  it('resolves the MoE term, defaults to today, and hydrates', () => {
    const { result } = setup()
    expect(result.current.termId).toBe('2026-T2')
    expect(result.current.termInfo.startDate).toBe('2026-05-11')
    expect(result.current.hydrated).toBe(false)
    hydrate({ roster: ROSTER })
    expect(result.current.hydrated).toBe(true)
    expect(result.current.selectedDate).toBe('2026-06-15')
  })

  it('never mutates before hydration (no save during initial load)', () => {
    const { result } = setup()
    act(() => { result.current.setStatus('a', 'present') })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(saveAttendanceDay).not.toHaveBeenCalled()
    expect(result.current.pendingCount).toBe(0)
  })

  it('marks optimistically then auto-saves the debounced batch with an audit entry', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    act(() => { result.current.setStatus('a', 'absent') })
    expect(result.current.displayedRecords.a.status).toBe('absent')
    expect(result.current.saveState).toBe('dirty')
    expect(saveAttendanceDay).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(saveAttendanceDay).toHaveBeenCalledTimes(1)
    const call = saveAttendanceDay.mock.calls[0][0]
    expect(call.classId).toBe('c1')
    expect(call.date).toBe('2026-06-15')
    expect(call.termMeta.termId).toBe('2026-T2')
    expect(call.localChanges).toEqual({ a: { status: 'absent', note: '' } })
    expect(result.current.saveState).toBe('saved')
    expect(logAttendanceAudit).toHaveBeenCalledTimes(1)
    const [, , entries, context] = logAttendanceAudit.mock.calls[0]
    expect(entries).toEqual([{ learnerId: 'a', prevStatus: null, newStatus: 'absent', prevNote: '', newNote: '' }])
    expect(context.action).toBe('mark')
  })

  it('mark-all-present marks only unmarked eligible learners (exceptions kept)', () => {
    const { result } = setup()
    hydrate({
      roster: ROSTER,
      day: { date: '2026-06-15', version: 1, records: { b: { status: 'sick', note: '' } } },
    })
    let count
    act(() => { count = result.current.markAllPresent() })
    // c joined 1 July → not eligible on 15 June; b already marked sick.
    expect(count).toBe(1)
    expect(result.current.displayedRecords.a.status).toBe('present')
    expect(result.current.displayedRecords.b.status).toBe('sick')
    expect(result.current.displayedRecords.c).toBeUndefined()
  })

  it('undo reverts the last change', () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    act(() => { result.current.setStatus('a', 'present') })
    act(() => { result.current.setStatus('a', 'late') })
    expect(result.current.displayedRecords.a.status).toBe('late')
    act(() => { result.current.undoLast() })
    expect(result.current.displayedRecords.a.status).toBe('present')
    act(() => { result.current.undoLast() })
    expect(result.current.displayedRecords.a).toBeUndefined()
  })

  it('keeps the batch and reports error state when the save fails, then retries', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    saveAttendanceDay.mockRejectedValueOnce(new Error('offline'))
    act(() => { result.current.setStatus('a', 'present') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.saveState).toBe('error')
    expect(result.current.pendingCount).toBe(1)

    await act(async () => {
      result.current.retry()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.saveState).toBe('saved')
    expect(saveAttendanceDay).toHaveBeenCalledTimes(2)
    expect(result.current.pendingCount).toBe(0)
  })

  it('flags a correction (with reason) when editing a past day', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    act(() => { result.current.setSelectedDate('2026-06-10') })
    act(() => { subs.day(null) }) // day-doc snapshot for the new date
    act(() => { result.current.setStatus('a', 'excused', { correctionReason: 'Clinic letter arrived' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    const [, , , context] = logAttendanceAudit.mock.calls[0]
    expect(context.action).toBe('correction')
    expect(context.reason).toBe('Clinic letter arrived')
    expect(context.date).toBe('2026-06-10')
  })

  it('surfaces concurrent-edit conflicts from the merge transaction', async () => {
    const onConflict = vi.fn()
    const { result } = renderHook(() => useClassRegister({ register, termSelection, uid: 't1', onConflict }))
    hydrate({ roster: ROSTER })
    saveAttendanceDay.mockResolvedValueOnce({ records: {}, version: 3, conflicts: ['a'] })
    act(() => { result.current.setStatus('a', 'present') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(onConflict).toHaveBeenCalledWith({ date: '2026-06-15', learnerIds: ['a'] })
  })

  it('exposes a calendar-not-configured state for uncovered years without custom dates', () => {
    const { result } = renderHook(() => useClassRegister({
      register, termSelection: { term: 'Term 1', year: 2024 }, uid: 't1',
    }))
    act(() => { subs.term(null) })
    expect(result.current.termInfo).toBeNull()
    expect(result.current.days).toEqual([])
    // …until the attendanceTerms doc supplies custom dates.
    act(() => { subs.term({ state: 'draft', customStartDate: '2024-01-08', customEndDate: '2024-03-28' }) })
    expect(result.current.termInfo?.source).toBe('custom')
    expect(result.current.days.length).toBeGreaterThan(0)
  })
})
