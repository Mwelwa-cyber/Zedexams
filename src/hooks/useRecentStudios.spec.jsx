/**
 * useRecentStudios — the recents list must hold studio ids and nothing else.
 *
 * Both ends of this hook read an allowlist by key. `STUDIO_BY_ID[id]` is not a
 * membership test: every object literal answers truthily to 'constructor',
 * 'toString' and '__proto__', so those three passed `record()`'s guard and
 * were written to localStorage, then came back out as inherited functions
 * where the launcher expects a studio. `sanitizeIds` guards the way OUT; this
 * pins the way IN.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'teacher-1' } }) }))

import useRecentStudios from './useRecentStudios.js'
import { STUDIO_BY_ID } from '../shared/constants/teacherStudios'

const KEY = 'zedexams:teacher-recents:teacher-1'
const INHERITED = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']
const REAL_ID = Object.keys(STUDIO_BY_ID)[0]

beforeEach(() => localStorage.clear())

describe('useRecentStudios', () => {
  it('records a real studio id', () => {
    const { result } = renderHook(() => useRecentStudios())
    act(() => { result.current.record(REAL_ID) })
    expect(result.current.recents).toEqual([REAL_ID])
    expect(typeof result.current.openedAt[REAL_ID]).toBe('number')
  })

  it('refuses an id the allowlist only INHERITS', () => {
    const { result } = renderHook(() => useRecentStudios())
    act(() => { INHERITED.forEach((id) => result.current.record(id)) })
    expect(result.current.recents).toEqual([])
    // Nothing was persisted either — the refusal is before the write.
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('drops inherited ids already sitting in this device storage', () => {
    localStorage.setItem(KEY, JSON.stringify({
      ids: [...INHERITED, REAL_ID],
      at: Object.fromEntries([...INHERITED, REAL_ID].map((id) => [id, 1])),
    }))
    const { result } = renderHook(() => useRecentStudios())
    expect(result.current.recents).toEqual([REAL_ID])
    for (const id of INHERITED) {
      expect(result.current.openedAt[id]).toBeUndefined()
    }
  })

  it('every recorded id resolves to a real studio object', () => {
    const { result } = renderHook(() => useRecentStudios())
    act(() => { [...INHERITED, REAL_ID].forEach((id) => result.current.record(id)) })
    for (const id of result.current.recents) {
      expect(typeof STUDIO_BY_ID[id]).toBe('object')
      expect(STUDIO_BY_ID[id].id).toBe(id)
    }
  })
})
