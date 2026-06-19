import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useTeacherUsage subscribes to the teacher's monthly usage-meter doc and
// projects it into the dashboard widget's shape: per-feature used/caps, the
// daily cap, today's count, and the reset countdown. The caps are resolved
// from the LIVE plan (userProfile), NOT the meter doc's frozen snapshot —
// that staleness fix is the whole reason the projection lives here, so it is
// the main thing pinned below. Super-admins bypass the meter entirely.
//
// firebase/config + firestore are mocked (no network); the real teacherPlans
// catalogue + permissions run so the plan→caps mapping is exercised for real.

const onSnapshot = vi.fn()
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, path) => ({ path }),
  onSnapshot: (...args) => onSnapshot(...args),
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../contexts/AuthContext'
import { useTeacherUsage } from './useTeacherUsage.js'

// Today's UTC day key, matching the hook's yyyymmdd().
function todayKey(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// Capture the onSnapshot success + error callbacks so tests can drive them.
let nextCb
let errCb
const unsub = vi.fn()

beforeEach(() => {
  onSnapshot.mockReset()
  unsub.mockClear()
  nextCb = null
  errCb = null
  onSnapshot.mockImplementation((_ref, onNext, onError) => {
    nextCb = onNext
    errCb = onError
    return unsub
  })
})

function setPlan(profile) {
  useAuth.mockReturnValue({ userProfile: profile })
}

const snap = (data) => ({ exists: () => data !== null, data: () => data })

describe('useTeacherUsage', () => {
  it('returns an empty, non-loading state when no uid is given', () => {
    setPlan({ teacherPlan: 'free' })
    const { result } = renderHook(() => useTeacherUsage(null))
    expect(result.current).toEqual({ loading: false, data: null, error: null })
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('starts in a loading state before the snapshot arrives', () => {
    setPlan({ teacherPlan: 'free' })
    const { result } = renderHook(() => useTeacherUsage('t1'))
    expect(result.current.loading).toBe(true)
    expect(onSnapshot).toHaveBeenCalledTimes(1)
  })

  it('projects a free-plan meter: caps from the free catalogue + daily 2', () => {
    setPlan({ teacherPlan: 'free' })
    const { result } = renderHook(() => useTeacherUsage('t1'))
    act(() => nextCb(snap({ counters: { lesson_plan: 2, worksheet: 1 } })))

    const { data } = result.current
    expect(result.current.loading).toBe(false)
    expect(data.plan).toBe('free')
    expect(data.planLabel).toBe('Free')
    expect(data.used.plans).toBe(2)
    expect(data.used.worksheets).toBe(1)
    expect(data.caps.plans).toBe(5) // free lesson_plan
    expect(data.caps.assessments).toBe(0) // quiz locked on free
    expect(data.daily).toBe(2)
  })

  it('uses the LIVE plan for caps even when the meter doc snapshot is stale', () => {
    // Teacher upgraded to pro mid-month; the meter doc still says free.
    setPlan({ teacherPlan: 'pro' })
    const { result } = renderHook(() => useTeacherUsage('t1'))
    act(() => nextCb(snap({ plan: 'free', counters: { lesson_plan: 10 } })))

    expect(result.current.data.plan).toBe('pro')
    expect(result.current.data.planLabel).toBe('Pro')
    expect(result.current.data.caps.plans).toBe(40) // pro lesson_plan, not free's 5
    expect(result.current.data.daily).toBe(10)
  })

  it('counts today only when the daily date matches the current UTC day', () => {
    setPlan({ teacherPlan: 'pro' })
    const { result, rerender } = renderHook(() => useTeacherUsage('t1'))

    act(() => nextCb(snap({ daily: { date: todayKey(), count: 4 } })))
    expect(result.current.data.today).toBe(4)

    // A stale daily block (yesterday) reads as nothing generated today.
    act(() => nextCb(snap({ daily: { date: '19990101', count: 9 } })))
    rerender()
    expect(result.current.data.today).toBe(0)
  })

  it('treats a missing meter doc as all-zero usage with live caps intact', () => {
    setPlan({ teacherPlan: 'pro' })
    const { result } = renderHook(() => useTeacherUsage('t1'))
    act(() => nextCb(snap(null))) // doc does not exist

    expect(result.current.data.used.plans).toBe(0)
    expect(result.current.data.caps.plans).toBe(40) // still resolved from pro
    expect(result.current.data.today).toBe(0)
  })

  it('bypasses the meter for super-admins (admin caps, no Free chip)', () => {
    setPlan({ role: 'admin' })
    const { result } = renderHook(() => useTeacherUsage('t1'))
    act(() => nextCb(snap({ counters: { quiz: 3 } })))

    const { data } = result.current
    expect(data.plan).toBe('max')
    expect(data.planLabel).toBe('Admin')
    expect(data.used.assessments).toBe(3) // real count still surfaced
    expect(data.caps.assessments).toBe(99999) // admin unlimited cap
    expect(data.daily).toBe(99999)
  })

  it('surfaces a snapshot error as { loading:false, data:null, error }', () => {
    setPlan({ teacherPlan: 'free' })
    const { result } = renderHook(() => useTeacherUsage('t1'))
    const boom = new Error('permission denied')
    act(() => errCb(boom))

    expect(result.current).toEqual({ loading: false, data: null, error: boom })
  })

  it('unsubscribes on unmount', () => {
    setPlan({ teacherPlan: 'free' })
    const { unmount } = renderHook(() => useTeacherUsage('t1'))
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
