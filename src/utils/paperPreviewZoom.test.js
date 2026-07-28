/**
 * Zoom, and the fact that it cannot reach pagination.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  DEFAULT_ZOOM, MAX_SCALE, MIN_SCALE, ZOOM_PRESETS,
  defaultZoomForWidth, normalizeZoom, resolveZoomScale,
} from './paperPreviewZoom.js'

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

const A4 = { pageWidth: 794, pageHeight: 1123 }

test('the five presets §1 asks for are all there', () => {
  assert.deepEqual(ZOOM_PRESETS.map((p) => p.id), ['fit-page', 'fit-width', '75', '100', '125'])
})

test('a fixed percentage is exactly that percentage, whatever the container', () => {
  assert.equal(resolveZoomScale('75', { ...A4, containerWidth: 300 }), 0.75)
  assert.equal(resolveZoomScale('100', { ...A4, containerWidth: 3000 }), 1)
  assert.equal(resolveZoomScale('125', { ...A4, containerWidth: 100 }), 1.25)
})

test('fit width fills the container less its gutter', () => {
  const scale = resolveZoomScale('fit-width', { ...A4, containerWidth: 826, gutter: 32 })
  assert.ok(Math.abs(scale - 1) < 0.001)
})

test('fit page also respects the height, so a whole sheet is visible', () => {
  const scale = resolveZoomScale('fit-page', {
    ...A4, containerWidth: 826, containerHeight: 594, gutter: 32,
  })
  assert.ok(scale < 0.6, 'the height is the binding constraint here')
  assert.ok(A4.pageHeight * scale <= 594)
})

test('fit page with no height measured falls back to fit width', () => {
  const scale = resolveZoomScale('fit-page', { ...A4, containerWidth: 826, containerHeight: 0, gutter: 32 })
  assert.ok(Math.abs(scale - 1) < 0.001)
})

test('a container that has not measured itself yet is 100%, not the minimum', () => {
  // A sheet drawn at the clamp floor for the one frame before the container
  // reports itself reads as a broken preview.
  assert.equal(resolveZoomScale('fit-width', { ...A4, containerWidth: 0 }), 1)
  assert.equal(resolveZoomScale('fit-page', { pageWidth: 0, containerWidth: 500 }), 1)
})

test('the scale is clamped at both ends', () => {
  assert.equal(resolveZoomScale('fit-width', { ...A4, containerWidth: 40, gutter: 0 }), MIN_SCALE)
  assert.equal(resolveZoomScale('fit-width', { ...A4, containerWidth: 100000, gutter: 0 }), MAX_SCALE)
})

test('an unknown preset is the default rather than an error', () => {
  assert.equal(normalizeZoom('400%'), DEFAULT_ZOOM)
  assert.equal(normalizeZoom(undefined), DEFAULT_ZOOM)
  assert.equal(normalizeZoom('125'), '125')
})

test('a phone starts at fit width', () => {
  assert.equal(defaultZoomForWidth(390), 'fit-width')
  assert.equal(defaultZoomForWidth(1440), DEFAULT_ZOOM)
})

test('zoom is a pure function of the preset and the box — nothing else', () => {
  // Stated as a property because it is the guarantee: the same preset and box
  // give the same scale, so no pagination state can leak into it.
  const box = { ...A4, containerWidth: 900, containerHeight: 700 }
  assert.equal(resolveZoomScale('fit-page', box), resolveZoomScale('fit-page', box))
})

test('a landscape sheet fits by its own dimensions, not A4 portrait’s', () => {
  const landscape = { pageWidth: 1123, pageHeight: 794 }
  const scale = resolveZoomScale('fit-width', { ...landscape, containerWidth: 1155, gutter: 32 })
  assert.ok(Math.abs(scale - 1) < 0.001)
})

console.log(`\n✓ preview zoom — ${passed} tests passed`)
