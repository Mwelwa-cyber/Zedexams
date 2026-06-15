// imageEnhance — document-scanner style image clean-up for captured diagrams.
//
// Teachers photograph diagrams, handwritten drawings, graphs, maps and
// tables with a phone and the raw shot is usually too dark, shadowed,
// low-contrast and soft to print well. This module runs a CamScanner-style
// enhancement entirely in the browser (canvas + typed-array maths), so it
// works offline and needs no extra Cloud Function or ML model:
//
//   • shadow / uneven-lighting removal + background whitening
//     (divide each pixel by a heavily-blurred background estimate)
//   • auto levels — percentile contrast stretch (brightness + contrast)
//   • unsharp mask — sharpen lines and clean soft / blurry edges
//   • optional clean black-and-white for crisp printing
//
// The pixel maths is split into PURE functions that take a plain
// `{ data, width, height }` object (data = Uint8ClampedArray | number[]),
// so they're unit-tested under plain Node (no canvas). The browser-only glue
// (load a File → ImageData, run the pipeline, hand back a Blob) lives at the
// bottom and is never imported by the Node test suite.

/* ------------------------------------------------------------------ *
 * Pure pixel maths (Node-testable — no DOM / canvas)
 * ------------------------------------------------------------------ */

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Luma (Rec. 601) for pixel `i*4` in an RGBA buffer. */
function lumaAt(data, p) {
  return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
}

/**
 * Separable box blur of a single-channel Float array. Radius is in pixels;
 * uses a sliding-window running sum so cost is O(width*height) regardless of
 * radius — important because the shadow estimate uses a very large radius.
 */
export function boxBlurChannel(src, width, height, radius) {
  const r = Math.max(0, Math.floor(radius))
  if (r === 0) return src.slice()
  const tmp = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  const win = r * 2 + 1
  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(width - 1, Math.max(0, x))]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / win
      const add = src[row + Math.min(width - 1, x + r + 1)]
      const sub = src[row + Math.max(0, x - r)]
      sum += add - sub
    }
  }
  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / win
      const add = tmp[Math.min(height - 1, y + r + 1) * width + x]
      const sub = tmp[Math.max(0, y - r) * width + x]
      sum += add - sub
    }
  }
  return out
}

/**
 * Remove shadows / uneven lighting and whiten the background by dividing the
 * image by a heavily blurred estimate of its own background, then scaling so
 * the paper reads as white. `strength` (0–1) blends the effect with the
 * original so labels and ink don't get crushed.
 */
export function removeShadows({ data, width, height }, strength = 0.85) {
  const n = width * height
  const luma = new Float32Array(n)
  for (let i = 0; i < n; i++) luma[i] = lumaAt(data, i * 4)
  // Background = large-radius blur (≈ 1/6 of the long edge, min 8px).
  const radius = Math.max(8, Math.round(Math.max(width, height) / 6))
  const bg = boxBlurChannel(luma, width, height, radius)
  const out = new Uint8ClampedArray(data.length)
  const s = Math.min(1, Math.max(0, strength))
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const b = bg[i] < 1 ? 1 : bg[i]
    const gain = 255 / b // maps the local background level up to white
    for (let c = 0; c < 3; c++) {
      const enhanced = clamp8(data[p + c] * gain)
      out[p + c] = clamp8(data[p + c] * (1 - s) + enhanced * s)
    }
    out[p + 3] = data[p + 3]
  }
  return { data: out, width, height }
}

/**
 * Auto levels: stretch each channel between its low/high percentiles so the
 * darkest ink goes near-black and the lightest paper goes near-white. This is
 * the brightness + contrast lift.
 */
export function autoLevels({ data, width, height }, lowPct = 0.02, highPct = 0.99) {
  const n = width * height
  const out = new Uint8ClampedArray(data.length)
  for (let c = 0; c < 3; c++) {
    const hist = new Array(256).fill(0)
    for (let i = 0; i < n; i++) hist[data[i * 4 + c]]++
    const loCount = n * lowPct
    const hiCount = n * highPct
    let lo = 0
    let hi = 255
    let acc = 0
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loCount) { lo = v; break } }
    acc = 0
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiCount) { hi = v; break } }
    const range = hi - lo || 1
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) lut[v] = clamp8(((v - lo) / range) * 255)
    for (let i = 0; i < n; i++) out[i * 4 + c] = lut[data[i * 4 + c]]
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = data[i * 4 + 3]
  return { data: out, width, height }
}

/**
 * Unsharp mask — sharpen edges and recover detail lost to a soft photo.
 * out = original + amount * (original - blurred).
 */
export function unsharpMask({ data, width, height }, amount = 0.8, radius = 1) {
  const n = width * height
  const out = new Uint8ClampedArray(data.length)
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = data[i * 4 + c]
    const blur = boxBlurChannel(ch, width, height, radius)
    for (let i = 0; i < n; i++) {
      out[i * 4 + c] = clamp8(ch[i] + amount * (ch[i] - blur[i]))
    }
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = data[i * 4 + 3]
  return { data: out, width, height }
}

