/**
 * usePinchZoom — two-finger pinch, double-tap and ctrl+wheel zoom for a
 * scrolling stack of paper pages.
 *
 * The bug this exists for: on the Android build a learner could not enlarge a
 * past paper at all. Page-level pinch in an Android WebView is gated on
 * `WebSettings.setBuiltInZoomControls`, which Capacitor leaves off, and no
 * amount of `touch-action: pinch-zoom` in CSS turns it back on — so the only
 * way to read exam small-print was a zoom control buried in an overflow menu.
 * Owning the gesture in JavaScript makes it behave the same in the app, in a
 * PWA, in mobile Chrome and on a desktop trackpad.
 *
 * ## Why touch events and not pointer events
 *
 * Pointer events would be the tidier API, but taking a pinch through them
 * means `touch-action: none` on the surface — which also switches off the
 * browser's single-finger scrolling, so the stack would have to re-implement
 * scrolling and its momentum. On a long paper that is a much worse trade than
 * a raw touch listener. Here, one finger is never intercepted: the browser
 * scrolls exactly as it always has, and only a genuine two-finger gesture is
 * claimed (`preventDefault`, which needs a NON-passive listener — hence
 * `addEventListener` rather than React's `onTouchMove`, which React registers
 * passively).
 *
 * ## Focal anchoring
 *
 * Zooming grows every page box, including the ones above the learner, so the
 * question they were reading slides away — the thing that makes a naive zoom
 * feel like it throws you out of the paper. Each zoom therefore measures the
 * anchor element (`[data-zoom-anchor]`, the page box under the fingers)
 * before the change and again after the browser has laid it out, and scrolls
 * by the difference. The "after" measurement runs in a layout effect keyed on
 * the caller's committed `zoom`, because that is the first moment the new
 * width is real: a `requestAnimationFrame` would be racing React's commit, and
 * on a slow phone it loses that race silently and intermittently.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  clampZoom,
  focalCorrection,
  isDoubleTap,
  pinchZoom,
  toggleZoom,
  touchDistance,
  touchMidpoint,
  wheelZoom,
  MAX_ZOOM,
  MIN_ZOOM,
} from '../utils/pinchZoomCore'

/** Controls own their taps — a double-tap on Retry must not zoom the paper. */
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [role="menuitem"]'

function pointFromTouch(touch) {
  return { x: touch.clientX, y: touch.clientY }
}

/**
 * The nearest ancestor that actually scrolls on `axis`, or the document
 * scroller. The fullscreen reader puts the stack inside its own
 * `overflow-y-auto` surface while the plain viewer leaves it in the document,
 * so neither can be assumed.
 */
