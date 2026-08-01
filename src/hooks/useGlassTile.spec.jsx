/**
 * useGlassTile — the glass-tile interaction wiring.
 *
 * The contract under test:
 *  - --mx/--my track MOUSE pointers only, written straight onto the node
 *    (no React state), as percentages of the tile's box.
 *  - the pressed class responds to NON-mouse pointers only, and clears on
 *    pointerup / pointercancel / pointerleave.
 *  - the sheen class lands exactly once, at threshold 0.45, and the tile is
 *    unobserved after firing; under prefers-reduced-motion no observer is
 *    created at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import useGlassTile, { PRESSED_CLASS, INVIEW_CLASS } from './useGlassTile'

function Tile() {
  const ref = useGlassTile()
  return (
    <button type="button" ref={ref} data-testid="tile">
      Tile
    </button>
  )
}

let observers

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback
    this.options = options
    this.observed = []
    this.unobserve = vi.fn()
    this.disconnect = vi.fn()
    observers.push(this)
  }
  observe(el) {
    this.observed.push(el)
  }
}

beforeEach(() => {
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSpecular (via useGlassTile)', () => {
  it('writes --mx/--my as percentages for mouse pointers', () => {
    const { getByTestId } = render(<Tile />)
    const tile = getByTestId('tile')
    fireEvent.pointerMove(tile, { pointerType: 'mouse', clientX: 150, clientY: 25 })
    expect(tile.style.getPropertyValue('--mx')).toBe('75.0%')
    expect(tile.style.getPropertyValue('--my')).toBe('25.0%')
  })

  it('ignores non-mouse pointers — the highlight is a cursor affordance', () => {
    const { getByTestId } = render(<Tile />)
    const tile = getByTestId('tile')
    fireEvent.pointerMove(tile, { pointerType: 'touch', clientX: 150, clientY: 25 })
    expect(tile.style.getPropertyValue('--mx')).toBe('')
    expect(tile.style.getPropertyValue('--my')).toBe('')
  })
})

describe('usePressFeedback (via useGlassTile)', () => {
  it('presses on touch pointerdown and releases on pointerup', () => {
    const { getByTestId } = render(<Tile />)
    const tile = getByTestId('tile')
    fireEvent.pointerDown(tile, { pointerType: 'touch' })
    expect(tile).toHaveClass(PRESSED_CLASS)
    fireEvent.pointerUp(tile, { pointerType: 'touch' })
    expect(tile).not.toHaveClass(PRESSED_CLASS)
  })

  it('releases on pointercancel and pointerleave too', () => {
    const { getByTestId } = render(<Tile />)
    const tile = getByTestId('tile')
    fireEvent.pointerDown(tile, { pointerType: 'touch' })
    fireEvent.pointerCancel(tile)
    expect(tile).not.toHaveClass(PRESSED_CLASS)
    fireEvent.pointerDown(tile, { pointerType: 'pen' })
    expect(tile).toHaveClass(PRESSED_CLASS)
    fireEvent.pointerLeave(tile)
    expect(tile).not.toHaveClass(PRESSED_CLASS)
  })

  it('never presses for mouse pointers — those get the hover treatment', () => {
    const { getByTestId } = render(<Tile />)
    const tile = getByTestId('tile')
    fireEvent.pointerDown(tile, { pointerType: 'mouse' })
    expect(tile).not.toHaveClass(PRESSED_CLASS)
  })
})

describe('useSheenOnce (via useGlassTile)', () => {
  it('adds the in-view class once and unobserves at threshold 0.45', () => {
    const { getByTestId } = render(<Tile />)
    const tile = getByTestId('tile')
    expect(observers).toHaveLength(1)
    const io = observers[0]
    expect(io.options).toEqual({ threshold: 0.45 })
    expect(io.observed).toContain(tile)

    io.callback([{ isIntersecting: false, target: tile }])
    expect(tile).not.toHaveClass(INVIEW_CLASS)
    expect(io.unobserve).not.toHaveBeenCalled()

    io.callback([{ isIntersecting: true, target: tile }])
    expect(tile).toHaveClass(INVIEW_CLASS)
    expect(io.unobserve).toHaveBeenCalledWith(tile)
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Tile />)
    const io = observers[0]
    unmount()
    expect(io.disconnect).toHaveBeenCalled()
  })

  it('creates no observer under prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true }),
    )
    render(<Tile />)
    expect(observers).toHaveLength(0)
  })
})