/** Per-pixel brightness (−100..100) and contrast (−100..100) adjustment. */
export function adjustBrightnessContrast({ data, width, height }, brightness = 0, contrast = 0) {
  const n = width * height
  const out = new Uint8ClampedArray(data.length)
  const c = Math.max(-100, Math.min(100, contrast))
  const factor = (259 * (c + 255)) / (255 * (259 - c))
  const b = Math.max(-100, Math.min(100, brightness)) * 2.55
  for (let i = 0; i < n; i++) {
    const p = i * 4
    for (let k = 0; k < 3; k++) out[p + k] = clamp8(factor * (data[p + k] + b - 128) + 128)
    out[p + 3] = data[p + 3]
  }
  return { data: out, width, height }
}

/**
 * Adaptive-threshold to clean black-and-white. Each pixel is compared to its
 * local (blurred) neighbourhood, so it copes with uneven lighting far better
 * than a single global threshold — ideal for handwriting and line diagrams
 * destined for a printed paper.
 */
export function binarize({ data, width, height }, bias = 10) {
  const n = width * height
  const luma = new Float32Array(n)
  for (let i = 0; i < n; i++) luma[i] = lumaAt(data, i * 4)
  const radius = Math.max(4, Math.round(Math.max(width, height) / 40))
  const local = boxBlurChannel(luma, width, height, radius)
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const v = luma[i] < local[i] - bias ? 0 : 255
    out[p] = out[p + 1] = out[p + 2] = v
    out[p + 3] = data[p + 3]
  }
  return { data: out, width, height }
}

/**
 * Blur metric — variance of a Laplacian (edge) response over the luma
 * channel. Sharp images have high variance; blurry ones low. Used to warn the
 * teacher when a capture is too soft to keep.
 */
export function varianceOfLaplacian({ data, width, height }) {
  if (width < 3 || height < 3) return Infinity
  const n = width * height
  const luma = new Float32Array(n)
  for (let i = 0; i < n; i++) luma[i] = lumaAt(data, i * 4)
  let mean = 0
  const lap = new Float32Array(n)
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const v = luma[i - 1] + luma[i + 1] + luma[i - width] + luma[i + width] - 4 * luma[i]
      lap[i] = v
      mean += v
      count++
    }
  }
  mean /= count || 1
  let variance = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const d = lap[y * width + x] - mean
      variance += d * d
    }
  }
  return variance / (count || 1)
}

// Below this score a capture is considered too blurry to keep. Tuned on
// downscaled phone photos; exposed so the test suite can assert on it.
export const BLUR_SCORE_THRESHOLD = 60

export function isBlurry(score, threshold = BLUR_SCORE_THRESHOLD) {
  return Number.isFinite(score) && score < threshold
}

/**
 * The full enhancement pipeline as a pure transform. Composes shadow removal,
 * auto levels and sharpening; optionally finishes in clean black-and-white.
 * Returns a fresh `{ data, width, height }`.
 */
export function enhanceImageData(img, { blackAndWhite = false } = {}) {
  let out = removeShadows(img)
  out = autoLevels(out)
  out = unsharpMask(out)
  if (blackAndWhite) out = binarize(out)
  return out
}

/* ------------------------------------------------------------------ *
 * Browser-only glue (canvas) — not imported by the Node test suite.
 * ------------------------------------------------------------------ */

const MAX_PROCESS_EDGE = 1600 // cap the long edge so enhancement stays snappy

/** Load a File/Blob or URL into an HTMLImageElement. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const isBlob = typeof src !== 'string'
    const url = isBlob ? URL.createObjectURL(src) : src
    img.onload = () => { if (isBlob) URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { if (isBlob) URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
    img.src = url
  })
}

/** Draw an image (optionally downscaled) onto a canvas and return it. */
export function imageToCanvas(image, maxEdge = MAX_PROCESS_EDGE) {
  let { naturalWidth: w, naturalHeight: h } = image
  if (!w || !h) { w = image.width; h = image.height }
  const longEdge = Math.max(w, h)
  if (maxEdge && longEdge > maxEdge) {
    const scale = maxEdge / longEdge
    w = Math.round(w * scale)
    h = Math.round(h * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(image, 0, 0, w, h)
  return canvas
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality)
  })
}

/** Measure the blur score of a File/Blob (after downscaling for speed). */
export async function measureBlur(fileOrBlob) {
  const image = await loadImage(fileOrBlob)
  const canvas = imageToCanvas(image, 1000)
  const ctx = canvas.getContext('2d')
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return varianceOfLaplacian(data)
}

/**
 * Enhance a captured File/Blob and return a new JPEG Blob plus the blur score
 * of the ORIGINAL (so the caller can warn before the teacher commits).
 */
export async function enhanceImageFile(fileOrBlob, { blackAndWhite = false } = {}) {
  const image = await loadImage(fileOrBlob)
  const canvas = imageToCanvas(image)
  const ctx = canvas.getContext('2d')
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const blurScore = varianceOfLaplacian(src)
  const result = enhanceImageData(src, { blackAndWhite })
  ctx.putImageData(new ImageData(result.data, result.width, result.height), 0, 0)
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  return { blob, blurScore, width: canvas.width, height: canvas.height }
}

/** Wrap a Blob as a named File so it flows through the existing upload path. */
export function blobToFile(blob, name = `capture-${Date.now()}.jpg`) {
  try {
    return new File([blob], name, { type: blob.type || 'image/jpeg' })
  } catch {
    // Some older WebViews lack the File constructor — fake the needed bits.
    blob.name = name
    return blob
  }
}
