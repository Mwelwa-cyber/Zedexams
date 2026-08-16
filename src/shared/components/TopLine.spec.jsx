import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import TopLine from './TopLine.jsx'
import PageLoader from './PageLoader.jsx'

const line = (container) => container.querySelector('.zx-topline')

describe('TopLine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('renders nothing for the first 200ms — a fast transition shows no loader at all', () => {
    const { container } = render(<TopLine />)
    expect(line(container)).toBeNull()

    act(() => vi.advanceTimersByTime(199))
    expect(line(container)).toBeNull()
  })

  it('appears once the hold-off elapses, announced as a busy progressbar', () => {
    const { container } = render(<TopLine label="Loading page" />)
    act(() => vi.advanceTimersByTime(200))

    const el = line(container)
    expect(el).toBeTruthy()
    expect(el).toHaveAttribute('role', 'progressbar')
    expect(el).toHaveAttribute('aria-busy', 'true')
    expect(el).toHaveAttribute('aria-label', 'Loading page')
  })

  it('never appears when the operation resolves inside the hold-off', () => {
    const { container, rerender } = render(<TopLine active />)
    act(() => vi.advanceTimersByTime(150))
    rerender(<TopLine active={false} />)

    // The whole point of the gate: no flash-and-vanish, even long after.
    act(() => vi.advanceTimersByTime(2000))
    expect(line(container)).toBeNull()
  })

  it('once shown, stays up for the minimum rather than blinking out', () => {
    const { container, rerender } = render(<TopLine active />)
    act(() => vi.advanceTimersByTime(200))
    expect(line(container)).toBeTruthy()

    // Resolves 10ms after appearing — it must not vanish immediately.
    act(() => vi.advanceTimersByTime(10))
    rerender(<TopLine active={false} />)
    act(() => vi.advanceTimersByTime(100))
    expect(line(container)).toBeTruthy()

    act(() => vi.advanceTimersByTime(400))
    expect(line(container)).toBeNull()
  })

  it('is only `fixed` when asked — the shell variant sits inside its column', () => {
    const { container: plain } = render(<TopLine />)
    act(() => vi.advanceTimersByTime(200))
    expect(line(plain)).not.toHaveClass('zx-topline--fixed')

    const { container: fixed } = render(<TopLine fixed />)
    act(() => vi.advanceTimersByTime(200))
    expect(line(fixed)).toHaveClass('zx-topline--fixed')
  })
})

describe('PageLoader', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is the fixed top line, and is gated by the same hold-off', () => {
    const { container } = render(<PageLoader />)
    expect(line(container)).toBeNull()

    act(() => vi.advanceTimersByTime(200))
    expect(line(container)).toHaveClass('zx-topline--fixed')
  })
})
