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
