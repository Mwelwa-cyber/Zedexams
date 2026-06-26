import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIsMounted } from './useIsMounted.js'

describe('useIsMounted', () => {
  it('is true while mounted and false after unmount', () => {
    const { result, unmount } = renderHook(() => useIsMounted())
    // The ref object is stable across renders; its .current tracks mount state.
    expect(result.current.current).toBe(true)
    unmount()
    expect(result.current.current).toBe(false)
  })
})
