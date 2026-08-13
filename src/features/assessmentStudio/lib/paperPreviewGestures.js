/**
 * Pinch-to-zoom and pan for the paginated paper preview — the maths only.
 *
 * ## Why this exists as a pure module
 *
 * On a phone the preset buttons are the wrong tool: a teacher reading an A4
 * sheet on a 390px screen zooms with two fingers, the way they zoom everything
 * else on the device. The event wiring lives in PaperPagesPreview; every
 * decision it makes — how far a pinch has zoomed, where the scroll position
 * must land so the point between the fingers stays put — is computed here,
 * where a plain `node` test can hold it still.
 *
 * ## The focal point is the contract
 *
 * A pinch that zooms around the container's origin instead of the fingers
 * makes the content the teacher was looking at fly off-screen — which reads as
 * "zoom is broken" even though the scale is right. `focalPointScroll` returns
 * the scroll offsets that keep the content under the gesture's midpoint under
 * it after the new scale is applied. It is clamped by the browser (scroll
 * offsets never go negative or past the end), so callers assign it directly.
 */

import { MIN_SCALE, MAX_SCALE } from './paperPreviewZoom.js'

/** Two-finger distance below which a "pinch" is finger jitter, not a gesture. */
export const PINCH_MIN_DISTANCE = 10

const clampScale = (n, min, max) => Math.min(max, Math.max(min, n))

/** Straight-line distance between two touch points ({clientX, clientY}). */
export function touchDistance(a, b) {
  return Math.hypot((b?.clientX ?? 0) - (a?.clientX ?? 0), (b?.clientY ?? 0) - (a?.clientY ?? 0))
}

/** The point midway between two touches — the gesture's focal point. */
export function touchMidpoint(a, b) {
  return {
    x: ((a?.clientX ?? 0) + (b?.clientX ?? 0)) / 2,
    y: ((a?.clientY ?? 0) + (b?.clientY ?? 0)) / 2,
  }
}

/**
 * The scale a pinch has reached: the scale at gesture start, multiplied by how
 * far apart the fingers have moved since. Clamped to the same bounds as the
 * preset zoom, so a pinch can never draw a sheet the buttons could not.
 */
export function pinchNextScale({ startScale, startDistance, distance, min = MIN_SCALE, max = MAX_SCALE }) {
  const from = Number(startDistance)
  const to = Number(distance)
  const base = Number(startScale)
  if (!(from >= PINCH_MIN_DISTANCE) || !(to > 0) || !(base > 0)) return clampScale(base || 1, min, max)
  return clampScale(base * (to / from), min, max)
}

/**
 * Where the scroll offsets must land so the content under `focal` (container
 * coordinates) stays under it when the scale changes from prev to next.
 *
 * Derivation: the content coordinate under the focal point is
 * (scrollLeft + focal.x) / prevScale; after rescaling, that coordinate sits at
 * contentX * nextScale, and keeping it under focal.x means scrolling to
 * contentX * nextScale - focal.x.
 */
export function focalPointScroll({ scroll, focal, prevScale, nextScale }) {
  const prev = Number(prevScale)
  const next = Number(nextScale)
  if (!(prev > 0) || !(next > 0)) return { left: scroll?.left ?? 0, top: scroll?.top ?? 0 }
  const ratio = next / prev
  return {
    left: Math.max(0, ((scroll?.left ?? 0) + (focal?.x ?? 0)) * ratio - (focal?.x ?? 0)),
    top: Math.max(0, ((scroll?.top ?? 0) + (focal?.y ?? 0)) * ratio - (focal?.y ?? 0)),
  }
}

/**
 * The scale a Ctrl+wheel (or trackpad pinch, which browsers deliver as
 * ctrl+wheel) step reaches. Exponential in deltaY so equal wheel movement
 * feels like equal zoom whatever the current scale.
 */
export function wheelZoomScale({ scale, deltaY, min = MIN_SCALE, max = MAX_SCALE }) {
  const base = Number(scale)
  if (!(base > 0)) return clampScale(1, min, max)
  return clampScale(base * Math.exp(-(Number(deltaY) || 0) * 0.002), min, max)
}
