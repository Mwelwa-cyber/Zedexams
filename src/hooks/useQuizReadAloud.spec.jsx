import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const speak = vi.fn()
const stop = vi.fn()
let speechState

vi.mock('./useSpeech', () => ({
  useSpeech: () => ({
    supported: true,
    speaking: speechState.speaking,
    paused: speechState.paused,
    activeId: speechState.activeId,
    speak,
    stop,
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}))

import { useQuizReadAloud } from './useQuizReadAloud'

beforeEach(() => {
  speak.mockClear()
  stop.mockClear()
  speechState = { speaking: false, paused: false, activeId: null }
})

describe('useQuizReadAloud gating', () => {
  it('is disabled and never speaks when the readAloud pref is off', () => {
    const { result } = renderHook(() => useQuizReadAloud(false))
    expect(result.current.enabled).toBe(false)
    act(() => result.current.toggle('q1', () => 'hello'))
    expect(speak).not.toHaveBeenCalled()
  })

  it('speaks the requested item when enabled', () => {
    const { result } = renderHook(() => useQuizReadAloud(true))
    expect(result.current.enabled).toBe(true)
    act(() => result.current.toggle('q1', () => 'hello world'))
    expect(speak).toHaveBeenCalledWith('hello world', 'q1')
  })

  it('does not speak an empty item', () => {
    const { result } = renderHook(() => useQuizReadAloud(true))
    act(() => result.current.toggle('q1', () => '   '))
    expect(speak).not.toHaveBeenCalled()
  })

  it('tapping the active item again stops it instead of restarting', () => {
    speechState = { speaking: true, paused: false, activeId: 'q1' }
    const { result } = renderHook(() => useQuizReadAloud(true))
    expect(result.current.isActive('q1')).toBe(true)
    act(() => result.current.toggle('q1', () => 'hello'))
    expect(stop).toHaveBeenCalled()
    expect(speak).not.toHaveBeenCalled()
  })
})
