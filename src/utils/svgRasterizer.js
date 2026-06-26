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

/**
 * Rasterize an SVG string to PNG bytes (Uint8Array) — convenience for the DOCX
 * `ImageRun`, which takes raw bytes rather than a Blob.
 */
export async function svgToPngBytes(svg, width, height) {
  const blob = await svgToPngBlob(svg, width, height)
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}
