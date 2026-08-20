/**
 * Behaviour tests for usePinchZoom — the gesture that makes a past paper
 * readable on a phone.
 *
 * These matter more than most component tests because the thing under test is
 * a touch gesture on an Android WebView, which nothing in CI can hold in its
 * hands. The maths is proved separately under plain node
 * (`pinchZoomCore.test.js`); what is proved here is the WIRING — that two
 * fingers reach the handler at all, that one finger is left alone so the paper
 * still scrolls, and that the gesture is claimed from the browser rather than
 * shared with it.
 *
 * jsdom has no layout, so every `getBoundingClientRect()` is zero and the
 * focal-anchoring scroll is a no-op here by construction. That is why
 * `focalCorrection` is tested as arithmetic instead.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useRef, useState } from 'react'
import usePinchZoom from './usePinchZoom'
import { DOUBLE_TAP_ZOOM, FIT_ZOOM } from '../utils/pinchZoomCore'

/**
 * A touch event jsdom will dispatch. jsdom implements neither `Touch` nor a
 * constructible `TouchEvent`, so the shape the handler actually reads is
 * defined onto a plain Event — which is also a precise statement of the
 * contract: touches, changedTouches, cancelable, preventDefault.
 */
function touchEvent(type, points, { cancelable = true, timeStamp = 0, changed = null } = {}) {
  const event = new Event(type, { bubbles: true, cancelable })
  const list = points.map((p) => ({ clientX: p.x, clientY: p.y, identifier: p.id ?? 0 }))
  Object.defineProperty(event, 'touches', { value: list })
  Object.defineProperty(event, 'changedTouches', {
    value: changed ? changed.map((p) => ({ clientX: p.x, clientY: p.y })) : list,
  })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  return event
}

function Harness({ onZoom = () => {} }) {
  const ref = useRef(null)
  const [zoom, setZoom] = useState(FIT_ZOOM)
  usePinchZoom(ref, {
    zoom,
    onZoomChange: (next) => { setZoom(next); onZoom(next) },
  })
  return (
    <div ref={ref} data-testid="stack" style={{ touchAction: 'pan-y' }}>
      <div data-zoom-anchor="">page</div>
      <button type="button">Retry</button>
    </div>
  )
}

function mount() {
  const onZoom = vi.fn()
  const { getByTestId, unmount } = render(<Harness onZoom={onZoom} />)
  return { el: getByTestId('stack'), onZoom, unmount }
}

function fire(el, event) {
  act(() => { el.dispatchEvent(event) })
  return event
}

