/**
 * ImageCropModal — drag-to-crop an attached image down to just the figure.
 *
 * Scanned-import diagrams/maps arrive as the whole page; this lets the admin
 * trim to the picture without leaving the editor. Self-contained: it only
 * opens from the optional "Crop" button on an image, returns a cropped PNG Blob
 * to the parent (which runs it through the normal upload path), and changes
 * nothing on cancel — so it can't disturb any existing flow.
 *
 * The selection is *adjustable*: drag a handle to resize, drag inside to move,
 * or drag on empty space to draw a fresh box. Scroll / pinch zooms the source
 * so small figures can be trimmed precisely. Output is exported as lossless PNG
 * with a gentle upscale + unsharp-mask so the saved picture is sharper, not
 * softer (JPEG re-compression artefacts on lines/text are avoided entirely).
 *
 * Props:
 *   imageUrl        — source image (blob: from an import, or a Storage URL)
 *   onCropped(blob) — called with the cropped PNG Blob
 *   onCancel()      — close without changing anything
 *   initialBox      — optional AI-detected {x,y,w,h} (fractions 0-1) to open
 *                     with instead of a generic centred 70% box (Phase 10:
 *                     "the initial crop rectangle must use the detected
 *                     sourceFigureBox when available").
 *   pageNumber, questionNumber — optional labels shown in the header so the
 *                     admin knows exactly what they're cropping.
 */

import { useRef, useState } from 'react'
import {
  rectFromPoints,
  clampCropRect,
  cropRectToPixels,
  moveCropRect,
  resizeCropRect,
  pointerDistance,
  computeZoomFromPinch,
} from '../lib/cropGeometry'
import { loadCorsImage } from '../lib/cropImageLoad'
import { padAndClampBox } from '../../../utils/paperFigureAttachCore'
import useFocusTrap from '../../../hooks/useFocusTrap'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
// Output safety rails for the enhanced export.
const UPSCALE_TARGET = 1400 // upscale small crops toward this longest edge…
const MAX_OUTPUT_EDGE = 2400 // …but never beyond this.
const SHARPEN_PIXEL_CAP = 6_000_000 // skip the JS convolution above this size.

// Minimum touch target for a resize handle (Phase 10: 28-32px). The visible
// dot stays small; a transparent halo pads the actual hit area out to this so
// a finger doesn't need pixel-perfect precision on a phone.
const HANDLE_TOUCH_PX = 32

