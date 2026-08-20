/* Plain-node tests for pinchZoomCore (npm run test:pinch-zoom). */
import assert from 'node:assert/strict'
import {
  clampZoom,
  focalCorrection,
  isDoubleTap,
  isFitZoom,
  pinchZoom,
  stepZoom,
  toggleZoom,
  touchDistance,
  touchMidpoint,
  wheelZoom,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_ZOOM,
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  TAP_SLOP_PX,
  ZOOM_STEPS,
} from './pinchZoomCore.js'

/* ── clamping ──────────────────────────────────────────────────────────── */

assert.equal(clampZoom(2), 2, 'a zoom inside the range is returned unchanged')
assert.equal(clampZoom(99), MAX_ZOOM, 'zoom is capped')
assert.equal(clampZoom(0.01), MIN_ZOOM, 'zoom has a floor')
// A non-finite zoom means the arithmetic that produced it went wrong, so the
// answer is a known-good state rather than a guess at which end it "meant".
// Either way a NaN must never reach a CSS width, which renders as nothing.
assert.equal(clampZoom(NaN), FIT_ZOOM, 'a NaN zoom falls back to fit, never to a NaN width')
assert.equal(clampZoom(Infinity), FIT_ZOOM, 'a non-finite zoom falls back to fit too')

/* ── the pinch itself ──────────────────────────────────────────────────── */

assert.equal(pinchZoom(1, 100, 200), 2, 'fingers twice as far apart doubles the page')
assert.equal(pinchZoom(1, 200, 100), 0.5 < MIN_ZOOM ? MIN_ZOOM : 0.5,
  'fingers half as far apart halves the page, down to the floor')
assert.equal(pinchZoom(2, 100, 100), 2, 'no movement is no change')

// The whole reason the gesture measures from its START rather than frame to
// frame: dropped frames on a low-end phone must not change where it lands.
const smooth = pinchZoom(1, 100, 250)
const stuttered = pinchZoom(1, 100, 250) // same inputs, whatever happened between
assert.equal(smooth, stuttered, 'the result depends only on start and current, not on the path')
assert.equal(pinchZoom(1, 100, 130), pinchZoom(1, 200, 260),
  'only the RATIO of the finger spread matters, not the absolute spread')

assert.equal(pinchZoom(1, 0, 200), 1, 'a zero start distance cannot divide — hold the zoom')
assert.equal(pinchZoom(1.5, 100, 0), 1.5, 'a collapsed current distance holds the zoom too')

/* ── geometry helpers ──────────────────────────────────────────────────── */

assert.equal(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 'distance is the hypotenuse')
assert.equal(touchDistance(null, { x: 3, y: 4 }), 0, 'a missing touch is distance 0, not a throw')
assert.deepEqual(touchMidpoint({ x: 0, y: 10 }, { x: 4, y: 20 }), { x: 2, y: 15 }, 'midpoint')
assert.deepEqual(touchMidpoint(undefined, undefined), { x: 0, y: 0 }, 'midpoint degrades safely')

/* ── the +/− buttons ───────────────────────────────────────────────────── */

assert.equal(stepZoom(1, 1), 1.25, '+ from fit goes to the next stop')
assert.equal(stepZoom(1, -1), 0.9, '− from fit goes to the previous stop')
// A pinch leaves the zoom between stops; + must go UP from there, not snap
// back down to the stop the value happens to round to.
assert.equal(stepZoom(1.37, 1), 1.5, '+ from between stops goes to the next stop above')
assert.equal(stepZoom(1.37, -1), 1.25, '− from between stops goes to the next stop below')
assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM, '+ at the ceiling stays put')
assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM, '− at the floor stays put')
assert.equal(stepZoom(50, 1), MAX_ZOOM, 'an out-of-range value is clamped before stepping')
assert.deepEqual([...ZOOM_STEPS].sort((a, b) => a - b), [...ZOOM_STEPS],
  'the stops are ascending — stepZoom scans them in order')
assert.ok(ZOOM_STEPS.includes(FIT_ZOOM), 'stepping can always get back to exactly fit-to-width')

/* ── double-tap ────────────────────────────────────────────────────────── */

assert.equal(isFitZoom(1), true)
assert.equal(isFitZoom(1.001), true, 'float noise still reads as fit')
assert.equal(isFitZoom(1.25), false)
assert.equal(toggleZoom(FIT_ZOOM), DOUBLE_TAP_ZOOM, 'double-tap at rest zooms in')
assert.equal(toggleZoom(3), FIT_ZOOM, 'double-tap when zoomed returns to fit')

const T0 = 1_700_000_000_000
assert.equal(
  isDoubleTap({ now: T0 + 150, lastTapAt: T0, x: 100, y: 100, lastTapX: 104, lastTapY: 98 }),
  true,
  'two quick taps in the same place are a double-tap',
)
assert.equal(
  isDoubleTap({ now: T0 + DOUBLE_TAP_MS + 1, lastTapAt: T0, x: 100, y: 100, lastTapX: 100, lastTapY: 100 }),
  false,
  'too slow is two separate taps',
)
assert.equal(
  isDoubleTap({ now: T0 + 150, lastTapAt: T0, x: 300, y: 100, lastTapX: 100, lastTapY: 100 }),
  false,
  'two taps far apart are two taps',
)
assert.equal(
  isDoubleTap({ now: T0 + 150, lastTapAt: T0, x: 100, y: 100, lastTapX: 100, lastTapY: 100, moved: TAP_SLOP_PX + 1 }),
  false,
  'a flick that travelled is a scroll, never a zoom — this is the one that fires while reading',
)
assert.equal(isDoubleTap({ now: T0, lastTapAt: 0 }), false, 'the first tap of a session is not a double-tap')

/* ── focal anchoring ───────────────────────────────────────────────────── */

// The learner has their fingers 200px down a 400px-tall page whose top is at
// y=0. Zoom doubles it to 800px tall; without correction the paragraph they
// were reading is now at y=400 — off the bottom of a phone screen.
assert.equal(
  focalCorrection({ start: 0, size: 400 }, { start: 0, size: 800 }, 200),
  200,
  'scroll down by exactly how far the anchored content moved',
)
assert.equal(
  focalCorrection({ start: 0, size: 400 }, { start: 0, size: 400 }, 200),
  0,
  'no size change is no correction',
)
// The boxes ABOVE the anchor grow too, so the anchor's own top moves — that is
// folded in rather than being a second correction.
assert.equal(
  focalCorrection({ start: 100, size: 400 }, { start: -300, size: 800 }, 200),
  -300,
  'a shifted anchor is corrected in the other direction',
)
assert.equal(focalCorrection({ start: 0, size: 0 }, { start: 0, size: 800 }, 200), 0,
  'a zero-sized before box yields no correction rather than Infinity')
assert.equal(focalCorrection(null, { start: 0, size: 1 }, 0), 0, 'a missing measurement is no correction')

/* ── ctrl+wheel / trackpad pinch ───────────────────────────────────────── */

assert.ok(wheelZoom(1, -100) > 1, 'wheel up (negative deltaY) zooms in')
assert.ok(wheelZoom(1, 100) < 1, 'wheel down zooms out')
assert.equal(wheelZoom(1, 0), 1, 'a zero delta is no change')
assert.equal(wheelZoom(MAX_ZOOM, -1000), MAX_ZOOM, 'wheel respects the ceiling')
assert.equal(wheelZoom(MIN_ZOOM, 1000), MIN_ZOOM, 'wheel respects the floor')

console.log('pinchZoomCore: all assertions passed')
