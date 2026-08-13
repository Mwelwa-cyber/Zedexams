/**
 * Full-screen pinch-to-zoom viewer for a past-paper page image.
 *
 * Why this exists: past papers rendered as page images (the common case
 * for scanned ECZ papers) stack as plain <img>s sized to the column
 * width. On a phone that's fine for prose, but a dense table — e.g. the
 * "match the icon to its use" grid in PSLE Technology Studies — is
 * unreadable, and there was no way to enlarge it. The PDF viewer already
 * has +/- zoom; the image path had none.
 *
 * This overlay gives the image path real zoom:
 *   - Pinch to zoom (two-finger) anchored on the gesture midpoint.
 *   - Drag to pan once zoomed in (one finger / mouse).
 *   - Double-tap / double-click toggles between fit and 2.5×, centred on
 *     the tap so you zoom into the thing you tapped.
 *   - Mouse wheel zooms on desktop, anchored on the cursor.
 *   - On-screen +/− / reset buttons so it works even where gestures don't
 *     (some old Android WebViews, or a learner who doesn't know to pinch).
 *
 * Pointer Events (not touch events) so the same code path drives mouse,
 * touch, and pen, and so it behaves in the Capacitor WebView. The
 * surface uses `touch-action: none` to stop the WebView hijacking the
 * gesture for native scroll/zoom.
 *
 * The whole overlay is rendered through a portal into <body>. It's a
 * `position: fixed` full-viewport layer, but the past-paper viewer mounts
 * it deep inside the `FullBleed` wrapper whose mobile `-translate-x-1/2`
 * is a CSS transform — and a transformed ancestor becomes the containing
 * block for `fixed`, so without the portal the overlay was trapped inside
 * the (very tall) page-list box: the toolbar showed but the image sat
 * thousands of pixels down, leaving the visible area all black. Portaling
 * to <body> escapes any transformed ancestor so `fixed` anchors to the
 * viewport as intended.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useFocusTrap from '../../../hooks/useFocusTrap'

const MIN_SCALE = 1
const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2.5

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export default function ImageZoomOverlay({ src, alt, onClose }) {
  const surfaceRef = useRef(null)
  const overlayRef = useRef(null)
  const closeRef = useRef(null)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  // Track load state so a slow or failed image shows a message instead of
  // a mysterious all-black screen.
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'

  // Live gesture bookkeeping kept in refs so the pointer maths reads the
  // freshest values without re-subscribing handlers on every frame.
  const transformRef = useRef(transform)
  transformRef.current = transform
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)      // { dist, midX, midY }
  const panRef = useRef(null)        // { x, y } last single-pointer position
  const lastTapRef = useRef(0)
  const movedRef = useRef(false)

  // Escape-to-close + Tab-trap + focus restore live in the shared hook; the
  // Close button is the natural first focus target for a viewer overlay.
  useFocusTrap(overlayRef, { onEscape: () => onClose(), initialFocusRef: closeRef })

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  // Apply a new scale anchored on a point in surface coordinates, keeping
  // the content under (anchorX, anchorY) visually fixed.
  const zoomTo = useCallback((nextScale, anchorX, anchorY) => {
    setTransform((prev) => {
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
      const ratio = scale / prev.scale
      let x = anchorX - ratio * (anchorX - prev.x)
      let y = anchorY - ratio * (anchorY - prev.y)
      if (scale <= MIN_SCALE) { x = 0; y = 0 }
      return { scale, x, y }
    })
  }, [])

  const centreAnchor = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 }
  }, [])

  const handleButtonZoom = useCallback((factor) => {
    const { x, y } = centreAnchor()
    zoomTo(transformRef.current.scale * factor, x, y)
  }, [centreAnchor, zoomTo])

  const reset = useCallback(() => setTransform({ scale: 1, x: 0, y: 0 }), [])

  // --- Pointer gesture handling -------------------------------------------

  const localPoint = useCallback((event) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return {
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0),
    }
  }, [])

  const onPointerDown = useCallback((event) => {
    surfaceRef.current?.setPointerCapture?.(event.pointerId)
    const p = localPoint(event)
    pointersRef.current.set(event.pointerId, p)
    movedRef.current = false

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      }
      panRef.current = null
    } else {
      panRef.current = p
    }
  }, [localPoint])

  const onPointerMove = useCallback((event) => {
    if (!pointersRef.current.has(event.pointerId)) return
    const p = localPoint(event)
    pointersRef.current.set(event.pointerId, p)

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const prev = pinchRef.current
      if (prev.dist > 0) {
        const cur = transformRef.current
        const nextScale = clamp(cur.scale * (dist / prev.dist), MIN_SCALE, MAX_SCALE)
        const ratio = nextScale / cur.scale
        // Zoom about the pinch midpoint AND pan by how the midpoint drifted,
        // so two-finger drag scrolls the zoomed page at the same time.
        const x = midX - ratio * (prev.midX - cur.x)
        const y = midY - ratio * (prev.midY - cur.y)
        setTransform({ scale: nextScale, x, y })
      }
      pinchRef.current = { dist, midX, midY }
      movedRef.current = true
      return
    }

    // Single-pointer drag → pan (only meaningful when zoomed in).
    if (panRef.current && transformRef.current.scale > 1) {
      const dx = p.x - panRef.current.x
      const dy = p.y - panRef.current.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true
      panRef.current = p
      setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
    }
  }, [localPoint])

  const onPointerUp = useCallback((event) => {
    pointersRef.current.delete(event.pointerId)
    surfaceRef.current?.releasePointerCapture?.(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 1) {
      panRef.current = [...pointersRef.current.values()][0]
    } else if (pointersRef.current.size === 0) {
      panRef.current = null
      // Double-tap to toggle zoom — only when the gesture wasn't a drag.
      if (!movedRef.current) {
        const now = event.timeStamp || performance.now()
        if (now - lastTapRef.current < 300) {
          const p = localPoint(event)
          if (transformRef.current.scale > 1) reset()
          else zoomTo(DOUBLE_TAP_SCALE, p.x, p.y)
          lastTapRef.current = 0
        } else {
          lastTapRef.current = now
        }
      }
    }
  }, [localPoint, reset, zoomTo])

  const onWheel = useCallback((event) => {
    event.preventDefault()
    const p = localPoint(event)
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    zoomTo(transformRef.current.scale * factor, p.x, p.y)
  }, [localPoint, zoomTo])

  const zoomed = transform.scale > 1

  const overlay = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Zoom image'}
      className="fixed inset-0 z-[120] bg-black"
    >
      {/* Zoom surface — sized by `inset-0` (not a flex child) so it always
          fills the viewport even on old Android WebViews where a percentage
          height through a flex-grown parent collapses to zero. */}
      <div
        ref={surfaceRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="absolute inset-0 overflow-hidden select-none"
        style={{ touchAction: 'none', cursor: zoomed ? 'grab' : 'zoom-in' }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
          className="absolute inset-0 w-full h-full object-contain"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        />
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center pointer-events-none">
            <p className="text-white/80 text-sm font-bold">
              {status === 'error' ? 'Could not load this page image.' : 'Loading…'}
            </p>
          </div>
        )}
      </div>

      {/* Toolbar — floats above the surface so the image fills the screen. */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-3 py-2 text-white">
        <span className="text-xs font-bold tabular-nums opacity-80 drop-shadow">
          {Math.round(transform.scale * 100)}%
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleButtonZoom(1 / 1.4)}
            disabled={transform.scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="w-10 h-10 rounded-full bg-white/20 text-xl font-black leading-none hover:bg-white/30 disabled:opacity-35"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => handleButtonZoom(1.4)}
            disabled={transform.scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="w-10 h-10 rounded-full bg-white/20 text-xl font-black leading-none hover:bg-white/30 disabled:opacity-35"
          >
            +
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!zoomed}
            aria-label="Reset zoom"
            className="h-10 px-3 rounded-full bg-white/20 text-xs font-black hover:bg-white/30 disabled:opacity-35"
          >
            Reset
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-10 px-4 rounded-full bg-white text-slate-900 text-sm font-black hover:bg-white/90"
          >
            Close ✕
          </button>
        </div>
      </div>

      <p className="absolute bottom-0 left-0 right-0 z-10 text-center text-white/70 text-[11px] font-bold py-1.5 drop-shadow pointer-events-none">
        Pinch or double-tap to zoom · drag to move
      </p>
    </div>
  )

  // Portal to <body> so `position: fixed` anchors to the viewport rather
  // than the transformed FullBleed ancestor (see the file header note).
  if (typeof document === 'undefined') return overlay
  return createPortal(overlay, document.body)
}
