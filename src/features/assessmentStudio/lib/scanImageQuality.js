// scanImageQuality — blur detection for the multi-page test scanner.
//
// A teacher photographing a test paper page-by-page often catches a frame
// before the camera focuses. We don't want to silently OCR a smudged page and
// hand back garbage questions, so each captured page gets a cheap sharpness
// score and a soft "looks blurry — retake?" warning. It is only ever a
// warning: the teacher can keep a page the heuristic flagged.
//
// The metric is the variance of the discrete Laplacian (a standard quick focus
// measure): a sharp page is full of crisp edges (high response variance), a
// blurry one is smooth (low variance). The pure math lives here so it can be
// unit-tested under plain `node`; the browser-only canvas wrapper guards on
// `document` so importing this module stays Node-safe.

// Below this Laplacian variance a downscaled grayscale page is treated as
// blurry. Tuned against typical phone photos of A4 exam papers downscaled to
// ~320px wide; document text produces variance well into the hundreds when in
// focus and collapses toward single digits when badly out of focus. Kept
// deliberately low so we only flag clearly soft pages, not merely soft-ish ones.
export const BLUR_VARIANCE_THRESHOLD = 28

// Width the page is downscaled to before scoring. Small enough to be instant,
// large enough that real text edges survive.
export const BLUR_SAMPLE_WIDTH = 320

export function isBlurry(variance) {
  return Number.isFinite(variance) && variance < BLUR_VARIANCE_THRESHOLD
}

// Variance of the 3x3 discrete Laplacian over the interior pixels of a
// single-channel (grayscale, 0-255) image. `gray` is a flat row-major array of
// length width*height. Returns 0 for degenerate sizes.
export function laplacianVariance(gray, width, height) {
  if (!gray || width < 3 || height < 3) return 0
  const responses = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      // Kernel [[0,1,0],[1,-4,1],[0,1,0]]
      const lap =
        gray[i - width] +
        gray[i + width] +
        gray[i - 1] +
        gray[i + 1] -
        4 * gray[i]
      responses.push(lap)
    }
  }
  if (!responses.length) return 0
  let sum = 0
  for (const r of responses) sum += r
  const mean = sum / responses.length
  let acc = 0
  for (const r of responses) {
    const d = r - mean
    acc += d * d
  }
  return acc / responses.length
}

// Convert an RGBA pixel buffer (Uint8ClampedArray from canvas getImageData) to a
// flat grayscale array using Rec. 601 luma weights.
export function rgbaToGray(data, width, height) {
  const gray = new Float32Array(width * height)
  for (let p = 0, g = 0; g < gray.length; p += 4, g += 1) {
    gray[g] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }
  return gray
}

// Browser-only: score an already-loaded HTMLImageElement / ImageBitmap / canvas
// source. Returns { variance, blurry }. Returns a non-blurry result if the
// canvas API is unavailable or the draw fails — quality scoring must never block
// a capture.
export async function measureImageBlur(source) {
  try {
    if (typeof document === 'undefined' || !source) {
      return { variance: Infinity, blurry: false }
    }
    const srcW = source.naturalWidth || source.width
    const srcH = source.naturalHeight || source.height
    if (!srcW || !srcH) return { variance: Infinity, blurry: false }
    const scale = Math.min(1, BLUR_SAMPLE_WIDTH / srcW)
    const w = Math.max(3, Math.round(srcW * scale))
    const h = Math.max(3, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { variance: Infinity, blurry: false }
    ctx.drawImage(source, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const gray = rgbaToGray(data, w, h)
    const variance = laplacianVariance(gray, w, h)
    return { variance, blurry: isBlurry(variance) }
  } catch {
    return { variance: Infinity, blurry: false }
  }
}

// Browser-only: score an image given as a data URL (used when re-scoring a page
// restored from the saved scan session). Resolves to the same shape.
export function measureBlurFromDataUrl(dataUrl) {
  return new Promise(resolve => {
    if (typeof Image === 'undefined' || !dataUrl) {
      resolve({ variance: Infinity, blurry: false })
      return
    }
    const img = new Image()
    img.onload = () => resolve(measureImageBlur(img))
    img.onerror = () => resolve({ variance: Infinity, blurry: false })
    img.src = dataUrl
  })
}
