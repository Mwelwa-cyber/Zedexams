import { beforeEach, describe, expect, it, vi } from 'vitest'
import { paywall } from './paywall'

// The paywall bus is a module-level singleton, so reset shared state before
// each case to keep them independent.
beforeEach(() => {
  paywall.hide()
})

describe('paywall bus', () => {
  it('notifies subscribers with the reason + ctx on show()', () => {
    const seen = []
    const unsub = paywall.subscribe((state) => seen.push(state))
    // subscribe() fires immediately with the current (null) state.
    expect(seen).toEqual([null])

    paywall.show('quiz-locked', { quizId: 'q1' })
    expect(seen.at(-1)).toEqual({ reason: 'quiz-locked', ctx: { quizId: 'q1' } })
    unsub()
  })

  it('defaults ctx to an empty object when omitted', () => {
    let state
    const unsub = paywall.subscribe((s) => { state = s })
    paywall.show('past-paper')
    expect(state).toEqual({ reason: 'past-paper', ctx: {} })
    unsub()
  })

  it('clears state and notifies on hide()', () => {
    const fn = vi.fn()
    const unsub = paywall.subscribe(fn)
    paywall.show('exam-mode')
    paywall.hide()
    expect(fn).toHaveBeenLastCalledWith(null)
    unsub()
  })

  it('fans out to every subscriber', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = paywall.subscribe(a)
    const unsubB = paywall.subscribe(b)
    paywall.show('notes')
    expect(a).toHaveBeenLastCalledWith({ reason: 'notes', ctx: {} })
    expect(b).toHaveBeenLastCalledWith({ reason: 'notes', ctx: {} })
    unsubA()
    unsubB()
  })

  it('stops notifying after unsubscribe', () => {
    const fn = vi.fn()
    const unsub = paywall.subscribe(fn)
    fn.mockClear()
    unsub()
    paywall.show('lessons')
    expect(fn).not.toHaveBeenCalled()
  })
})
