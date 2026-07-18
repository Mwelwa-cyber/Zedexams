/**
 * Tests for the crop geometry helpers. Plain `node` ES-module script.
 *
 * Run: node src/components/quiz/cropGeometry.test.js
 */

import assert from 'node:assert'
import {
  clampCropRect,
  rectFromPoints,
  cropRectToPixels,
  moveCropRect,
  resizeCropRect,
  MIN_CROP_FRACTION,
  pointerDistance,
  pointerMidpoint,
  computeZoomFromPinch,
} from './cropGeometry.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('cropGeometry')

test('clampCropRect leaves a valid rect unchanged', () => {
  const r = clampCropRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
  assert.deepEqual(r, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
})

test('clampCropRect shifts a rect that spills past the right/bottom edge', () => {
  const r = clampCropRect({ x: 0.9, y: 0.9, w: 0.3, h: 0.4 })
  assert.ok(approx(r.x + r.w, 1), 'right edge pinned to 1')
  assert.ok(approx(r.y + r.h, 1), 'bottom edge pinned to 1')
})

test('clampCropRect enforces a minimum size', () => {
  const r = clampCropRect({ x: 0.1, y: 0.1, w: 0.001, h: 0.001 })
  assert.ok(r.w >= MIN_CROP_FRACTION)
  assert.ok(r.h >= MIN_CROP_FRACTION)
})

test('clampCropRect clamps negative / out-of-range origins', () => {
  const r = clampCropRect({ x: -0.5, y: 2, w: 0.2, h: 0.2 })
  assert.ok(r.x >= 0 && r.y >= 0 && r.y + r.h <= 1.0000001)
})

test('rectFromPoints is order-independent', () => {
  const a = rectFromPoints({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.8 })
  const b = rectFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 })
  assert.deepEqual(a, b)
  assert.ok(approx(a.x, 0.2) && approx(a.y, 0.3))
  assert.ok(approx(a.w, 0.4) && approx(a.h, 0.5))
})

test('cropRectToPixels converts fractions to integer source pixels', () => {
  const px = cropRectToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1000, 800)
  assert.deepEqual(px, { sx: 250, sy: 400, sw: 500, sh: 200 })
})

test('cropRectToPixels never exceeds the image bounds', () => {
  const px = cropRectToPixels({ x: 0.95, y: 0.95, w: 0.2, h: 0.2 }, 100, 100)
  assert.ok(px.sx + px.sw <= 100)
  assert.ok(px.sy + px.sh <= 100)
  assert.ok(px.sw >= 1 && px.sh >= 1)
})

test('cropRectToPixels tolerates degenerate image sizes', () => {
  const px = cropRectToPixels({ x: 0, y: 0, w: 1, h: 1 }, 0, 0)
  assert.ok(px.sw >= 1 && px.sh >= 1)
})

test('moveCropRect translates without resizing', () => {
  const r = moveCropRect({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 0.1, -0.05)
  assert.ok(approx(r.x, 0.3) && approx(r.y, 0.15))
  assert.ok(approx(r.w, 0.3) && approx(r.h, 0.3))
})

test('moveCropRect clamps at the edges and keeps its size', () => {
  const r = moveCropRect({ x: 0.8, y: 0.8, w: 0.3, h: 0.3 }, 0.5, 0.5)
  assert.ok(approx(r.x + r.w, 1) && approx(r.y + r.h, 1))
  assert.ok(approx(r.w, 0.3) && approx(r.h, 0.3))
})

test('resizeCropRect se-handle moves the far corner, anchors the near one', () => {
  const r = resizeCropRect({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 'se', { x: 0.8, y: 0.7 })
  assert.ok(approx(r.x, 0.2) && approx(r.y, 0.2), 'top-left anchored')
  assert.ok(approx(r.w, 0.6) && approx(r.h, 0.5), 'bottom-right follows pointer')
})

test('resizeCropRect nw-handle moves the origin, anchors the far corner', () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } // far corner at (0.6, 0.6)
  const r = resizeCropRect(start, 'nw', { x: 0.1, y: 0.15 })
  assert.ok(approx(r.x, 0.1) && approx(r.y, 0.15), 'origin follows pointer')
  assert.ok(approx(r.x + r.w, 0.6) && approx(r.y + r.h, 0.6), 'far corner anchored')
})

test('resizeCropRect edge handle only changes one axis', () => {
  const r = resizeCropRect({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'e', { x: 0.9, y: 0.05 })
  assert.ok(approx(r.y, 0.2) && approx(r.h, 0.4), 'vertical extent unchanged')
  assert.ok(approx(r.x, 0.2) && approx(r.x + r.w, 0.9), 'right edge follows pointer')
})

test('resizeCropRect respects the minimum size when dragging past the anchor', () => {
  const r = resizeCropRect({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'se', { x: 0.2, y: 0.2 })
  assert.ok(r.w >= MIN_CROP_FRACTION && r.h >= MIN_CROP_FRACTION)
})

test('resizeCropRect ignores an unknown handle', () => {
  const r = resizeCropRect({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 'middle', { x: 0.9, y: 0.9 })
  assert.deepEqual(r, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 })
})

// ── pinch-zoom geometry (Phase 10: two-finger pinch without corrupting coords) ──
test('pointerDistance measures the gap between two touch points', () => {
  assert.ok(approx(pointerDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }), 5))
  assert.ok(approx(pointerDistance({ x: 10, y: 10 }, { x: 10, y: 10 }), 0))
})

test('pointerMidpoint is the average of the two points', () => {
  const m = pointerMidpoint({ clientX: 0, clientY: 0 }, { clientX: 10, clientY: 20 })
  assert.deepEqual(m, { x: 5, y: 10 })
})

test('computeZoomFromPinch scales proportionally to the distance change', () => {
  // Fingers move twice as far apart ⇒ zoom doubles (clamped to maxZoom).
  const z = computeZoomFromPinch(100, 200, 1, 1, 4)
  assert.ok(approx(z, 2))
})

test('computeZoomFromPinch clamps to [minZoom, maxZoom]', () => {
  assert.ok(approx(computeZoomFromPinch(100, 1000, 1, 1, 4), 4))
  assert.ok(approx(computeZoomFromPinch(100, 10, 2, 1, 4), 1))
})

test('computeZoomFromPinch never produces NaN/Infinity on a degenerate starting distance', () => {
  const z = computeZoomFromPinch(0, 50, 2, 1, 4)
  assert.ok(Number.isFinite(z))
  const z2 = computeZoomFromPinch(NaN, 50, 2, 1, 4)
  assert.ok(Number.isFinite(z2))
})

console.log(`\ncropGeometry: ${passed} passed`)
