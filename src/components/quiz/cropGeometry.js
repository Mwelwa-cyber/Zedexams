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