function scrollParent(el, axis) {
  const overflowProp = axis === 'x' ? 'overflowX' : 'overflowY'
  const sizeProp = axis === 'x' ? 'scrollWidth' : 'scrollHeight'
  const clientProp = axis === 'x' ? 'clientWidth' : 'clientHeight'
  let node = el
  while (node && node !== document.body && node.nodeType === 1) {
    let style
    try { style = window.getComputedStyle(node) } catch { style = null }
    const overflow = style?.[overflowProp]
    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay')
      && node[sizeProp] > node[clientProp] + 1) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * The middle of the visible slice of `el`, in client coordinates — the point a
 * button-driven zoom anchors on.
 */
function viewportCentreOf(el) {
  const viewportH = (typeof window !== 'undefined' && window.innerHeight) || 0
  const viewportW = (typeof window !== 'undefined' && window.innerWidth) || 0
  const r = el?.getBoundingClientRect?.()
  if (!r) return { x: viewportW / 2, y: viewportH / 2 }
  const top = Math.max(r.top, 0)
  const bottom = Math.min(r.bottom, viewportH || r.bottom)
  const left = Math.max(r.left, 0)
  const right = Math.min(r.right, viewportW || r.right)
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

function scrollElementBy(el, dx, dy) {
  if (!el) {
    if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
      window.scrollBy(dx, dy)
    }
    return
  }
  if (typeof el.scrollBy === 'function') el.scrollBy(dx, dy)
  else {
    el.scrollLeft += dx
    el.scrollTop += dy
  }
}

/**
 * @param {import('react').RefObject<HTMLElement>} targetRef — the page stack.
 * @param {object} options
 * @param {number} options.zoom — the caller's committed zoom. Read for the
 *   gesture's starting point and used as the layout-effect key.
 * @param {(next: number) => void} options.onZoomChange
 * @param {boolean} [options.enabled=true]
 * @returns {{ requestZoom: (next: number, focal?: {x:number,y:number}) => void }}
 *   `requestZoom` drives the +/− buttons through the same anchoring path the
 *   gesture uses, so a button press holds the reader's place too.
 */
export default function usePinchZoom(targetRef, {
  zoom,
  onZoomChange,
  enabled = true,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
  anchorSelector = '[data-zoom-anchor]',
} = {}) {
  // The gesture reads the zoom synchronously, many times per frame; state
  // would be a render behind and the pinch would lag the fingers.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange

  const pinchRef = useRef(null)        // { startZoom, startDistance }
  const pendingAnchorRef = useRef(null) // { el, before, focal }
  const tapRef = useRef({ at: 0, x: 0, y: 0 })
  const touchStartRef = useRef(null)   // single-finger start, for tap slop

  /** Measure an element on both axes in client coordinates. */
  const measure = useCallback((el) => {
    if (!el?.getBoundingClientRect) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, height: r.height, left: r.left, width: r.width }
  }, [])

  const anchorAt = useCallback((focal) => {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null
    const hit = document.elementFromPoint(focal.x, focal.y)
    return hit?.closest?.(anchorSelector) || targetRef.current || null
  }, [anchorSelector, targetRef])

  /**
   * Ask for a new zoom, remembering what was under `focal` so the layout
   * effect below can put it back there.
   */
  const requestZoom = useCallback((next, focal) => {
    const clamped = clampZoom(next, min, max)
    if (clamped === zoomRef.current) return
    // No focal point means a button press. Anchor on the middle of the part of
    // the stack that is ON SCREEN — the geometric centre of a twenty-page
    // stack is a page the reader is nowhere near, so anchoring there would
    // scroll them somewhere else every time they tapped +.
    const point = focal || viewportCentreOf(targetRef.current)
    const el = anchorAt(point)
    pendingAnchorRef.current = el ? { el, before: measure(el), focal: point } : null
    onZoomChangeRef.current?.(clamped)
  }, [anchorAt, max, measure, min, targetRef])

  // Put the anchored content back under the focal point, now that the new
  // width has been laid out. Layout effect, not rAF: this must run before the
  // browser paints, or the page visibly jumps and then corrects itself.
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current
    pendingAnchorRef.current = null
    if (!pending?.el || !pending.before) return
    const after = measure(pending.el)
    if (!after) return
    const dy = focalCorrection(
      { start: pending.before.top, size: pending.before.height },
      { start: after.top, size: after.height },
      pending.focal.y,
    )
    const dx = focalCorrection(
      { start: pending.before.left, size: pending.before.width },
      { start: after.left, size: after.width },
      pending.focal.x,
    )
    if (Math.abs(dy) >= 1) scrollElementBy(scrollParent(pending.el, 'y'), 0, dy)
    if (Math.abs(dx) >= 1) {
      const horizontal = scrollParent(pending.el, 'x')
      // Only correct horizontally where something can actually scroll: the
      // document must never be pushed sideways by a zoom.
      if (horizontal) scrollElementBy(horizontal, dx, 0)
    }
  }, [zoom, measure])

  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return undefined

    function onTouchStart(event) {
      if (event.touches.length === 2) {
        const a = pointFromTouch(event.touches[0])
        const b = pointFromTouch(event.touches[1])
        pinchRef.current = {
          startZoom: zoomRef.current,
          startDistance: touchDistance(a, b),
        }
        touchStartRef.current = null
        // Claim the gesture before the browser can start a two-finger scroll;
        // once it has, its touchmoves stop being cancelable.
        if (event.cancelable) event.preventDefault()
        return
      }
      if (event.touches.length === 1) {
        const p = pointFromTouch(event.touches[0])
        touchStartRef.current = { ...p, target: event.target }
      }
    }

    function onTouchMove(event) {
      const pinch = pinchRef.current
      if (!pinch || event.touches.length !== 2) return
      const a = pointFromTouch(event.touches[0])
      const b = pointFromTouch(event.touches[1])
      const next = pinchZoom(pinch.startZoom, pinch.startDistance, touchDistance(a, b), min, max)
      if (event.cancelable) event.preventDefault()
      requestZoom(next, touchMidpoint(a, b))
    }

    function onTouchEnd(event) {
      if (event.touches.length < 2) pinchRef.current = null
      if (event.touches.length > 0) return

      const start = touchStartRef.current
      touchStartRef.current = null
      if (!start) return
      const end = event.changedTouches?.[0]
      if (!end) return
      if (start.target?.closest?.(INTERACTIVE_SELECTOR)) return

      const moved = Math.hypot(end.clientX - start.x, end.clientY - start.y)
      const now = event.timeStamp || Date.now()
      const tap = tapRef.current
      if (isDoubleTap({
        now,
        lastTapAt: tap.at,
        lastTapX: tap.x,
        lastTapY: tap.y,
        x: end.clientX,
        y: end.clientY,
        moved,
      })) {
        tapRef.current = { at: 0, x: 0, y: 0 }
        if (event.cancelable) event.preventDefault()
        requestZoom(toggleZoom(zoomRef.current), { x: end.clientX, y: end.clientY })
        return
      }
      tapRef.current = { at: now, x: end.clientX, y: end.clientY }
    }

    function onTouchCancel() {
      pinchRef.current = null
      touchStartRef.current = null
    }

    function onWheel(event) {
      // A macOS trackpad pinch arrives as ctrl+wheel; so does ctrl+scroll on a
      // mouse. A plain wheel must keep scrolling the paper.
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      requestZoom(wheelZoom(zoomRef.current, event.deltaY, min, max), { x: event.clientX, y: event.clientY })
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchCancel, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
      el.removeEventListener('wheel', onWheel)
    }
  }, [enabled, max, min, requestZoom, targetRef])

  return { requestZoom }
}
