/**
 * ImageCropModal — drag-to-crop an attached image down to just the figure.
 *
 * Scanned-import diagrams/maps arrive as the whole page; this lets the admin
 * trim to the picture without leaving the editor. Self-contained: it only
 * opens from the optional "Crop" button on an image, returns a cropped Blob to
 * the parent (which runs it through the normal upload path), and changes
 * nothing on cancel — so it can't disturb any existing flow.
 *
 * Props:
 *   imageUrl        — source image (blob: from an import, or a Storage URL)
 *   onCropped(blob) — called with the cropped JPEG Blob
 *   onCancel()      — close without changing anything
 */

import { useRef, useState } from 'react'
import { rectFromPoints, clampCropRect, cropRectToPixels } from './cropGeometry'

// Load an image CORS-clean so the cropped canvas can be exported (no taint).
function loadCorsImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}

function canvasToJpegBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
  })
}

export default function ImageCropModal({ imageUrl, onCropped, onCancel }) {
  const imgRef = useRef(null)
  const dragStart = useRef(null)
  // Default to a centred 70% box so there is always a valid crop.
  const [rect, setRect] = useState({ x: 0.15, y: 0.15, w: 0.7, h: 0.7 })
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function pointFromEvent(event) {
    const box = imgRef.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return { x: 0, y: 0 }
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  function handlePointerDown(event) {
    event.preventDefault()
    dragStart.current = pointFromEvent(event)
    setDragging(true)
    setError('')
  }
  function handlePointerMove(event) {
    if (!dragging || !dragStart.current) return
    setRect(rectFromPoints(dragStart.current, pointFromEvent(event)))
  }
  function handlePointerUp() {
    setDragging(false)
    dragStart.current = null
  }

  async function handleCrop() {
    setBusy(true)
    setError('')
    try {
      const img = await loadCorsImage(imageUrl)
      const { sx, sy, sw, sh } = cropRectToPixels(rect, img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d', { alpha: false })
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const blob = await canvasToJpegBlob(canvas)
      onCropped?.(blob)
    } catch {
      setError('Could not crop this image — the browser may be blocking it. Use “Replace” to upload a cropped version instead.')
      setBusy(false)
    }
  }

  const safe = clampCropRect(rect)
  const pct = (n) => `${n * 100}%`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="theme-card theme-text w-full max-w-2xl space-y-4 rounded-2xl border theme-border p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-black">✂️ Crop image</h3>
          <button type="button" onClick={onCancel} className="theme-text-muted text-sm font-bold hover:underline">Cancel</button>
        </div>
        <p className="theme-text-muted text-xs font-bold leading-relaxed">
          Drag a box over the part you want to keep, then crop.
        </p>

        <div
          className="relative mx-auto max-h-[60vh] w-full touch-none select-none overflow-hidden rounded-xl border-2 theme-border"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Crop source"
            draggable={false}
            className="pointer-events-none mx-auto max-h-[60vh] w-full object-contain"
          />
          {/* dim outside + show selection */}
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{ left: pct(safe.x), top: pct(safe.y), width: pct(safe.w), height: pct(safe.h) }}
            />
          </div>
        </div>

        {error && <p className="text-xs font-bold text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}
            disabled={busy}
            className="theme-border theme-text rounded-lg border px-3 py-1.5 text-xs font-black disabled:opacity-50"
          >
            Reset
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
            disabled={busy}
            className="theme-accent-fill theme-on-accent rounded-lg px-4 py-1.5 text-xs font-black disabled:opacity-50"
          >
            {busy ? 'Cropping…' : 'Crop'}
          </button>
        </div>
      </div>
    </div>
  )
}
