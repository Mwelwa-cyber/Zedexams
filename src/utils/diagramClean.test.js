/**
 * Unit tests for the diagram-cleaning pixel math. Plain `node` ES-module
 * script — throws on the first failed assertion, matching the repo's other
 * *.test.js node scripts. The canvas/Image wrappers are browser-only and not
 * exercised here; the pure transforms (greyscale, levels, sharpen, Otsu,
 * binarize, rotate, crop, content-bounds, full pipeline) are what carry the
 * correctness and run with no DOM.
 *
 * Run: node src/utils/diagramClean.test.js
 */

import assert from 'node:assert'
import {
  clamp8,
  luma,
  toGreyscale,
  applyBrightnessContrast,
  lumaHistogram,
  otsuThreshold,
  whitenBackground,
  sharpen,
  binarize,
  adaptiveBinarize,
  fractionBelow,
  rotateRGBA,
  computeContentBounds,
  cropImageData,
  cleanPixels,
  loadCleanableImage,
} from './diagramClean.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// Build an RGBA image from a width×height array of [r,g,b] (alpha forced 255).
function img(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

const px = (image, x, y) => {
  const i = (y * image.width + x) * 4
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]]
}

console.log('diagramClean')

// ── helpers ──────────────────────────────────────────────────────────────────
test('clamp8 bounds and rounds', () => {
  assert.equal(clamp8(-5), 0)
  assert.equal(clamp8(300), 255)
  assert.equal(clamp8(127.6), 128)
})

test('luma weights green most', () => {
  assert.ok(luma(0, 255, 0) > luma(255, 0, 0))
  assert.ok(luma(255, 0, 0) > luma(0, 0, 255))
})

// ── greyscale ──────────────────────────────────────────────────────────────────
test('toGreyscale sets R=G=B to luma and keeps alpha', () => {
  const out = toGreyscale(img(2, 1, () => [255, 0, 0]))
  const [r, g, b, a] = px(out, 0, 0)
  assert.equal(r, g)
  assert.equal(g, b)
  assert.equal(r, clamp8(luma(255, 0, 0)))
  assert.equal(a, 255)
})

// ── brightness / contrast ────────────────────────────────────────────────────
test('positive brightness lightens, negative darkens', () => {
  const base = img(1, 1, () => [100, 100, 100])
  assert.ok(px(applyBrightnessContrast(base, { brightness: 40 }), 0, 0)[0] > 100)
  assert.ok(px(applyBrightnessContrast(base, { brightness: -40 }), 0, 0)[0] < 100)
})

test('contrast pushes a dark pixel darker and a light pixel lighter', () => {
  const dark = applyBrightnessContrast(img(1, 1, () => [60, 60, 60]), { contrast: 60 })
  const light = applyBrightnessContrast(img(1, 1, () => [200, 200, 200]), { contrast: 60 })
  assert.ok(px(dark, 0, 0)[0] < 60)
  assert.ok(px(light, 0, 0)[0] > 200)
})

// ── histogram + Otsu ───────────────────────────────────────────────────────────
test('lumaHistogram counts every pixel once', () => {
  const hist = lumaHistogram(img(4, 4, () => [0, 0, 0]))
  assert.equal(hist.reduce((s, n) => s + n, 0), 16)
  assert.equal(hist[0], 16)
})

test('otsuThreshold separates a bimodal dark/light split', () => {
  // Half dark (20), half light (235). Otsu returns the top of the dark cluster;
  // the property that matters is that binarizing at it sends dark→black,
  // light→white.
  const image = img(10, 2, (x) => (x < 5 ? [20, 20, 20] : [235, 235, 235]))
  const t = otsuThreshold(image)
  assert.ok(t >= 20 && t < 235, `expected 20<=t<235, got ${t}`)
  const bw = binarize(image, t)
  assert.equal(px(bw, 0, 0)[0], 0) // dark cluster → black
  assert.equal(px(bw, 9, 0)[0], 255) // light cluster → white
})

// ── whiten ─────────────────────────────────────────────────────────────────────
test('whitenBackground pushes the light page tint to pure white', () => {
  // A grey/tinted page (210) with a bit of dark ink (40).
  const image = img(10, 1, (x) => (x === 0 ? [40, 40, 40] : [210, 205, 200]))
  const out = whitenBackground(image)
  assert.equal(px(out, 9, 0)[0], 255) // tinted background → white
  assert.ok(px(out, 0, 0)[0] < 60) // ink stays dark
})

// ── sharpen ────────────────────────────────────────────────────────────────────
test('sharpen increases contrast at an edge', () => {
  // Vertical edge: left dark, right light.
  const image = img(3, 1, (x) => (x === 0 ? [100, 100, 100] : [160, 160, 160]))
  const out = sharpen(image, 1)
  // The light pixel next to the edge should be pushed lighter than its input.
  assert.ok(px(out, 1, 0)[0] >= 160)
})

test('sharpen amount 0 is a no-op clone', () => {
  const image = img(2, 2, () => [123, 80, 200])
  const out = sharpen(image, 0)
  assert.deepEqual(Array.from(out.data), Array.from(image.data))
  assert.notStrictEqual(out.data, image.data) // a copy, not the same ref
})

