// svgRasterizer — turn an SVG string into a PNG in the browser via a canvas.
//
// Shared by the PowerPoint importer (slide rasterization) and the assessment
// DOCX export (library diagrams → embeddable PNG). Browser-only: the canvas +
// Image APIs don't exist in Node, so callers in a non-browser context must
// guard (the DOCX exporter falls back to alt text when this throws).
//
// Why rasterize at all? PNGs cannot carry script, and the Word `docx`
// ImageRun embeds raster bytes, not SVG. Canvas draws on a white background so
// transparent diagrams print cleanly.

/**
 * Rasterize an SVG string to a PNG Blob at the given pixel size.
 * @param {string} svg - a complete <svg>…</svg> document
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Blob>}
 */
export async function svgToPngBlob(svg, width, height) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('SVG rasterization requires a browser environment.')
  }
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Browser could not rasterize the SVG.'))
      img.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas could not produce a PNG.'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// ── the rasteriser seam ───────────────────────────────────────────────────
//
// One narrow injection point, and it exists for a specific reason: the DOCX
// exporter is the code worth testing, and it could not be tested end to end
// because this module needs a canvas. Under Node the raster threw, the exporter
// caught it, and every library diagram was left out of the Word file — so the
// only test that could reach the real export path was testing a paper with no
// figures in it.
//
// The alternative was a native canvas dependency, which would put a compiled
// module in CI to satisfy a test rather than to serve the app. Instead the
// visual harness supplies a Chromium-backed rasteriser (it already runs a real
// browser) and the SHIPPING exporter stays the thing under test, unmodified.
//
// The application never touches this: with nothing injected, `svgToPngBytes`
// takes the ordinary browser path. That is what keeps the seam honest — a passing
// harness proves the exporter's real code works, not that a stub works.
let injectedRasterizer = null

/**
 * Install a rasteriser for a non-browser context. Test/harness use only.
 * @param {(svg: string, width: number, height: number) => Promise<Uint8Array>} fn
 */
export function setSvgRasterizer(fn) {
  if (fn != null && typeof fn !== 'function') throw new TypeError('a rasteriser must be a function')
  injectedRasterizer = fn || null
}

/** Restore the browser path. */
export function resetSvgRasterizer() {
  injectedRasterizer = null
}

/** Is a rasteriser injected? Used by the harness to assert its own wiring. */
export function hasInjectedRasterizer() {
  return Boolean(injectedRasterizer)
}

// ── the decoder seam ──────────────────────────────────────────────────────
//
// The rasteriser seam above closed half the gap. This closes the other half,
// and the half that was still silently wrong.
//
// `assessmentToDocx.decodeImage` needs a real browser: it builds an object URL
// and waits for `Image.onload`. jsdom provides `document` and `Image` but does
// not decode image bytes, so `onload` never fires — the exporter's own
// `catch` returned null and it fell back to the PLAIN image. The figure was
// still embedded, so nothing looked broken; what was dropped was the LABEL
// layer composited onto it. A §4.3 marking key came out byte-identical to the
// learner's copy, with no numbered markers on either.
//
// That is worse than the raster failure it sits beside: a missing figure is
// visible, a figure missing its labels is a paper that looks fine and asks the
// learner to name parts nothing points at.
//
// Same bargain as the rasteriser: the harness already runs Chromium, so it
// supplies real decoding and the SHIPPING exporter stays the thing under test.
// The application never touches this.
let injectedDecoder = null

/**
 * Install an image decoder for a non-browser context. Test/harness use only.
 *
 * Must return `{bytes, width, height}` — the same shape the browser path
 * produces — or null when the bytes are not a decodable image.
 * @param {(bytes: Uint8Array, mime: string) => Promise<{bytes: Uint8Array, width: number, height: number}|null>} fn
 */
export function setImageDecoder(fn) {
  if (fn != null && typeof fn !== 'function') throw new TypeError('a decoder must be a function')
  injectedDecoder = fn || null
}

/** Restore the browser path. */
export function resetImageDecoder() {
  injectedDecoder = null
}

/** Is a decoder injected? Used by the harness to assert its own wiring. */
export function hasInjectedDecoder() {
  return Boolean(injectedDecoder)
}

/**
 * Decode image bytes through an injected decoder, or return undefined to mean
 * "nothing is installed, take the browser path".
 *
 * `undefined` and `null` are deliberately different answers: null is a decoder
 * saying "these bytes are not an image I can read", which is a real verdict the
 * caller must not retry in a browser that is not there.
 */
export async function decodeImageBytes(bytes, mime) {
  if (!injectedDecoder) return undefined
  const decoded = await injectedDecoder(bytes, mime)
  if (decoded == null) return null
  // Checked rather than trusted, for the same reason the rasteriser's output is:
  // a decoder returning a plausible-looking object with no dimensions would
  // produce a zero-sized composite, and a zero-sized image in Word is a blank
  // box — the failure this seam exists to stop being silent.
  const { width, height } = decoded
  if (!(decoded.bytes instanceof Uint8Array) || !decoded.bytes.length) {
    throw new Error('the injected decoder did not return image bytes')
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`the injected decoder returned no usable size (${width}×${height})`)
  }
  return { bytes: decoded.bytes, width, height }
}

/**
 * Rasterize an SVG string to PNG bytes (Uint8Array) — convenience for the DOCX
 * `ImageRun`, which takes raw bytes rather than a Blob.
 */
export async function svgToPngBytes(svg, width, height) {
  if (injectedRasterizer) {
    const bytes = await injectedRasterizer(svg, width, height)
    // Checked rather than trusted: an injected rasteriser returning something
    // that is not PNG bytes would embed a corrupt image, and a corrupt image in
    // Word is a blank box — the failure this whole change exists to stop being
    // silent.
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new Error('the injected rasteriser did not return PNG bytes')
    }
    return bytes
  }
  const blob = await svgToPngBlob(svg, width, height)
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}
