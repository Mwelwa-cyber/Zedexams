import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lockedFeature } from './lockedFeature'

beforeEach(() => {
  lockedFeature.hide()
})

describe('lockedFeature bus', () => {
  it('normalises missing feature/audience to null on show()', () => {
    let state
    const unsub = lockedFeature.subscribe((s) => { state = s })
    lockedFeature.show()
    expect(state).toEqual({ feature: null, audience: null })
    unsub()
  })

  it('passes through feature + audience', () => {
    let state
    const unsub = lockedFeature.subscribe((s) => { state = s })
    lockedFeature.show({ feature: 'Exam mode', audience: 'teacher' })
    expect(state).toEqual({ feature: 'Exam mode', audience: 'teacher' })
    unsub()
  })

  it('emits the current state immediately on subscribe()', () => {
    lockedFeature.show({ feature: 'Worked solutions' })
    const fn = vi.fn()
    const unsub = lockedFeature.subscribe(fn)
    expect(fn).toHaveBeenCalledWith({ feature: 'Worked solutions', audience: null })
    unsub()
  })

  it('clears on hide()', () => {
    const fn = vi.fn()
    const unsub = lockedFeature.subscribe(fn)
    lockedFeature.show({ feature: 'x' })
    lockedFeature.hide()
    expect(fn).toHaveBeenLastCalledWith(null)
    unsub()
  })

  it('stops notifying after unsubscribe', () => {
    const fn = vi.fn()
    const unsub = lockedFeature.subscribe(fn)
    fn.mockClear()
    unsub()
    lockedFeature.show({ feature: 'y' })
    expect(fn).not.toHaveBeenCalled()
  })
})
