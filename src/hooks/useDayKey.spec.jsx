/**
 * useDayKey.spec — the day-rollover hook behind every learner countdown.
 *
 * What is actually being protected: a phone is put down, not closed. A learner
 * who leaves the app open from 6 September into 7 September must not still be
 * told that Term 3 opens tomorrow on the morning it opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import useDayKey, { dayKeyOf, dayKeyDate, msUntilNextDay } from './useDayKey'

function Probe() {
  const key = useDayKey()
  return <span data-testid="key">{key}</span>
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('dayKeyOf / dayKeyDate / msUntilNextDay', () => {
  it('names the LOCAL date, zero-padded', () => {
    expect(dayKeyOf(new Date('2026-09-07T09:00:00'))).toBe('2026-09-07')
    expect(dayKeyOf(new Date('2026-01-02T23:59:59'))).toBe('2026-01-02')
  })

  it('round-trips to local midnight of the same day', () => {
    const d = dayKeyDate('2026-09-07')
    expect(dayKeyOf(d)).toBe('2026-09-07')
    expect(d.getHours()).toBe(0)
  })

  it('falls back to now rather than an Invalid Date', () => {
    vi.setSystemTime(new Date('2026-08-20T09:00:00'))
    expect(dayKeyOf(dayKeyDate('not-a-date'))).toBe('2026-08-20')
  })

  it('counts to the next local midnight, never to zero', () => {
    // 23:00 → an hour and the slack second.
    expect(msUntilNextDay(new Date('2026-08-20T23:00:00'))).toBe(60 * 60 * 1000 + 1000)
    expect(msUntilNextDay(new Date('2026-08-20T00:00:00'))).toBe(24 * 60 * 60 * 1000 + 1000)
    // A zero-or-negative delay would spin the timer; the floor forbids it.
    expect(msUntilNextDay(new Date('2026-08-20T23:59:59.999'))).toBeGreaterThanOrEqual(1000)
  })
})

describe('useDayKey', () => {
  it('starts on today', () => {
    vi.setSystemTime(new Date('2026-09-06T20:00:00'))
    render(<Probe />)
    expect(screen.getByTestId('key')).toHaveTextContent('2026-09-06')
  })

  it('rolls over on its own timer for a tab left in the foreground', () => {
    vi.setSystemTime(new Date('2026-09-06T23:59:00'))
    render(<Probe />)
    expect(screen.getByTestId('key')).toHaveTextContent('2026-09-06')
    act(() => { vi.advanceTimersByTime(61 * 1000 + 1000) })
    expect(screen.getByTestId('key')).toHaveTextContent('2026-09-07')
  })

  it('rolls over when the tab is brought back, however late the timer was', () => {
    // The common case: the phone was in a pocket overnight and the timer was
    // throttled. Nothing is advanced here — only the clock moved.
    vi.setSystemTime(new Date('2026-09-06T22:00:00'))
    render(<Probe />)
    vi.setSystemTime(new Date('2026-09-07T07:30:00'))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.getByTestId('key')).toHaveTextContent('2026-09-07')
  })

  it('also answers a window focus', () => {
    vi.setSystemTime(new Date('2026-09-06T22:00:00'))
    render(<Probe />)
    vi.setSystemTime(new Date('2026-09-07T07:30:00'))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(screen.getByTestId('key')).toHaveTextContent('2026-09-07')
  })

  it('does not re-render on a tab switch inside one day', () => {
    vi.setSystemTime(new Date('2026-09-06T10:00:00'))
    let renders = 0
    function Counted() { renders += 1; return <Probe /> }
    render(<Counted />)
    const before = renders
    act(() => { window.dispatchEvent(new Event('focus')) })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(renders).toBe(before)
    expect(screen.getByTestId('key')).toHaveTextContent('2026-09-06')
  })

  it('stops listening once unmounted', () => {
    vi.setSystemTime(new Date('2026-09-06T22:00:00'))
    const { unmount } = render(<Probe />)
    unmount()
    vi.setSystemTime(new Date('2026-09-07T07:30:00'))
    // No act() warning and no state update on an unmounted component.
    expect(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(48 * 60 * 60 * 1000)
    }).not.toThrow()
  })
})
