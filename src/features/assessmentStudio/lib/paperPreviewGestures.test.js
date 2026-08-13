/**
 * Pinch/pan maths for the paper preview.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { MIN_SCALE, MAX_SCALE } from './paperPreviewZoom.js'
import {
  PINCH_MIN_DISTANCE, focalPointScroll, pinchNextScale, touchDistance,
  touchMidpoint, wheelZoomScale,
} from './paperPreviewGestures.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const touch = (clientX, clientY) => ({ clientX, clientY })

test('distance and midpoint are what geometry says they are', () => {
  assert.equal(touchDistance(touch(0, 0), touch(3, 4)), 5)
  assert.deepEqual(touchMidpoint(touch(0, 0), touch(100, 40)), { x: 50, y: 20 })
})

test('spreading the fingers to twice the distance doubles the scale', () => {
  assert.equal(pinchNextScale({ startScale: 1, startDistance: 100, distance: 200 }), 2)
  assert.equal(pinchNextScale({ startScale: 0.5, startDistance: 100, distance: 200 }), 1)
})

test('pinching the fingers together shrinks by the same ratio', () => {
  assert.equal(pinchNextScale({ startScale: 2, startDistance: 200, distance: 100 }), 1)
})

test('a pinch is clamped to the same bounds as the preset zoom', () => {
  assert.equal(pinchNextScale({ startScale: 2, startDistance: 100, distance: 1000 }), MAX_SCALE)
  assert.equal(pinchNextScale({ startScale: 0.5, startDistance: 1000, distance: 10 }), MIN_SCALE)
})

test('finger jitter below the minimum start distance changes nothing', () => {
  const start = PINCH_MIN_DISTANCE - 1
  assert.equal(pinchNextScale({ startScale: 1.4, startDistance: start, distance: start * 3 }), 1.4)
})

test('garbage inputs resolve to a clamped, drawable scale — never NaN', () => {
  assert.equal(pinchNextScale({ startScale: NaN, startDistance: 0, distance: 0 }), 1)
  assert.equal(wheelZoomScale({ scale: NaN, deltaY: 100 }), 1)
})

test('the content under the fingers stays under them across a zoom', () => {
  // Content coordinate under the focal point before: (200 + 100) / 1 = 300.
  // After doubling, that coordinate draws at 600; keeping it under x=100
  // means scrolling to 500.
  const next = focalPointScroll({
    scroll: { left: 200, top: 400 },
    focal: { x: 100, y: 50 },
    prevScale: 1,
    nextScale: 2,
  })
  assert.deepEqual(next, { left: 500, top: 850 })
})

test('zooming out never asks for a negative scroll offset', () => {
  const next = focalPointScroll({
    scroll: { left: 10, top: 10 },
    focal: { x: 300, y: 300 },
    prevScale: 2,
    nextScale: 1,
  })
  assert.ok(next.left >= 0 && next.top >= 0)
})

test('a broken scale pair leaves the scroll where it was', () => {
  const next = focalPointScroll({
    scroll: { left: 120, top: 60 }, focal: { x: 10, y: 10 }, prevScale: 0, nextScale: 1,
  })
  assert.deepEqual(next, { left: 120, top: 60 })
})

test('ctrl+wheel zooms exponentially and symmetrically', () => {
  const inOnce = wheelZoomScale({ scale: 1, deltaY: -100 })
  const backOut = wheelZoomScale({ scale: inOnce, deltaY: 100 })
  assert.ok(inOnce > 1)
  assert.ok(Math.abs(backOut - 1) < 1e-9, 'equal and opposite steps cancel')
})

test('wheel zoom respects the same clamp as everything else', () => {
  assert.equal(wheelZoomScale({ scale: MAX_SCALE, deltaY: -1000 }), MAX_SCALE)
  assert.equal(wheelZoomScale({ scale: MIN_SCALE, deltaY: 1000 }), MIN_SCALE)
})

console.log(`\n✓ preview gestures — ${passed} tests passed`)
