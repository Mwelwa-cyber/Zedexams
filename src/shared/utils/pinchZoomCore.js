/**
 * pinchZoomCore — the pure arithmetic behind pinch-to-zoom on a paper.
 *
 * Split out from the hook that reads the DOM (`src/shared/hooks/usePinchZoom.js`)
 * for the usual reason: the interesting part of a gesture is the maths, and
 * maths that lives inside a touch handler can only be tested by faking a
 * touch. Everything here runs under plain `node` (`npm run test:pinch-zoom`).
 *
 * Why the app implements pinch at all, rather than leaving it to the browser:
 * past papers are read on the Android build far more than on the web, and the
 * Capacitor WebView has `WebSettings.setBuiltInZoomControls` off by default —
 * which is what actually enables the pinch gesture on an Android WebView.
 * `touch-action: pinch-zoom` in CSS cannot turn that back on, so a learner on
 * the phone had NO way to enlarge a dense exam page: the reported bug. Owning
 * the gesture also means one behaviour everywhere (app, PWA, mobile browser,
 * desktop) instead of "the browser's visual-viewport zoom, where it happens to
 * be available".
 *
 * The zoom is a WIDTH multiplier, not a CSS transform. A transform would
 * magnify the pixels already on screen — a downscaled scan blown up is exactly
 * the unreadable thing the learner started with. Widening the page box makes
 * PDF.js re-rasterise at the larger scale, and lets an <img> draw from its own
 * full-resolution source, so zoomed text is genuinely sharper rather than
 * bigger.
 */

/** Below 1 the page is narrower than the column; 1 is fit-to-width. */
export const MIN_ZOOM = 0.6
/** 4× is where a 2000px-wide scan stops gaining detail and starts pixelating. */
export const MAX_ZOOM = 4
/** Fit the reading column — the resting state. */
export const FIT_ZOOM = 1
/** Where a double-tap lands: enough to read exam small-print on a phone. */
export const DOUBLE_TAP_ZOOM = 2

/**
 * Discrete stops for the +/− buttons. The gesture is continuous; the buttons
 * are not, so that repeated taps land on predictable, repeatable sizes.
 */
export const ZOOM_STEPS = Object.freeze([0.6, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4])

/** Two taps further apart than this are two taps, not a double-tap. */
export const DOUBLE_TAP_MS = 320
/** A "tap" that travelled further than this was a scroll. */
export const TAP_SLOP_PX = 24

/** Zoom differences below this are visually nothing — used for equality. */
const EPSILON = 0.005

export function clampZoom(value, min = MIN_ZOOM, max = MAX_ZOOM) {
  if (!Number.isFinite(value)) return FIT_ZOOM
  return Math.min(max, Math.max(min, value))
}

/** Distance between two points — the pinch's only input. */
export function touchDistance(a, b) {
  if (!a || !b) return 0
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Midpoint between two points — the focal point the zoom is anchored on. */
export function touchMidpoint(a, b) {
  if (!a || !b) return { x: 0, y: 0 }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * The zoom a pinch has reached.
 *
 * Measured against the zoom and finger distance at the START of the gesture,
 * never incrementally against the previous frame. Incremental accumulation is
 * what makes a pinch feel like it is fighting you: each frame's rounding and
 * every dropped frame compound, so releasing and re-pinching lands somewhere
 * different from where the fingers say it should. From the start distance, the
 * mapping from "how far apart my fingers are" to "how big the page is" holds
 * for the whole gesture however badly the device is keeping up.
 */
export function pinchZoom(startZoom, startDistance, currentDistance, min = MIN_ZOOM, max = MAX_ZOOM) {
  if (!(startDistance > 0) || !(currentDistance > 0)) return clampZoom(startZoom, min, max)
  return clampZoom(startZoom * (currentDistance / startDistance), min, max)
}

/**
 * The next discrete stop above (`direction` 1) or below (`-1`) a continuous
 * zoom. A pinch can leave the zoom at 1.37; pressing + must go to 1.5, not to
 * "the stop after the one 1.37 rounds to".
 */
export function stepZoom(current, direction, steps = ZOOM_STEPS) {
  const value = clampZoom(current, steps[0], steps[steps.length - 1])
  if (direction > 0) {
    const next = steps.find((s) => s > value + EPSILON)
    return next ?? steps[steps.length - 1]
  }
  const prev = [...steps].reverse().find((s) => s < value - EPSILON)
  return prev ?? steps[0]
}

/** Is this zoom effectively fit-to-width? Used to disable Reset / Fit. */
export function isFitZoom(value) {
  return Math.abs(value - FIT_ZOOM) < EPSILON
}

/** Double-tap toggles: away from fit → back to fit; at fit → in. */
export function toggleZoom(current) {
  return isFitZoom(current) ? DOUBLE_TAP_ZOOM : FIT_ZOOM
}

/**
 * Did this tap complete a double-tap?
 *
 * `moved` is the distance the finger travelled during the tap: a flick that
 * happens to end quickly after another one is a scroll, and zooming on it
 * would fire while the learner is reading.
 */
export function isDoubleTap({ now, lastTapAt, lastTapX = 0, lastTapY = 0, x = 0, y = 0, moved = 0 }) {
  if (!lastTapAt) return false
  if (moved > TAP_SLOP_PX) return false
  if (now - lastTapAt > DOUBLE_TAP_MS) return false
  return Math.hypot(x - lastTapX, y - lastTapY) <= TAP_SLOP_PX
}

/**
 * How far to scroll so the content under the focal point stays under it.
 *
 * Zooming a page stack moves everything: the box the learner is looking at
 * grows, and so does every box above it, so the paragraph under their fingers
 * ends up somewhere else entirely — the reason a naive zoom feels like it
 * throws you out of the paper. Given the anchor element's position and size on
 * one axis before and after the zoom, this returns the scroll delta that puts
 * the same fraction of that element back under the same screen coordinate.
 *
 * `before`/`after` are `{ start, size }` in client coordinates (top/height for
 * the vertical axis, left/width for the horizontal one).
 */
export function focalCorrection(before, after, focal) {
  if (!before || !after) return 0
  if (!(before.size > 0) || !(after.size > 0)) return 0
  const ratio = (focal - before.start) / before.size
  const target = after.start + ratio * after.size
  return target - focal
}

/**
 * Ctrl/⌘ + wheel (and a macOS trackpad pinch, which arrives as exactly that)
 * mapped to a zoom. Small deltas so a trackpad feels continuous rather than
 * jumping a stop per notch.
 */
export function wheelZoom(current, deltaY, min = MIN_ZOOM, max = MAX_ZOOM) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(current, min, max)
  return clampZoom(current * Math.exp(-deltaY / 220), min, max)
}
