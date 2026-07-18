import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLatestRequest } from './useLatestRequest.js'

describe('useLatestRequest', () => {
  it('issues increasing tokens and only the latest is current', () => {
    const { result } = renderHook(() => useLatestRequest())
    let tokenA, tokenB
    act(() => { tokenA = result.current.next() })
    act(() => { tokenB = result.current.next() })

    expect(tokenB).toBeGreaterThan(tokenA)
    expect(result.current.isCurrent(tokenA)).toBe(false)
    expect(result.current.isCurrent(tokenB)).toBe(true)
  })

  it('an older response cannot replace a newer result once a new request has started', () => {
    // Simulates: CBC Grade 4 request starts, OBC Grade 7 request starts,
    // CBC response arrives late — it must not win.
    const { result } = renderHook(() => useLatestRequest())
    let cbcToken
    act(() => { cbcToken = result.current.next() })
    let obcToken
    act(() => { obcToken = result.current.next() })

    expect(result.current.isCurrent(cbcToken)).toBe(false)
    expect(result.current.isCurrent(obcToken)).toBe(true)
  })

  it('invalidate() bumps the sequence so an outstanding token stops being current', () => {
    const { result } = renderHook(() => useLatestRequest())
    let token
    act(() => { token = result.current.next() })
    expect(result.current.isCurrent(token)).toBe(true)

    act(() => { result.current.invalidate() })
    expect(result.current.isCurrent(token)).toBe(false)
  })

  it('no token is current after unmount', () => {
    const { result, unmount } = renderHook(() => useLatestRequest())
    let token
    act(() => { token = result.current.next() })
    unmount()
    expect(result.current.isCurrent(token)).toBe(false)
  })
})
