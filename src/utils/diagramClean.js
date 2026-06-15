/**
 * diagramClean — turn a photographed diagram into a clean, print-ready figure.
 *
 * Teachers photograph a textbook diagram, a hand-drawn shape, a map or a graph
 * with a phone. The raw photo has a grey/yellow page tint, a shadow gradient
 * across the sheet, low contrast, and a skewed crop full of desk background.
 * Printed or photocopied as-is it looks awful and wastes toner. This module
 * cleans it up so the figure is sharp black lines on a white background,
 * cropped to just the drawing, ready for a worksheet or exam paper.
 *
 * The pixel math is split into PURE functions that operate on plain
 * `{ data, width, height }` image buffers (RGBA, `data` is a Uint8ClampedArray
 * or a plain array). They have no DOM dependency, so they run — and are
 * unit-tested — under plain `node` (see diagramClean.test.js). The DOM-backed
 * wrappers at the bottom (canvas/Image based) are guarded so importing this
 * module never touches `document`; only calling a wrapper does.
 *
 * Cleaning pipeline (cleanPixels), in order:
 *   1. greyscale            — colour carries no signal in a line diagram.
 *   2. brightness/contrast  — teacher-tunable manual levels.
 *   3. whiten background    — stretch the light end so the page goes pure white
 *                             (removes the tint + flattens an even shadow).
 *   4. sharpen              — crisp up the lines and labels.
 *   5. black-and-white      — Otsu threshold to a 1-bit look that photocopies
 *                             cleanly (skipped when the teacher wants greyscale).
 *
 * computeContentBounds powers the auto-crop (find the drawing, drop the desk),
 * and rotateRGBA powers the straighten/rotate control.
 */

// ─── small helpers ───────────────────────────────────────────────────────────

/** Clamp a number into the 0–255 byte range and round it. */
export function clamp8(value) {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return Math.round(value)
}

/** Rec. 601 luma of an RGB triple — the standard greyscale weighting. */
export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Make a fresh RGBA buffer matching `data`'s type (typed array stays typed). */
function makeLike(data) {
  return typeof Uint8ClampedArray !== 'undefined' && data instanceof Uint8ClampedArray
    ? new Uint8ClampedArray(data.length)
    : new Array(data.length)
}

function assertImage(image) {
  if (!image || !image.data || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    throw new Error('diagramClean: expected an { data, width, height } image buffer')
  }
}

// ─── pure pixel operations ─────────────────────────────────────────────────────

/**
 * Convert to greyscale in place-free fashion: every pixel's R=G=B is set to its
 * luma, alpha preserved. Returns a new image buffer of the same shape.
 */
export function toGreyscale(image) {
  assertImage(image)
  const { data, width, height } = image
  const out = makeLike(data)
  for (let i = 0; i < data.length; i += 4) {
    const g = clamp8(luma(data[i], data[i + 1], data[i + 2]))
    out[i] = g
    out[i + 1] = g
    out[i + 2] = g
    out[i + 3] = data[i + 3]
  }
  return { data: out, width, height }
}

/**
 * Apply photographic brightness + contrast. `brightness` and `contrast` are
 * teacher-facing -100..100 sliders (0 = no change). Returns a new buffer.
 */
export function applyBrightnessContrast(image, { brightness = 0, contrast = 0 } = {}) {
  assertImage(image)
  const { data, width, height } = image
  const out = makeLike(data)
  // Map the -100..100 sliders onto the classic contrast factor.
  const b = (brightness / 100) * 255
  const c = (contrast / 100) * 255
  const factor = (259 * (c + 255)) / (255 * (259 - c))
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k += 1) {
      out[i + k] = clamp8(factor * (data[i + k] + b - 128) + 128)
    }
    out[i + 3] = data[i + 3]
  }
  return { data: out, width, height }
}

/**
 * 256-bin luma histogram of an image (treats it as greyscale via luma so it
 * works on a colour buffer too). Returns an Int32Array-like count array.
 */