// ── binarize ───────────────────────────────────────────────────────────────────
test('binarize yields only black and white', () => {
  const image = img(10, 1, (x) => [x * 25, x * 25, x * 25])
  const out = binarize(image, 128)
  for (let x = 0; x < 10; x += 1) {
    const v = px(out, x, 0)[0]
    assert.ok(v === 0 || v === 255, `pixel ${x} was ${v}`)
  }
  assert.equal(px(out, 0, 0)[0], 0) // darkest → black
  assert.equal(px(out, 9, 0)[0], 255) // lightest → white
})

// ── adaptive (Sauvola) threshold + faint-content fallback ──────────────────────
test('fractionBelow counts the dark share of an image', () => {
  // 10 px ramp 0,25,…,225. Six are < 128 (0,25,50,75,100,125), four are >= 128.
  const image = img(10, 1, (x) => [x * 25, x * 25, x * 25])
  assert.equal(fractionBelow(image, 128), 0.6)
  assert.equal(fractionBelow(image, 0), 0)
})

test('adaptiveBinarize inks a faint stroke that global Otsu would wash out', () => {
  // Bright page (240) with a 2px faint vertical stroke (180) — Otsu on this
  // near-uniform histogram tends to drop the faint stroke; Sauvola keeps it.
  const image = img(20, 20, (x) => (x >= 9 && x <= 10 ? [180, 180, 180] : [240, 240, 240]))
  const out = adaptiveBinarize(image)
  assert.equal(px(out, 9, 10)[0], 0) // faint stroke → ink
  assert.equal(px(out, 19, 19)[0], 255) // page → white
  // Every pixel is strictly black or white.
  for (let i = 0; i < out.data.length; i += 4) {
    assert.ok(out.data[i] === 0 || out.data[i] === 255)
  }
})

test('cleanPixels falls back to adaptive when Otsu keeps heavy ink but drops faint strokes', () => {
  // A heavy ink line (20) + faint pencil strokes (185) on a page (240). Global
  // Otsu latches onto the heavy line and thresholds the faint strokes away;
  // the fallback recovers them.
  const image = img(20, 20, (x) => {
    if (x === 2) return [20, 20, 20] // heavy ink line
    if (x === 9 || x === 10) return [185, 185, 185] // faint pencil strokes
    return [240, 240, 240] // page
  })
  const out = cleanPixels(image)
  assert.equal(px(out, 9, 10)[0], 0, 'faint stroke survives via adaptive fallback')
  assert.equal(px(out, 2, 10)[0], 0, 'heavy ink stays black')
  assert.equal(px(out, 16, 5)[0], 255, 'page stays white')
})

// ── rotate ─────────────────────────────────────────────────────────────────────
test('rotateRGBA 90° clockwise swaps dims and moves top-left to top-right', () => {
  // 2x1: pixel (0,0)=red marker, (1,0)=white.
  const image = img(2, 1, (x) => (x === 0 ? [255, 0, 0] : [255, 255, 255]))
  const out = rotateRGBA(image, 1)
  assert.equal(out.width, 1)
  assert.equal(out.height, 2)
  // (0,0) of a 2-wide row rotates clockwise to the top of the 1-wide column.
  assert.deepEqual(px(out, 0, 0).slice(0, 3), [255, 0, 0])
})

test('rotateRGBA 4 turns returns the original', () => {
  const image = img(3, 2, (x, y) => [x * 10, y * 10, 0])
  const out = rotateRGBA(image, 4)
  assert.equal(out.width, 3)
  assert.equal(out.height, 2)
  assert.deepEqual(Array.from(out.data), Array.from(image.data))
})

// ── crop + content bounds ──────────────────────────────────────────────────────
test('computeContentBounds finds the dark drawing inside a white margin', () => {
  // 10x10 white page with a 2x2 dark block at (4,4).
  const image = img(10, 10, (x, y) =>
    x >= 4 && x <= 5 && y >= 4 && y <= 5 ? [10, 10, 10] : [255, 255, 255])
  const b = computeContentBounds(image, { padding: 0 })
  assert.equal(b.empty, false)
  assert.equal(b.x, 4)
  assert.equal(b.y, 4)
  assert.equal(b.width, 2)
  assert.equal(b.height, 2)
})

test('computeContentBounds reports empty for a blank page', () => {
  const b = computeContentBounds(img(5, 5, () => [255, 255, 255]))
  assert.equal(b.empty, true)
})

test('cropImageData extracts the requested box', () => {
  const image = img(4, 4, (x, y) => [x, y, 0])
  const out = cropImageData(image, { x: 1, y: 2, width: 2, height: 1 })
  assert.equal(out.width, 2)
  assert.equal(out.height, 1)
  assert.deepEqual(px(out, 0, 0).slice(0, 2), [1, 2])
  assert.deepEqual(px(out, 1, 0).slice(0, 2), [2, 2])
})

