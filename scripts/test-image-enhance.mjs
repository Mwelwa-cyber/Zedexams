// Unit tests for the pure image-enhancement maths and the width-preset
// helper used by the Assessment Studio camera / image-editing feature.
//
// These cover only the DOM-free pure functions — the canvas/getUserMedia glue
// is exercised in the browser, not here. Run: node scripts/test-image-enhance.mjs

import assert from 'node:assert/strict'
import {
  boxBlurChannel, autoLevels, binarize, removeShadows,
  adjustBrightnessContrast, varianceOfLaplacian, isBlurry,
  enhanceImageData, enhanceCanvasInPlace, BLUR_SCORE_THRESHOLD,
} from '../src/utils/imageEnhance.js'
import {
  resolveImageWidthPercent, normaliseImageWidth, IMAGE_WIDTH_OPTIONS, DEFAULT_IMAGE_WIDTH,
} from '../src/utils/imageWidth.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** Build a flat (uniform grey) RGBA image. */
function flatImage(w, h, v = 128) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

/** Build a high-frequency checkerboard (sharp edges everywhere). */
function checkerImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const v = (x + y) % 2 === 0 ? 0 : 255
      data[p] = data[p + 1] = data[p + 2] = v
      data[p + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

console.log('imageWidth presets')

test('resolveImageWidthPercent maps known presets', () => {
  assert.equal(resolveImageWidthPercent('small'), 33)
  assert.equal(resolveImageWidthPercent('medium'), 50)
  assert.equal(resolveImageWidthPercent('large'), 75)
  assert.equal(resolveImageWidthPercent('full'), 100)
})

test('resolveImageWidthPercent falls back to full for unknown/empty', () => {
  assert.equal(resolveImageWidthPercent(''), 100)
  assert.equal(resolveImageWidthPercent(undefined), 100)
  assert.equal(resolveImageWidthPercent('huge'), 100)
})

test('resolveImageWidthPercent clamps raw numbers', () => {
  assert.equal(resolveImageWidthPercent(40), 40)
  assert.equal(resolveImageWidthPercent(0), 10)
  assert.equal(resolveImageWidthPercent(999), 100)
})

test('normaliseImageWidth keeps known keys, defaults otherwise', () => {
  assert.equal(normaliseImageWidth('medium'), 'medium')
  assert.equal(normaliseImageWidth('MEDIUM'), 'medium')
  assert.equal(normaliseImageWidth('nope'), DEFAULT_IMAGE_WIDTH)
  assert.equal(normaliseImageWidth(null), 'full')
})

test('every width option resolves to its declared percent', () => {
  for (const o of IMAGE_WIDTH_OPTIONS) {
    assert.equal(resolveImageWidthPercent(o.key), o.percent)
  }
})

console.log('image enhancement maths')

test('enhanceImageData preserves dimensions and buffer length', () => {
  const img = checkerImage(16, 12)
  const out = enhanceImageData(img)
  assert.equal(out.width, 16)
  assert.equal(out.height, 12)
  assert.equal(out.data.length, img.data.length)
})

test('binarize produces only pure black or white, alpha intact', () => {
  const img = checkerImage(20, 20)
  const out = binarize(img)
  for (let i = 0; i < out.width * out.height; i++) {
    const v = out.data[i * 4]
    assert.ok(v === 0 || v === 255, `pixel ${i} was ${v}`)
    assert.equal(out.data[i * 4 + 3], 255)
  }
})

test('autoLevels expands a low-contrast image toward full range', () => {
  // Gradient confined to 100..150 → after auto levels it should span wider.
  const w = 50; const h = 4
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const v = 100 + Math.round((x / (w - 1)) * 50)
      data[p] = data[p + 1] = data[p + 2] = v
      data[p + 3] = 255
    }
  }
  const out = autoLevels({ data, width: w, height: h })
  let min = 255; let max = 0
  for (let i = 0; i < w * h; i++) {
    const v = out.data[i * 4]
    if (v < min) min = v
    if (v > max) max = v
  }
  assert.ok(max - min > 50, `expected wider range, got ${min}..${max}`)
})

test('boxBlurChannel spreads a single bright pixel to neighbours', () => {
  const w = 9; const h = 9
  const src = new Float32Array(w * h)
  src[4 * w + 4] = 255 // centre spike
  const out = boxBlurChannel(src, w, h, 1)
  // The spike is averaged down; an adjacent pixel becomes non-zero.
  assert.ok(out[4 * w + 4] < 255)
  assert.ok(out[4 * w + 5] > 0)
})

test('removeShadows lifts a dark uniform region toward white', () => {
  const img = flatImage(40, 40, 60) // dim grey "paper"
  const out = removeShadows(img, 1)
  let sum = 0
  for (let i = 0; i < out.width * out.height; i++) sum += out.data[i * 4]
  const mean = sum / (out.width * out.height)
  assert.ok(mean > 200, `expected whitened background, got mean ${mean.toFixed(1)}`)
})

test('adjustBrightnessContrast raises mean brightness', () => {
  const img = flatImage(10, 10, 100)
  const out = adjustBrightnessContrast(img, 40, 0)
  assert.ok(out.data[0] > 100)
})

test('varianceOfLaplacian separates sharp from flat images', () => {
  const sharp = varianceOfLaplacian(checkerImage(24, 24))
  const flat = varianceOfLaplacian(flatImage(24, 24, 128))
  assert.ok(sharp > flat, `sharp ${sharp} should exceed flat ${flat}`)
  assert.ok(flat < BLUR_SCORE_THRESHOLD)
  assert.ok(isBlurry(flat))
  assert.ok(!isBlurry(sharp))
})

// ── enhanceCanvasInPlace (browser wrapper, exercised with a fake canvas) ──────
// Polyfill the ImageData the wrapper constructs when writing pixels back.
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height }
  }
}

function fakeCanvas(w, h, { failContext = false } = {}) {
  const src = flatImage(w, h, 128)
  let put = null
  return {
    width: w,
    height: h,
    _put: () => put,
    getContext() {
      if (failContext) throw new Error('no 2d context')
      return {
        getImageData: () => src,
        putImageData: (imgData) => { put = imgData },
      }
    },
  }
}

test('enhanceCanvasInPlace enhances and writes pixels back', () => {
  const canvas = fakeCanvas(16, 16)
  const res = enhanceCanvasInPlace(canvas, { blackAndWhite: false })
  assert.equal(res.enhanced, true)
  assert.ok(canvas._put(), 'putImageData should have been called')
  assert.equal(canvas._put().width, 16)
})

test('enhanceCanvasInPlace never throws on a bad canvas', () => {
  const canvas = fakeCanvas(16, 16, { failContext: true })
  const res = enhanceCanvasInPlace(canvas)
  assert.equal(res.enhanced, false)
  assert.equal(res.blurry, false)
})

console.log(`\nAll ${passed} image-enhance tests passed.`)
