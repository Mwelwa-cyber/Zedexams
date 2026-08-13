/**
 * How large the A4 sheets are drawn — and why that has nothing to do with where
 * the pages break.
 *
 * ## Zoom is independent of pagination, and it has to be provable
 *
 * A preview that re-paginated when the teacher zoomed would be showing them a
 * different paper at every zoom level, which is the opposite of what a zoom
 * control is for. The separation here is structural rather than careful: this
 * module produces a SCALE, the sheet is transformed by it, and nothing in the
 * pagination path is reachable from any of it. The page plan is computed from a
 * measurement taken at A4 width, always, whatever the screen is doing.
 *
 * ## Fit Page and Fit Width are computed, not stored
 *
 * They are relationships to the container, so they are resolved on every layout
 * rather than remembered as a number: a stored 0.62 is correct until the panel
 * is resized, and then it is a slightly-wrong "Fit Width" that nobody can
 * account for.
 */

export const ZOOM_PRESETS = Object.freeze([
  Object.freeze({ id: 'fit-page', label: 'Fit page' }),
  Object.freeze({ id: 'fit-width', label: 'Fit width' }),
  Object.freeze({ id: '75', label: '75%', scale: 0.75 }),
  Object.freeze({ id: '100', label: '100%', scale: 1 }),
  Object.freeze({ id: '125', label: '125%', scale: 1.25 }),
])

export const DEFAULT_ZOOM = 'fit-width'

/** The smallest and largest a sheet may be drawn, whatever the container says. */
export const MIN_SCALE = 0.2
export const MAX_SCALE = 3

export function normalizeZoom(value) {
  const id = String(value ?? '').trim()
  return ZOOM_PRESETS.some((p) => p.id === id) ? id : DEFAULT_ZOOM
}

const clamp = (n) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))

/**
 * Resolve a zoom preset to a scale factor.
 *
 * @param {string} preset one of ZOOM_PRESETS' ids
 * @param {object} box    {containerWidth, containerHeight, pageWidth, pageHeight}
 *                        all in CSS pixels; the page dimensions come from the
 *                        document's resolved layout tokens, so a landscape or
 *                        A5 paper fits correctly without a second code path.
 */
export function resolveZoomScale(preset, box = {}) {
  const id = normalizeZoom(preset)
  const fixed = ZOOM_PRESETS.find((p) => p.id === id)?.scale
  if (typeof fixed === 'number') return fixed

  const pageWidth = Number(box.pageWidth) || 0
  const pageHeight = Number(box.pageHeight) || 0
  const containerWidth = Number(box.containerWidth) || 0
  const containerHeight = Number(box.containerHeight) || 0
  // Nothing measured yet — 100%, because a sheet drawn at a scale derived from a
  // zero-width container would be drawn at the minimum and look broken for the
  // one frame before the container reports itself.
  if (pageWidth <= 0 || containerWidth <= 0) return 1

  // The gutter the sheet sits in. Subtracted here rather than in CSS so "fit
  // width" means the sheet fits, not that it fits except for its own padding.
  const gutter = Number.isFinite(Number(box.gutter)) ? Number(box.gutter) : 32
  const usableWidth = Math.max(0, containerWidth - gutter)

  if (id === 'fit-width') return clamp(usableWidth / pageWidth)

  const usableHeight = Math.max(0, containerHeight - gutter)
  if (pageHeight <= 0 || usableHeight <= 0) return clamp(usableWidth / pageWidth)
  return clamp(Math.min(usableWidth / pageWidth, usableHeight / pageHeight))
}

/**
 * The zoom a screen of this width should start at.
 *
 * A phone gets Fit Width — an A4 sheet at 100% on a 390px screen shows about a
 * third of the column, which reads as a broken preview rather than a zoomed one.
 * A desktop gets Fit Width too; the difference is that on a desktop it usually
 * resolves to something near 100% anyway.
 */
export function defaultZoomForWidth(containerWidth) {
  return Number(containerWidth) > 0 && Number(containerWidth) < 640 ? 'fit-width' : DEFAULT_ZOOM
}