describe('usePinchZoom', () => {
  it('zooms in when two fingers move apart', () => {
    const { el, onZoom } = mount()
    fire(el, touchEvent('touchstart', [{ x: 100, y: 200, id: 1 }, { x: 200, y: 200, id: 2 }]))
    fire(el, touchEvent('touchmove', [{ x: 50, y: 200, id: 1 }, { x: 250, y: 200, id: 2 }]))
    // Fingers went from 100px apart to 200px apart — twice the page.
    expect(onZoom).toHaveBeenCalledWith(2)
  })

  it('zooms out when two fingers move together', () => {
    const { el, onZoom } = mount()
    fire(el, touchEvent('touchstart', [{ x: 0, y: 0, id: 1 }, { x: 200, y: 0, id: 2 }]))
    fire(el, touchEvent('touchmove', [{ x: 60, y: 0, id: 1 }, { x: 140, y: 0, id: 2 }]))
    // 200px → 80px is 0.4×, below the floor, so it lands on the floor.
    expect(onZoom).toHaveBeenCalledWith(0.6)
  })

  it('measures from where the pinch STARTED, so a dropped frame cannot drift the zoom', () => {
    const { el, onZoom } = mount()
    fire(el, touchEvent('touchstart', [{ x: 100, y: 0, id: 1 }, { x: 200, y: 0, id: 2 }]))
    // Three moves out and then back to exactly the starting spread. A gesture
    // accumulated frame-to-frame would have drifted; this one must return to 1.
    fire(el, touchEvent('touchmove', [{ x: 80, y: 0, id: 1 }, { x: 220, y: 0, id: 2 }]))
    fire(el, touchEvent('touchmove', [{ x: 40, y: 0, id: 1 }, { x: 260, y: 0, id: 2 }]))
    fire(el, touchEvent('touchmove', [{ x: 100, y: 0, id: 1 }, { x: 200, y: 0, id: 2 }]))
    expect(onZoom).toHaveBeenLastCalledWith(FIT_ZOOM)
  })

  it('claims the two-finger gesture from the browser', () => {
    const { el } = mount()
    // preventDefault on touchstart is what stops the browser starting its own
    // two-finger scroll — after which its touchmoves are no longer cancelable
    // and the pinch cannot be taken back.
    const start = fire(el, touchEvent('touchstart', [{ x: 0, y: 0, id: 1 }, { x: 100, y: 0, id: 2 }]))
    expect(start.defaultPrevented).toBe(true)
    const move = fire(el, touchEvent('touchmove', [{ x: 0, y: 0, id: 1 }, { x: 150, y: 0, id: 2 }]))
    expect(move.defaultPrevented).toBe(true)
  })

  it('never touches a one-finger gesture — the paper must still scroll', () => {
    const { el, onZoom } = mount()
    const start = fire(el, touchEvent('touchstart', [{ x: 100, y: 300, id: 1 }]))
    const move = fire(el, touchEvent('touchmove', [{ x: 100, y: 80, id: 1 }]))
    // Not prevented, not zoomed: the browser scrolls exactly as it always did.
    // Re-implementing scrolling is the trap this hook exists to avoid.
    expect(start.defaultPrevented).toBe(false)
    expect(move.defaultPrevented).toBe(false)
    expect(onZoom).not.toHaveBeenCalled()
  })

  it('double-tap toggles between fit and readable, and back', () => {
    const { el, onZoom } = mount()
    const tap = (t) => {
      fire(el, touchEvent('touchstart', [{ x: 120, y: 400, id: 1 }], { timeStamp: t }))
      fire(el, touchEvent('touchend', [], { timeStamp: t, changed: [{ x: 120, y: 400 }] }))
    }
    tap(1000)
    expect(onZoom).not.toHaveBeenCalled() // one tap is just a tap
    tap(1150)
    expect(onZoom).toHaveBeenLastCalledWith(DOUBLE_TAP_ZOOM)

    tap(2000)
    tap(2150)
    expect(onZoom).toHaveBeenLastCalledWith(FIT_ZOOM)
  })

  it('does not double-tap-zoom on a control', () => {
    const { el, onZoom } = mount()
    const button = el.querySelector('button')
    const tapButton = (t) => {
      const start = touchEvent('touchstart', [{ x: 10, y: 10, id: 1 }], { timeStamp: t })
      const end = touchEvent('touchend', [], { timeStamp: t, changed: [{ x: 10, y: 10 }] })
      act(() => { button.dispatchEvent(start); button.dispatchEvent(end) })
    }
    // Double-tapping Retry must retry twice, not zoom the paper out from under
    // the reader.
    tapButton(1000)
    tapButton(1150)
    expect(onZoom).not.toHaveBeenCalled()
  })

  it('treats a quick flick as a scroll, not a double-tap', () => {
    const { el, onZoom } = mount()
    const flick = (t) => {
      fire(el, touchEvent('touchstart', [{ x: 120, y: 400, id: 1 }], { timeStamp: t }))
      fire(el, touchEvent('touchend', [], { timeStamp: t, changed: [{ x: 120, y: 180 }] }))
    }
    flick(1000)
    flick(1150)
    // This is the one that would fire while a learner is reading.
    expect(onZoom).not.toHaveBeenCalled()
  })

  it('zooms on ctrl+wheel (desktop and trackpad pinch) but leaves a plain wheel to scroll', () => {
    const { el, onZoom } = mount()
    const plain = new Event('wheel', { bubbles: true, cancelable: true })
    Object.defineProperty(plain, 'deltaY', { value: -120 })
    fire(el, plain)
    expect(onZoom).not.toHaveBeenCalled()
    expect(plain.defaultPrevented).toBe(false)

    const zoomWheel = new Event('wheel', { bubbles: true, cancelable: true })
    Object.defineProperty(zoomWheel, 'deltaY', { value: -120 })
    Object.defineProperty(zoomWheel, 'ctrlKey', { value: true })
    fire(el, zoomWheel)
    expect(zoomWheel.defaultPrevented).toBe(true)
    expect(onZoom).toHaveBeenCalledTimes(1)
    expect(onZoom.mock.calls[0][0]).toBeGreaterThan(FIT_ZOOM)
  })

  it('drops the gesture when the system cancels the touch', () => {
    const { el, onZoom } = mount()
    fire(el, touchEvent('touchstart', [{ x: 0, y: 0, id: 1 }, { x: 100, y: 0, id: 2 }]))
    fire(el, touchEvent('touchcancel', []))
    // A move arriving after the cancel (a phone call, a notification shade)
    // must not resume a pinch from a start distance that no longer means
    // anything.
    fire(el, touchEvent('touchmove', [{ x: 0, y: 0, id: 1 }, { x: 400, y: 0, id: 2 }]))
    expect(onZoom).not.toHaveBeenCalled()
  })
})