export function lumaHistogram(image) {
  assertImage(image)
  const { data } = image
  const hist = new Array(256).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    hist[clamp8(luma(data[i], data[i + 1], data[i + 2]))] += 1
  }
  return hist
}

/**
 * Otsu's method: pick the 0–255 threshold that best separates dark ink from the
 * light page by maximising between-class variance. Returns the threshold.
 */
export function otsuThreshold(image) {
  const hist = lumaHistogram(image)
  const total = hist.reduce((s, n) => s + n, 0)
  if (!total) return 128
  let sum = 0
  for (let t = 0; t < 256; t += 1) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 128
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/**
 * Whiten the background: stretch the luma so anything at or above `whitePoint`
 * (a 0–1 fraction of the brightest pixels) maps to pure white and everything
 * below `blackPoint` maps to black, linearly between. This flattens an even
 * page-shadow and removes a yellow/grey tint without nuking the ink. Returns a
 * new buffer.
 */
export function whitenBackground(image, { blackPoint = 0.04, whitePoint = 0.82 } = {}) {
  assertImage(image)
  const { data, width, height } = image
  const hist = lumaHistogram(image)
  const total = hist.reduce((s, n) => s + n, 0) || 1
  // Find the luma values at the black/white percentile cut-offs.
  let lo = 0
  let hi = 255
  let acc = 0
  for (let t = 0; t < 256; t += 1) {
    acc += hist[t]
    if (acc / total >= blackPoint) { lo = t; break }
  }
  acc = 0
  for (let t = 0; t < 256; t += 1) {
    acc += hist[t]
    if (acc / total >= whitePoint) { hi = t; break }
  }
  if (hi <= lo) { lo = 0; hi = 255 }
  const span = hi - lo
  const out = makeLike(data)
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k += 1) {
      out[i + k] = clamp8(((data[i + k] - lo) / span) * 255)
    }
    out[i + 3] = data[i + 3]
  }
  return { data: out, width, height }
}

/**
 * Sharpen lines + labels with a 3×3 unsharp kernel. `amount` 0 = no change,
 * 1 = a firm sharpen. Edges clamp to the nearest in-bounds pixel. Returns a new
 * buffer. (Operates per channel; on a greyscale buffer that's effectively luma.)
 */
export function sharpen(image, amount = 0.6) {
  assertImage(image)
  const { data, width, height } = image
  if (amount <= 0) return { data: cloneData(image), width, height }
  const out = makeLike(data)
  const center = 1 + 4 * amount
  const side = -amount
  const at = (x, y) => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y
    return (cy * width + cx) * 4
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4
      for (let k = 0; k < 3; k += 1) {
        const v =
          center * data[at(x, y) + k] +
          side * data[at(x - 1, y) + k] +
          side * data[at(x + 1, y) + k] +
          side * data[at(x, y - 1) + k] +
          side * data[at(x, y + 1) + k]
        out[o + k] = clamp8(v)
      }
      out[o + 3] = data[o + 3]
    }
  }
  return { data: out, width, height }
}

/**
 * Threshold to pure black-and-white at `threshold` (defaults to the Otsu
 * value). Pixels darker than the threshold become black ink, the rest pure
 * white. Alpha preserved. This is the "clean photocopy" look. Returns a new
 * buffer.
 */
export function binarize(image, threshold = null) {
  assertImage(image)
  const { data, width, height } = image
  const t = threshold == null ? otsuThreshold(image) : threshold
  const out = makeLike(data)
  for (let i = 0; i < data.length; i += 4) {
    // Ink is luma AT OR BELOW the threshold → black; the page → white. Otsu
    // returns the top of the dark cluster, so `<=` keeps those pixels as ink.
    const v = luma(data[i], data[i + 1], data[i + 2]) <= t ? 0 : 255
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = data[i + 3]
  }
  return { data: out, width, height }
}

/**
 * Rotate the image by 90° steps. `turns` is normalised mod 4 (1 = clockwise
 * quarter turn). Dimensions swap for odd turns. Returns a new buffer with its
 * new width/height. Used by the straighten/rotate control.
 */
