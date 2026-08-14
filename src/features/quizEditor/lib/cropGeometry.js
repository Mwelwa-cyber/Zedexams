/**
 * cropGeometry — pure geometry for the in-editor image crop tool.
 *
 * A crop rectangle is stored as fractions of the image (x, y, w, h all in
 * 0..1) so it is resolution-independent. These helpers keep a rectangle valid
 * (inside the image, never smaller than a minimum) and convert it to source
 * pixels for canvas.drawImage. Kept pure + unit-tested; the DOM drag handling
 * lives in ImageCropModal.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

export const MIN_CROP_FRACTION = 0.05

/**
 * Clamp a crop rect to the image: each side stays within [0,1], width/height
 * are at least `minFrac`, and the box is shifted (not shrunk) when it would
 * spill past the right/bottom edge.
 */
export function clampCropRect(rect = {}, minFrac = MIN_CROP_FRACTION) {
  const min = Math.min(0.5, Math.max(0, minFrac))
  const w = Math.min(1, Math.max(min, Number.isFinite(rect.w) ? rect.w : 1))
  const h = Math.min(1, Math.max(min, Number.isFinite(rect.h) ? rect.h : 1))
  let x = clamp01(rect.x)
  let y = clamp01(rect.y)
  if (x + w > 1) x = 1 - w
  if (y + h > 1) y = 1 - h
  return { x: clamp01(x), y: clamp01(y), w, h }
}

/**
 * Build a normalised rect from two corner points (each {x,y} in 0..1), e.g.
 * the start and current position of a drag. Order-independent.
 */
export function rectFromPoints(a = {}, b = {}) {
  const x1 = clamp01(a.x)
  const y1 = clamp01(a.y)
  const x2 = clamp01(b.x)
  const y2 = clamp01(b.y)
  return clampCropRect({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  })
}

/**
 * Move a crop rect by a fractional delta, keeping it fully inside [0,1] without
 * shrinking it. Used when the user drags inside the selection to reposition it.
 */
export function moveCropRect(rect = {}, dx = 0, dy = 0) {
  const w = Math.min(1, Math.max(MIN_CROP_FRACTION, Number.isFinite(rect.w) ? rect.w : 1))
  const h = Math.min(1, Math.max(MIN_CROP_FRACTION, Number.isFinite(rect.h) ? rect.h : 1))
  const ddx = Number.isFinite(dx) ? dx : 0
  const ddy = Number.isFinite(dy) ? dy : 0
  const x = Math.min(1 - w, Math.max(0, clamp01(rect.x) + ddx))
  const y = Math.min(1 - h, Math.max(0, clamp01(rect.y) + ddy))
  return { x, y, w, h }
}

const HANDLES = new Set(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])

/**
 * Resize a crop rect by dragging one of the 8 handles to `point` ({x,y} in
 * 0..1). The opposite edge/corner stays anchored; corner handles move both
 * axes, edge handles only one. The result is clamped and never smaller than
 * MIN_CROP_FRACTION on the dragged axes.
 */
export function resizeCropRect(rect = {}, handle, point = {}) {
  if (!HANDLES.has(handle)) return clampCropRect(rect)
  // Current edges.
  let left = clamp01(rect.x)
  let top = clamp01(rect.y)
  let right = clamp01(rect.x + (Number.isFinite(rect.w) ? rect.w : 0))
  let bottom = clamp01(rect.y + (Number.isFinite(rect.h) ? rect.h : 0))
  const px = clamp01(point.x)
  const py = clamp01(point.y)

  if (handle.includes('w')) left = Math.min(px, right - MIN_CROP_FRACTION)
  if (handle.includes('e')) right = Math.max(px, left + MIN_CROP_FRACTION)
  if (handle.includes('n')) top = Math.min(py, bottom - MIN_CROP_FRACTION)
  if (handle.includes('s')) bottom = Math.max(py, top + MIN_CROP_FRACTION)

  return clampCropRect({ x: left, y: top, w: right - left, h: bottom - top })
}

/**
 * Distance in client pixels between two pointer points ({clientX, clientY}
 * or {x, y}). Pure — used to drive two-finger pinch zoom without touching the
 * DOM directly, so the zoom math is unit-testable.
 */
export function pointerDistance(a = {}, b = {}) {
  const ax = a.clientX ?? a.x ?? 0
  const ay = a.clientY ?? a.y ?? 0
  const bx = b.clientX ?? b.x ?? 0
  const by = b.clientY ?? b.y ?? 0
  return Math.hypot(bx - ax, by - ay)
}

/** Midpoint in client pixels between two pointer points. */
export function pointerMidpoint(a = {}, b = {}) {
  const ax = a.clientX ?? a.x ?? 0
  const ay = a.clientY ?? a.y ?? 0
  const bx = b.clientX ?? b.x ?? 0
  const by = b.clientY ?? b.y ?? 0
  return { x: (ax + bx) / 2, y: (ay + by) / 2 }
}

/**
 * New zoom level for a two-finger pinch gesture: scales `startZoom` by how
 * much the distance between the two touch points has changed since the
 * gesture began, clamped to [minZoom, maxZoom]. Pure ratio math — this is
 * what keeps a pinch gesture from "corrupting" the zoom (no drift, no NaN on
 * a near-zero starting distance).
 */
export function computeZoomFromPinch(startDistance, currentDistance, startZoom, minZoom, maxZoom) {
  const sd = Number(startDistance)
  const cd = Number(currentDistance)
  const sz = Number(startZoom)
  if (!Number.isFinite(sd) || sd <= 1 || !Number.isFinite(cd) || !Number.isFinite(sz)) {
    return Math.min(maxZoom, Math.max(minZoom, sz || minZoom))
  }
  const next = sz * (cd / sd)
  return Math.min(maxZoom, Math.max(minZoom, +next.toFixed(3)))
}

/** Convert a fractional rect to integer source-pixel box for drawImage. */
export function cropRectToPixels(rect, naturalW, naturalH) {
  const r = clampCropRect(rect)
  const W = Math.max(1, Math.round(naturalW) || 1)
  const H = Math.max(1, Math.round(naturalH) || 1)
  const sx = Math.round(r.x * W)
  const sy = Math.round(r.y * H)
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(W - sx, Math.round(r.w * W))),
    sh: Math.max(1, Math.min(H - sy, Math.round(r.h * H))),
  }
}