// The 8 resize handles, with the css positioning + cursor for each.
const HANDLES = [
  { id: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
  { id: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
  { id: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
  { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
  { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
  { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
  { id: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
  { id: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
]

const FULL_PAGE_RECT = { x: 0, y: 0, w: 1, h: 1 }
const DEFAULT_CENTRED_RECT = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }

function initialRectFor(initialBox) {
  const padded = initialBox ? padAndClampBox(initialBox) : null
  return padded || DEFAULT_CENTRED_RECT
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

// Mild unsharp mask (cross kernel) to crisp up edges after scaling. Operates
// in place on the canvas; skipped for very large canvases to stay responsive.
function sharpenCanvas(ctx, w, h, amount = 0.4) {
  if (w * h > SHARPEN_PIXEL_CAP) return
  const src = ctx.getImageData(0, 0, w, h)
  const out = ctx.createImageData(w, h)
  const s = src.data
  const d = out.data
  const center = 1 + 4 * amount
  const rowBytes = w * 4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const idx = i + c
        const up = y > 0 ? s[idx - rowBytes] : s[idx]
        const down = y < h - 1 ? s[idx + rowBytes] : s[idx]
        const left = x > 0 ? s[idx - 4] : s[idx]
        const right = x < w - 1 ? s[idx + 4] : s[idx]
        const v = center * s[idx] - amount * (up + down + left + right)
        d[idx] = v < 0 ? 0 : v > 255 ? 255 : v
      }
      d[i + 3] = s[i + 3]
    }
  }
  ctx.putImageData(out, 0, 0)
}

export default function ImageCropModal({ imageUrl, onCropped, onCancel, initialBox = null, pageNumber = null, questionNumber = null, onPrevPage = null, onNextPage = null }) {
  const imgRef = useRef(null)
  const scrollRef = useRef(null)
  const panelRef = useRef(null)
  // Active drag: { mode: 'draw'|'move'|'resize', handle?, startPoint, startRect }.
  const drag = useRef(null)
  // Live two-finger pinch: { pointers: Map<id,{clientX,clientY}>, startDistance, startZoom }.
  const pinch = useRef(null)
  // The rect the modal opened with — "Reset to automatic crop" returns here
  // (distinct from "Reset to full page"). Stable for the component's lifetime.
  const autoRectRef = useRef(initialRectFor(initialBox))
  const [rect, setRect] = useState(autoRectRef.current)
  // Single-level undo: the rect just before the last change that replaced it
  // wholesale (expand / reset / undo itself never pushes onto this stack).
  const undoRef = useRef(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The source <img> failed to load (e.g. a revoked blob: URL after an
  // autosave). Surface it loudly instead of leaving a collapsed, empty box the
  // teacher can't crop and can't diagnose.
  const [loadFailed, setLoadFailed] = useState(false)

  // Escape closes, Tab stays inside, focus returns to the opener on close.
  // Guard Escape while a crop export is in flight so a stray key can't abandon
  // the modal mid-operation.
  useFocusTrap(panelRef, { onEscape: () => { if (!busy) onCancel?.() } })

  function pointFromEvent(event) {
    const box = imgRef.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return { x: 0, y: 0 }
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  // Replace the rect wholesale (expand/reset/nudge), recording the PRIOR value
  // for one-level undo.
  function applyRect(next) {
    undoRef.current = rect
    setRect(clampCropRect(next))
  }

  function beginDrag(event, mode, handle) {
    event.preventDefault()
    event.stopPropagation()
    setError('')
    undoRef.current = rect
    drag.current = { mode, handle, startPoint: pointFromEvent(event), startRect: rect }
    scrollRef.current?.setPointerCapture?.(event.pointerId)
  }

  // Drawing a fresh box: only fires from the image itself (outside the box).
  // A SECOND finger touching down while the first is already active upgrades
  // the gesture to a two-finger pinch-zoom instead of drawing a box — the
  // pending single-finger drag is abandoned so the two never fight.
  function handleImagePointerDown(event) {
    if (event.pointerType === 'touch') {
      if (!pinch.current) pinch.current = { pointers: new Map() }
      pinch.current.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      if (pinch.current.pointers.size === 2) {
        event.preventDefault()
        drag.current = null // a pinch always wins over a pending single-finger draw
        const [a, b] = [...pinch.current.pointers.values()]
        pinch.current.startDistance = pointerDistance(a, b)
        pinch.current.startZoom = zoom
        return
      }
      if (pinch.current.pointers.size > 1) return
    }
    beginDrag(event, 'draw')
  }

  function handlePointerMove(event) {
    if (pinch.current && pinch.current.pointers.has(event.pointerId)) {
      pinch.current.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      if (pinch.current.pointers.size === 2 && pinch.current.startDistance) {
        event.preventDefault()
        const [a, b] = [...pinch.current.pointers.values()]
        const distance = pointerDistance(a, b)
        setZoom(computeZoomFromPinch(pinch.current.startDistance, distance, pinch.current.startZoom, MIN_ZOOM, MAX_ZOOM))
      }
      return
    }
    const d = drag.current
    if (!d) return
    const p = pointFromEvent(event)
    if (d.mode === 'draw') {
      setRect(rectFromPoints(d.startPoint, p))
    } else if (d.mode === 'move') {
      setRect(moveCropRect(d.startRect, p.x - d.startPoint.x, p.y - d.startPoint.y))
    } else if (d.mode === 'resize') {
      setRect(current => resizeCropRect(current, d.handle, p))
    }
  }

  function handlePointerUp(event) {
    if (pinch.current) {
      pinch.current.pointers.delete(event.pointerId)
      if (pinch.current.pointers.size < 2) pinch.current.startDistance = null
      if (pinch.current.pointers.size === 0) pinch.current = null
    }
    if (drag.current) {
      scrollRef.current?.releasePointerCapture?.(event.pointerId)
      drag.current = null
    }
  }

  function handleUndo() {
    if (undoRef.current) {
      const prev = undoRef.current
      undoRef.current = null
      setRect(prev)
    }
  }

  function expandCrop(extraFrac) {
    applyRect(padAndClampBox(rect, extraFrac) || rect)
  }

  // On-screen fine-adjust: nudge the whole box by a small fixed step —
  // accessible alternative to a finger drag for 1-pixel-scale corrections.
  function nudge(dx, dy) {
    applyRect(moveCropRect(rect, dx, dy))
  }

  function handleWheel(event) {
    event.preventDefault()
    setZoom(z => {
      const next = z * (event.deltaY < 0 ? 1.12 : 0.89)
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +next.toFixed(3)))
    })
  }

  async function handleCrop() {
    setBusy(true)
    setError('')
    try {
      const img = await loadCorsImage(imageUrl)
      const { sx, sy, sw, sh } = cropRectToPixels(rect, img.naturalWidth, img.naturalHeight)

      // Gentle upscale for small crops; never beyond MAX_OUTPUT_EDGE.
      const longest = Math.max(sw, sh)
      let scale = longest < UPSCALE_TARGET ? Math.min(2, UPSCALE_TARGET / longest) : 1
      scale = Math.min(scale, MAX_OUTPUT_EDGE / longest)
      const outW = Math.max(1, Math.round(sw * scale))
      const outH = Math.max(1, Math.round(sh * scale))

      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d', { alpha: false })
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
      sharpenCanvas(ctx, outW, outH)

      const blob = await canvasToPngBlob(canvas)
      onCropped?.(blob)
    } catch {
      setError('Could not crop this image — the browser may be blocking it. Use “Replace” to upload a cropped version instead.')
    } finally {
      // Always clear busy — even on the success path. Today the parent unmounts
      // this modal right after onCropped, but if that ordering ever changes a
      // success without this reset would leave a spinning, disabled "Cropping…"
      // button. A reset on an unmounting component is a harmless no-op.
      setBusy(false)
    }
  }

  const safe = clampCropRect(rect)
  const pct = (n) => `${n * 100}%`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-crop-modal-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.() }}
    >
      <div ref={panelRef} className="theme-card theme-text w-full max-w-2xl space-y-4 rounded-2xl border theme-border p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="image-crop-modal-title" className="text-base font-black">✂️ Crop image</h3>
            {(pageNumber != null || questionNumber != null) && (
              <p className="theme-text-muted text-xs font-bold mt-0.5 flex items-center gap-1.5">
                {questionNumber != null && <span>Question {questionNumber}</span>}
                {questionNumber != null && pageNumber != null && <span aria-hidden="true">·</span>}
                {/* Optional page navigation (crop-from-source-paper flow): the
                    parent re-renders with the neighbouring page's image; the
                    buttons only exist when a neighbour exists. */}
                {onPrevPage && (
                  <button
                    type="button"
                    onClick={onPrevPage}
                    disabled={busy}
                    aria-label="Previous page"
                    className="theme-card theme-border theme-text hover:theme-card-hover min-h-0 rounded border px-1.5 py-0.5 text-xs font-bold"
                  >
                    ‹
                  </button>
                )}
                {pageNumber != null && <span>Page {pageNumber}</span>}
                {onNextPage && (
                  <button
                    type="button"
                    onClick={onNextPage}
                    disabled={busy}
                    aria-label="Next page"
                    className="theme-card theme-border theme-text hover:theme-card-hover min-h-0 rounded border px-1.5 py-0.5 text-xs font-bold"
                  >
                    ›
                  </button>
                )}
              </p>
            )}
          </div>
          <button type="button" onClick={onCancel} className="theme-text-muted text-sm font-bold hover:underline">Cancel</button>
        </div>
        <p className="theme-text-muted text-xs font-bold leading-relaxed">
          Drag the handles to resize, drag inside the box to move it, or draw a new box on empty space. Scroll or pinch with two fingers to zoom. Double-tap the box to fit the suggested figure. Saved as a sharp, lossless PNG.
        </p>

        <div
          ref={scrollRef}
          className="relative mx-auto max-h-[60vh] w-full touch-none select-none overflow-auto rounded-xl border-2 theme-border"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          <div className="relative inline-block align-top" style={{ width: pct(zoom) }}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop source"
              draggable={false}
              onPointerDown={handleImagePointerDown}
              onLoad={() => setLoadFailed(false)}
              onError={() => setLoadFailed(true)}
              className="block w-full min-h-[3rem]"
            />
            {/* overlay matches the image box exactly; only the box + handles capture pointers */}
            <div className={`pointer-events-none absolute inset-0 ${loadFailed ? 'hidden' : ''}`}>
              <div
                className="pointer-events-auto absolute cursor-move border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ left: pct(safe.x), top: pct(safe.y), width: pct(safe.w), height: pct(safe.h) }}
                onPointerDown={event => beginDrag(event, 'move')}
                onDoubleClick={() => applyRect(autoRectRef.current)}
              >
                {HANDLES.map(h => (
                  <span
                    key={h.id}
                    role="presentation"
                    data-handle={h.id}
                    onPointerDown={event => beginDrag(event, 'resize', h.id)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full"
                    style={{ left: h.style.left, top: h.style.top, cursor: h.cursor, width: HANDLE_TOUCH_PX, height: HANDLE_TOUCH_PX }}
                  >
                    {/* visible dot sits inside the larger transparent touch target above */}
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-amber-400 bg-white shadow" />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {loadFailed && (
          <p className="text-xs font-bold text-red-600">
            This figure could not be loaded — its temporary image may have expired. Close this and use “Clean original drawing” or “Replace” on the figure instead.
          </p>
        )}
        {error && <p className="text-xs font-bold text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="theme-text-muted text-xs font-black">Expand</span>
          <button type="button" onClick={() => expandCrop(0.02)} disabled={busy}
            className="theme-border theme-text rounded-lg border px-2.5 py-1 text-xs font-black disabled:opacity-40">
            +2%
          </button>
          <button type="button" onClick={() => expandCrop(0.05)} disabled={busy}
            className="theme-border theme-text rounded-lg border px-2.5 py-1 text-xs font-black disabled:opacity-40">
            +5%
          </button>
          <button type="button" onClick={handleUndo} disabled={busy || !undoRef.current}
            className="theme-border theme-text rounded-lg border px-2.5 py-1 text-xs font-black disabled:opacity-40">
            ↶ Undo
          </button>
          <div className="ml-2 flex items-center gap-1" role="group" aria-label="Fine-adjust position">
            <span className="theme-text-muted text-xs font-black">Nudge</span>
            {[
              { label: '←', dx: -0.005, dy: 0 },
              { label: '→', dx: 0.005, dy: 0 },
              { label: '↑', dx: 0, dy: -0.005 },
              { label: '↓', dx: 0, dy: 0.005 },
            ].map(n => (
              <button
                key={n.label}
                type="button"
                onClick={() => nudge(n.dx, n.dy)}
                disabled={busy}
                aria-label={`Nudge crop ${n.label}`}
                className="theme-border theme-text rounded-lg border px-2 py-1 text-xs font-black disabled:opacity-40"
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="theme-text-muted text-xs font-black">Zoom</span>
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))}
              disabled={busy || zoom <= MIN_ZOOM}
              className="theme-border theme-text min-h-0 rounded-lg border px-2.5 py-1 text-xs font-black disabled:opacity-40"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))}
              disabled={busy || zoom >= MAX_ZOOM}
              className="theme-border theme-text min-h-0 rounded-lg border px-2.5 py-1 text-xs font-black disabled:opacity-40"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {autoRectRef.current !== DEFAULT_CENTRED_RECT && (
              <button
                type="button"
                onClick={() => applyRect(autoRectRef.current)}
                disabled={busy}
                className="theme-border theme-text rounded-lg border px-3 py-1.5 text-xs font-black disabled:opacity-50"
                title="Auto-detect diagram — return to the AI-suggested crop"
              >
                🔍 Auto-detect
              </button>
            )}
            <button
              type="button"
              onClick={() => { applyRect(FULL_PAGE_RECT); setZoom(MIN_ZOOM) }}
              disabled={busy}
              className="theme-border theme-text rounded-lg border px-3 py-1.5 text-xs font-black disabled:opacity-50"
              title="Use the full question image, uncropped"
            >
              Full page
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="theme-border theme-text rounded-lg border px-3 py-1.5 text-xs font-black disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCrop}
              disabled={busy || loadFailed}
              className="theme-accent-fill theme-on-accent rounded-lg px-4 py-1.5 text-xs font-black disabled:opacity-50"
            >
              {busy ? 'Cropping…' : 'Crop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