// ── full pipeline ──────────────────────────────────────────────────────────────
test('cleanPixels on a tinted photo yields a clean B&W figure', () => {
  // A 12x4 "diagram": dark ink line on a yellow-tinted, slightly shadowed page.
  const image = img(12, 4, (x, y) => {
    const shadow = y * 4 // mild top-to-bottom shadow
    if (x >= 2 && x <= 9 && y === 1) return [40, 40, 30] // ink line
    return [225 - shadow, 220 - shadow, 200 - shadow] // tinted page
  })
  const out = cleanPixels(image)
  // Output is strictly black or white everywhere.
  for (let i = 0; i < out.data.length; i += 4) {
    const v = out.data[i]
    assert.ok(v === 0 || v === 255)
  }
  // The ink line is black, the page corners are white.
  assert.equal(px(out, 5, 1)[0], 0)
  assert.equal(px(out, 0, 0)[0], 255)
  assert.equal(px(out, 11, 3)[0], 255)
})

test('cleanPixels with blackAndWhite:false keeps greyscale (not 1-bit)', () => {
  const image = img(6, 1, (x) => [x * 40, x * 40, x * 40])
  const out = cleanPixels(image, { blackAndWhite: false, whiten: false, sharpenAmount: 0 })
  const values = new Set()
  for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i])
  assert.ok(values.size > 2, 'expected a greyscale range, not just black/white')
})

// ─── loadCleanableImage (CORS-safe loader) ─────────────────────────────────────
// Regression for the "Could not clean this figure automatically" bug: the figure
// thumbnail loads the URL with a plain <img> (no crossOrigin), poisoning the
// cache, so a naive crossOrigin='anonymous' re-request reused the tainted entry
// and getImageData() threw. loadCleanableImage must cache-bust the CORS request
// and fall back to a same-origin object URL when the CORS load fails.

// Minimal stubs so the browser-only loader runs under node.
function withStubs({ imgShouldFail = false, fetchOk = true } = {}, run) {
  const created = []
  const savedImage = global.Image
  const savedFetch = global.fetch
  const savedURL = global.URL
  const revoked = []
  global.Image = class {
    constructor() {
      this.crossOrigin = null
      created.push(this)
    }
    set src(value) {
      this._src = value
      // blob:/object URLs always load; CORS URLs honour imgShouldFail.
      const isCors = this.crossOrigin === 'anonymous'
      void Promise.resolve().then(() => {
        if (isCors && imgShouldFail) this.onerror?.(new Error('blocked'))
        else this.onload?.()
        return undefined
      })
    }
    get src() {
      return this._src
    }
  }
  global.fetch = async () => ({
    ok: fetchOk,
    status: fetchOk ? 200 : 403,
    blob: async () => ({ size: 1 }),
  })
  global.URL = {
    createObjectURL: () => 'blob:object-url',
    revokeObjectURL: (u) => revoked.push(u),
  }
  return Promise.resolve(run({ created, revoked })).finally(() => {
    global.Image = savedImage
    global.fetch = savedFetch
    global.URL = savedURL
  })
}

async function asyncTest(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

await asyncTest('loadCleanableImage cache-busts the CORS request for remote URLs', () =>
  withStubs({}, async ({ created }) => {
    const img = await loadCleanableImage('https://cdn.example.com/figure.png?alt=media')
    assert.equal(created.length, 1, 'expected one image load')
    assert.equal(img.crossOrigin, 'anonymous')
    assert.ok(/[?&]_cors=\d+/.test(img.src), 'expected a _cors cache-buster on the URL')
    assert.ok(img.src.startsWith('https://cdn.example.com/figure.png?alt=media&_cors='))
  }),
)

await asyncTest('loadCleanableImage loads blob:/data: URLs directly without CORS', () =>
  withStubs({}, async ({ created }) => {
    const img = await loadCleanableImage('data:image/png;base64,AAAA')
    assert.equal(created.length, 1)
    assert.equal(img.crossOrigin, null, 'same-origin source needs no CORS request')
    assert.equal(img.src, 'data:image/png;base64,AAAA', 'no cache-buster on data URLs')
  }),
)

await asyncTest('loadCleanableImage falls back to fetch→object-URL when the CORS load fails', () =>
  withStubs({ imgShouldFail: true, fetchOk: true }, async ({ created, revoked }) => {
    const img = await loadCleanableImage('https://cdn.example.com/figure.png')
    // First (CORS) attempt errors; second loads the same-origin object URL.
    assert.equal(created.length, 2)
    assert.equal(img.src, 'blob:object-url')
    assert.equal(img.crossOrigin, null)
    assert.deepEqual(revoked, ['blob:object-url'], 'object URL is revoked after use')
  }),
)

await asyncTest('loadCleanableImage surfaces a clear error when the fetch fallback also fails', () =>
  withStubs({ imgShouldFail: true, fetchOk: false }, async () => {
    await assert.rejects(
      loadCleanableImage('https://cdn.example.com/figure.png'),
      /Could not load the image to clean \(403\)/,
    )
  }),
)

console.log(`\n${passed} diagramClean assertions passed.`)