export function rotateRGBA(image, turns = 1) {
  assertImage(image)
  const { data, width, height } = image
  const t = ((Math.round(turns) % 4) + 4) % 4
  if (t === 0) return { data: cloneData(image), width, height }
  const swap = t === 1 || t === 3
  const outW = swap ? height : width
  const outH = swap ? width : height
  const out = makeLike(data)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4
      let nx
      let ny
      if (t === 1) { nx = height - 1 - y; ny = x }
      else if (t === 2) { nx = width - 1 - x; ny = height - 1 - y }
      else { nx = y; ny = width - 1 - x }
      const dst = (ny * outW + nx) * 4
      out[dst] = data[src]
      out[dst + 1] = data[src + 1]
      out[dst + 2] = data[src + 2]
      out[dst + 3] = data[src + 3]
    }
  }
  return { data: out, width: outW, height: outH }
}

function cloneData(image) {
  const out = makeLike(image.data)
  for (let i = 0; i < image.data.length; i += 1) out[i] = image.data[i]
  return out
}

/**
 * Find the bounding box of the dark "content" pixels (the drawing) so the
 * caller can crop away the surrounding desk/margin. A pixel counts as content
 * when its luma is below `threshold`. `padding` is a fraction of the larger
 * image dimension added around the box so labels right at the edge survive.
 *
 * Returns `{ x, y, width, height, empty }` in pixels. `empty` is true when no
 * content was found (a blank scan) — the caller should then keep the full image.
 */
export function computeContentBounds(image, { threshold = 200, padding = 0.02 } = {}) {
  assertImage(image)
  const { data, width, height } = image
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 8) continue // transparent — not content
      if (luma(data[i], data[i + 1], data[i + 2]) < threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    return { x: 0, y: 0, width, height, empty: true }
  }
  const pad = Math.round(Math.max(width, height) * Math.max(0, padding))
  const x = Math.max(0, minX - pad)
  const y = Math.max(0, minY - pad)
  const right = Math.min(width, maxX + 1 + pad)
  const bottom = Math.min(height, maxY + 1 + pad)
  return { x, y, width: right - x, height: bottom - y, empty: false }
}

/**
 * The full cleaning pipeline as a pure transform over an image buffer. See the
 * module header for the step order. Returns a new `{ data, width, height }`.
 *
 * options:
 *   brightness    -100..100 manual brightness (default 0)
 *   contrast      -100..100 manual contrast   (default 0)
 *   whiten        whiten/flatten the background           (default true)
 *   sharpenAmount unsharp strength, 0 disables            (default 0.6)
 *   blackAndWhite Otsu threshold to 1-bit black & white   (default true)
 *   threshold     fixed B&W threshold, or null for Otsu   (default null)
 */
export function cleanPixels(image, options = {}) {
  assertImage(image)
  const {
    brightness = 0,
    contrast = 0,
    whiten = true,
    sharpenAmount = 0.6,
    blackAndWhite = true,
    threshold = null,
  } = options

  let work = toGreyscale(image)
  if (brightness !== 0 || contrast !== 0) {
    work = applyBrightnessContrast(work, { brightness, contrast })
  }
  if (whiten) work = whitenBackground(work)
  if (sharpenAmount > 0) work = sharpen(work, sharpenAmount)
  if (blackAndWhite) work = binarize(work, threshold)
  return work
}

// ─── DOM-backed wrappers (browser only) ────────────────────────────────────────

/** True when the canvas-based wrappers can run (i.e. we're in a browser). */
export function isDiagramCleanSupported() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/** Load an <img> from a URL/data URL and resolve once decoded. */
export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the image to clean.'))
    img.src = src
  })
}

/**
 * Draw an <img>/canvas onto a fresh canvas (optionally rotated by 90° steps and
 * downscaled to `maxWidth`) and return its ImageData. Browser only.
 */
