/**
 * Tests for the crop geometry helpers. Plain `node` ES-module script.
 *
 * Run: node src/components/quiz/cropGeometry.test.js
 */

import assert from 'node:assert'
import { clampCropRect, rectFromPoints, cropRectToPixels, MIN_CROP_FRACTION } from './cropGeometry.js'

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

console.log(`\ncropGeometry: ${passed} passed`)
