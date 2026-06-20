import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// useLibraryAutoSave debounces the interactive studios' own save fn so a
// hand-built artefact lands in the library without a manual click. The logic
// worth pinning: it only fires when there's content (enabled) AND an unsaved
// change (dirty) AND no save in flight (saving); it debounces; and it always
// calls the latest onSave (no stale closure).

import { useLibraryAutoSave } from './useLibraryAutoSave.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function setup(props) {
  return renderHook((p) => useLibraryAutoSave(p), { initialProps: props })
}

describe('useLibraryAutoSave', () => {
  it('fires the save after the debounce window when enabled + dirty + not saving', () => {
    const onSave = vi.fn()
    setup({ enabled: true, dirty: true, saving: false, onSave, delay: 2500 })
    expect(onSave).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2499)
    expect(onSave).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not fire when there is no content to save', () => {
    const onSave = vi.fn()
    setup({ enabled: false, dirty: true, saving: false, onSave, delay: 2500 })
    vi.advanceTimersByTime(5000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not fire when there are no unsaved changes', () => {
    const onSave = vi.fn()
    setup({ enabled: true, dirty: false, saving: false, onSave, delay: 2500 })
    vi.advanceTimersByTime(5000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not fire while a save is already in flight', () => {
    const onSave = vi.fn()
    setup({ enabled: true, dirty: true, saving: true, onSave, delay: 2500 })
    vi.advanceTimersByTime(5000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancels a pending save if changes settle before the window elapses', () => {
    const onSave = vi.fn()
    const { rerender } = setup({ enabled: true, dirty: true, saving: false, onSave, delay: 2500 })
    vi.advanceTimersByTime(1000)
    // A successful save would clear the dirty flag mid-debounce — timer resets.
    rerender({ enabled: true, dirty: false, saving: false, onSave, delay: 2500 })
    vi.advanceTimersByTime(5000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls the latest onSave, not a stale closure', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = setup({ enabled: true, dirty: true, saving: false, onSave: first, delay: 2500 })
    rerender({ enabled: true, dirty: true, saving: false, onSave: second, delay: 2500 })
    vi.advanceTimersByTime(2500)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