export function drawToImageData(source, { maxWidth = 1600, rotateTurns = 0 } = {}) {
  const sw = source.naturalWidth || source.width
  const sh = source.naturalHeight || source.height
  const turns = ((Math.round(rotateTurns) % 4) + 4) % 4
  const swap = turns === 1 || turns === 3
  const baseW = swap ? sh : sw
  const baseH = swap ? sw : sh
  const scale = Math.min(1, maxWidth / baseW)
  const outW = Math.max(1, Math.round(baseW * scale))
  const outH = Math.max(1, Math.round(baseH * scale))
  const canvas = makeCanvas(outW, outH)
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.save()
  ctx.translate(outW / 2, outH / 2)
  ctx.rotate((turns * Math.PI) / 2)
  const drawW = swap ? outH : outW
  const drawH = swap ? outW : outH
  ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()
  return ctx.getImageData(0, 0, outW, outH)
}

/** Paint an `{ data, width, height }` buffer onto a canvas. Browser only. */
export function imageDataToCanvas(image) {
  const canvas = makeCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d', { alpha: false })
  const data = image.data instanceof Uint8ClampedArray
    ? image.data
    : Uint8ClampedArray.from(image.data)
  ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0)
  return canvas
}

function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the cleaned diagram.'))),
      type,
      quality,
    )
  })
}

/**
 * Full clean of an image SOURCE (URL/data URL/HTMLImageElement) → a cleaned
 * raster. Loads it, optionally auto-crops to the drawing, rotates, runs
 * cleanPixels, and returns `{ dataUrl, blob, width, height, bounds }`. Browser
 * only — throws (caught by callers) where there's no canvas.
 *
 * options adds, on top of cleanPixels options:
 *   maxWidth     downscale ceiling                          (default 1600)
 *   rotateTurns  90° steps to rotate first (straighten)     (default 0)
 *   autoCrop     crop to the detected drawing               (default true)
 *   crop         explicit { x, y, width, height } in pixels (overrides autoCrop)
 *   mimeType     'image/png' (B&W) or 'image/jpeg'          (default png)
 */
export async function cleanDiagramSource(src, options = {}) {
  if (!isDiagramCleanSupported()) {
    throw new Error('Diagram cleaning needs a browser canvas.')
  }
  const {
    maxWidth = 1600,
    rotateTurns = 0,
    autoCrop = true,
    crop = null,
    mimeType = 'image/png',
    ...pixelOptions
  } = options

  const img = typeof src === 'string' ? await loadImageElement(src) : src
  let image = drawToImageData(img, { maxWidth, rotateTurns })

  // Crop: explicit box wins; otherwise auto-detect the drawing.
  let bounds = { x: 0, y: 0, width: image.width, height: image.height, empty: false }
  const box = crop || (autoCrop ? computeContentBounds(image) : null)
  if (box && !box.empty && (box.width < image.width || box.height < image.height)) {
    image = cropImageData(image, box)
    bounds = box
  }

  const cleaned = cleanPixels(image, pixelOptions)
  const canvas = imageDataToCanvas(cleaned)
  const blob = await canvasToBlob(canvas, mimeType)
  return {
    dataUrl: canvas.toDataURL(mimeType),
    blob,
    width: cleaned.width,
    height: cleaned.height,
    bounds,
  }
}

/** Crop an `{ data, width, height }` buffer to a pixel box. Pure. */
export function cropImageData(image, box) {
  assertImage(image)
  const { data, width } = image
  const x = Math.max(0, Math.min(image.width - 1, Math.round(box.x)))
  const y = Math.max(0, Math.min(image.height - 1, Math.round(box.y)))
  const w = Math.max(1, Math.min(image.width - x, Math.round(box.width)))
  const h = Math.max(1, Math.min(image.height - y, Math.round(box.height)))
  const out = typeof Uint8ClampedArray !== 'undefined' && data instanceof Uint8ClampedArray
    ? new Uint8ClampedArray(w * h * 4)
    : new Array(w * h * 4)
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      const src = ((y + row) * width + (x + col)) * 4
      const dst = (row * w + col) * 4
      out[dst] = data[src]
      out[dst + 1] = data[src + 1]
      out[dst + 2] = data[src + 2]
      out[dst + 3] = data[src + 3]
    }
  }
  return { data: out, width: w, height: h }
}
