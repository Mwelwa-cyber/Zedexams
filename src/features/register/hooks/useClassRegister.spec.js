/**
 * useClassRegister behaviour under the hardened outbox model: hydration
 * guard, optimistic marking, debounced submission to the authoritative
 * saveClassAttendance callable, offline queuing + reconnect replay, server
 * rejections staying visible (never silently "saved"), STALE_VERSION
 * rebase + conflict review, undo, and localStorage outbox persistence —
 * and, implicitly, that the effect graph settles (a maximum-update-depth
 * loop would crash these renders).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const subs = { roster: null, term: null, termAtt: null, day: null }

vi.mock('../../../utils/classRoster', () => ({
  subscribeRoster: vi.fn((classId, cb) => { subs.roster = cb; return () => {} }),
}))

const submitAttendanceDay = vi.fn()
const getAttendanceDay = vi.fn()
vi.mock('../services/attendanceService', () => ({
  subscribeAttendanceDay: vi.fn((classId, date, cb) => { subs.day = cb; return () => {} }),
  subscribeAttendanceTerm: vi.fn((classId, termId, cb) => { subs.term = cb; return () => {} }),
  subscribeTermAttendance: vi.fn((classId, termId, cb) => { subs.termAtt = cb; return () => {} }),
  submitAttendanceDay: (...args) => submitAttendanceDay(...args),
  getAttendanceDay: (...args) => getAttendanceDay(...args),
  // Mirror of the real normaliser's contract: details.code wins, anything
  // unrecognised is a NETWORK (offline) transport failure.
  normalizeAttendanceError: (err) => {
    const code = err?.details?.code
    if (typeof code === 'string' && code !== 'NETWORK') return { code, details: err.details, offline: false }
    return { code: 'NETWORK', details: {}, offline: true }
  },
  ATTENDANCE_ERROR_MESSAGES: {},
}))

import useClassRegister from './useClassRegister'

const register = { id: 'c1', teacherUid: 't1', className: 'Grade 4 Blue', grade: '4' }
const termSelection = { term: 'Term 2', year: 2026 } // MoE: 2026-05-11 → 2026-08-07

function serverError(code, details = {}) {
  const err = new Error(code)
  err.details = { code, ...details }
  return err
}

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
    localStorage.clear()
    submitAttendanceDay.mockReset().mockResolvedValue({ ok: true, version: 1, counts: {}, termId: '2026-T2', changed: 1 })
    getAttendanceDay.mockReset().mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(extra = {}) {
    return renderHook(() => useClassRegister({ register, termSelection, uid: 't1', ...extra }))
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

  it('never mutates before hydration (no submit during initial load)', () => {
    const { result } = setup()
    act(() => { result.current.setStatus('a', 'present') })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(submitAttendanceDay).not.toHaveBeenCalled()
    expect(result.current.pendingCount).toBe(0)
  })

  it('marks optimistically, then submits the debounced batch to the server mutation', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    act(() => { result.current.setStatus('a', 'absent') })
    expect(result.current.displayedRecords.a.status).toBe('absent')
    expect(result.current.saveState).toBe('dirty')
    expect(submitAttendanceDay).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(submitAttendanceDay).toHaveBeenCalledTimes(1)
    const call = submitAttendanceDay.mock.calls[0][0]
    expect(call.classId).toBe('c1')
    expect(call.date).toBe('2026-06-15')
    expect(call.termId).toBe('2026-T2')
    expect(call.baseVersion).toBe(0)
    expect(call.records).toEqual({ a: { status: 'absent', note: '' } })
    expect(result.current.saveState).toBe('saved')
    expect(result.current.pendingCount).toBe(0)
  })

  it('passes the correction reason through when editing a past day', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    act(() => { result.current.setSelectedDate('2026-06-10') })
    act(() => { subs.day(null) })
    act(() => { result.current.setStatus('a', 'excused', { correctionReason: 'Clinic letter arrived' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(submitAttendanceDay.mock.calls[0][0].reason).toBe('Clinic letter arrived')
    expect(submitAttendanceDay.mock.calls[0][0].date).toBe('2026-06-10')
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

  it('a server rejection (TERM_LOCKED) stays visible with the changes intact — never silently saved', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    submitAttendanceDay.mockRejectedValueOnce(serverError('TERM_LOCKED'))
    act(() => { result.current.setStatus('a', 'present') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.saveState).toBe('rejected')
    expect(result.current.syncIssues).toEqual([
      { date: '2026-06-15', kind: 'rejected', code: 'TERM_LOCKED', learnerIds: ['a'] },
    ])
    expect(result.current.displayedRecords.a.status).toBe('present') // local change preserved
    // Admin reopens → retry succeeds.
    await act(async () => {
      result.current.retryRejected('2026-06-15')
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.saveState).toBe('saved')
    expect(result.current.syncIssues).toEqual([])
  })

  it('a rejected date can be explicitly discarded', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    submitAttendanceDay.mockRejectedValueOnce(serverError('LEARNER_NOT_ELIGIBLE', { learnerId: 'a' }))
    act(() => { result.current.setStatus('a', 'present') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.saveState).toBe('rejected')
    act(() => { result.current.discardRejected('2026-06-15') })
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.displayedRecords.a).toBeUndefined()
  })

  it('an offline (network) failure keeps the op queued and replays on reconnect', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    submitAttendanceDay.mockRejectedValueOnce(new Error('functions/unavailable'))
    act(() => { result.current.setStatus('a', 'present') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.pendingCount).toBe(1)
    expect(['dirty', 'offline']).toContain(result.current.saveState)
    // Connectivity returns → the 'online' event drains the outbox.
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(submitAttendanceDay).toHaveBeenCalledTimes(2)
    expect(result.current.saveState).toBe('saved')
  })

  it('an offline op queued before the term locked is rejected visibly after reconnect', async () => {
    // Simulates a previous offline session: the op is restored from
    // localStorage, then the server (term now locked) refuses it.
    localStorage.setItem('zedexams:attendanceOutbox:t1:c1:2026-T2', JSON.stringify({
      '2026-06-12': { baseVersion: 0, base: {}, changes: { a: { status: 'present', note: '' } }, reason: '' },
    }))
    submitAttendanceDay.mockRejectedValue(serverError('TERM_LOCKED'))
    const { result } = setup()
    hydrate({ roster: ROSTER })
    expect(result.current.pendingCount).toBe(1) // restored, shown as pending
    await act(async () => {
      result.current.saveNow()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.saveState).toBe('rejected')
    expect(result.current.syncIssues[0]).toMatchObject({ date: '2026-06-12', code: 'TERM_LOCKED' })
    expect(result.current.pendingCount).toBe(1) // nothing silently dropped
  })

  it('persists the outbox to localStorage as changes are made', () => {
    const { result } = setup()
    hydrate({ roster: ROSTER })
    act(() => { result.current.setStatus('a', 'sick') })
    const stored = JSON.parse(localStorage.getItem('zedexams:attendanceOutbox:t1:c1:2026-T2'))
    expect(stored['2026-06-15'].changes.a.status).toBe('sick')
  })

  it('STALE_VERSION with no overlap rebases and auto-resubmits', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER, day: { date: '2026-06-15', version: 1, records: {} } })
    submitAttendanceDay
      .mockRejectedValueOnce(serverError('STALE_VERSION', { currentVersion: 2 }))
      .mockResolvedValueOnce({ ok: true, version: 3, counts: {}, termId: '2026-T2', changed: 1 })
    // Another teacher marked b; we mark a.
    getAttendanceDay.mockResolvedValue({ date: '2026-06-15', version: 2, records: { b: { status: 'present', note: '' } } })
    act(() => { result.current.setStatus('a', 'late') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(submitAttendanceDay).toHaveBeenCalledTimes(2)
    expect(submitAttendanceDay.mock.calls[1][0].baseVersion).toBe(2) // rebased
    expect(submitAttendanceDay.mock.calls[1][0].records).toEqual({ a: { status: 'late', note: '' } })
    expect(result.current.saveState).toBe('saved')
  })

  it('STALE_VERSION with a real overlap becomes an explicit conflict decision', async () => {
    const onConflict = vi.fn()
    const { result } = setup({ onConflict })
    hydrate({ roster: ROSTER, day: { date: '2026-06-15', version: 1, records: { a: { status: 'present', note: '' } } } })
    submitAttendanceDay.mockRejectedValueOnce(serverError('STALE_VERSION', { currentVersion: 2 }))
    // They flipped a → absent while we flipped a → sick.
    getAttendanceDay.mockResolvedValue({ date: '2026-06-15', version: 2, records: { a: { status: 'absent', note: '' } } })
    act(() => { result.current.setStatus('a', 'sick') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.saveState).toBe('conflict')
    expect(result.current.syncIssues[0]).toMatchObject({ kind: 'conflict', learnerIds: ['a'] })
    expect(onConflict).toHaveBeenCalledWith({ date: '2026-06-15', learnerIds: ['a'] })
    expect(result.current.displayedRecords.a.status).toBe('sick') // ours still visible, not overwritten

    // Keep theirs → local change dropped, nothing submitted.
    submitAttendanceDay.mockClear()
    await act(async () => {
      result.current.resolveConflict('2026-06-15', 'theirs')
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.pendingCount).toBe(0)
    expect(submitAttendanceDay).not.toHaveBeenCalled()
  })

  it('keep-mine resubmits the conflicting rows over the rebased version', async () => {
    const { result } = setup()
    hydrate({ roster: ROSTER, day: { date: '2026-06-15', version: 1, records: { a: { status: 'present', note: '' } } } })
    submitAttendanceDay.mockRejectedValueOnce(serverError('STALE_VERSION', { currentVersion: 2 }))
    getAttendanceDay.mockResolvedValue({ date: '2026-06-15', version: 2, records: { a: { status: 'absent', note: '' } } })
    act(() => { result.current.setStatus('a', 'sick') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.saveState).toBe('conflict')
    submitAttendanceDay.mockResolvedValue({ ok: true, version: 3, counts: {}, termId: '2026-T2', changed: 1 })
    await act(async () => {
      result.current.resolveConflict('2026-06-15', 'mine')
      await vi.advanceTimersByTimeAsync(10)
    })
    const lastCall = submitAttendanceDay.mock.calls.at(-1)[0]
    expect(lastCall.baseVersion).toBe(2)
    expect(lastCall.records).toEqual({ a: { status: 'sick', note: '' } })
    expect(result.current.saveState).toBe('saved')
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

  it('applies the ECE mid-term break to ECE classes only when enabled', () => {
    const eceRegister = { ...register, grade: 'reception' }
    const { result, rerender } = renderHook(
      ({ reg }) => useClassRegister({ register: reg, termSelection, uid: 't1' }),
      { initialProps: { reg: eceRegister } },
    )
    act(() => { subs.term({ state: 'draft', midTermBreak: { mode: 'ece' } }) })
    const breakDay = result.current.days.find((d) => d.date === '2026-06-23')
    expect(breakDay.classification).toBe('school_closure')
    expect(breakDay.closureLabel).toBe('ECE mid-term break — attendance not required')
    expect(breakDay.markable).toBe(false)

    // Same config on a non-ECE class → normal teaching day.
    rerender({ reg: register })
    act(() => { subs.term({ state: 'draft', midTermBreak: { mode: 'ece' } }) })
    expect(result.current.days.find((d) => d.date === '2026-06-23').classification).toBe('teaching_day')
  })
})
