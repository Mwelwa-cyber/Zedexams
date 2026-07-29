/**
 * objectArtRaster — turns the line-art object library (§4.7) into PNG bytes a
 * Word export can embed.
 *
 * `docx`'s ImageRun needs raw bytes, and the object art is SVG markup. This is
 * the browser-only bridge: `downloadLessonPlanDocx` pre-rasterises the objects a
 * plan actually uses, in the same async pre-pass that already fetches lesson
 * illustrations, so the synchronous document builder stays synchronous and
 * unit-testable.
 *
 * It fails SOFT and says so. Outside a browser (the plain-node export tests), or
 * when a canvas read is blocked, it returns an empty map — and the Word matching
 * block then prints the object WORDS in their boxes. The exercise survives,
 * plainer; it never exports as an empty grid, and it never blocks the download.
 */

import { objectArtSvg, parseCellBlocks } from './lessonPlanBlocks.js'

// Rendered at 4× the printed size so the picture is ~300 dpi on paper rather
// than a resampled 96 dpi bitmap. `width`/`height` below are what Word draws
// (pixels — docx converts at 9525 EMU/px), not what was rasterised.
const RASTER_SCALE = 4
const PRINT_PX = 42 // ≈ 11 mm at 96 dpi, matching objectArtSvg's default size

/** The object names a plan's parsed cell blocks actually use. */
export function objectNamesInPlan(plan) {
  const names = new Set()
  const cells = []
  for (const stage of (plan?.stages || [])) {
    cells.push(stage?.teacherActivities ?? stage?.teacher)
    cells.push(stage?.learnerActivities ?? stage?.pupils)
    cells.push(stage?.assessmentCriteria ?? stage?.assessment)
    cells.push(stage?.learningPoint)
  }
  for (const cell of cells) {
    for (const node of parseCellBlocks(cell)) {
      if (node.type !== 'match') continue
      for (const pair of node.pairs) {
        names.add(pair.left)
        names.add(pair.right)
      }
    }
  }
  return [...names]
}

/**
 * Rasterise the named objects to PNG bytes.
 *
 * @param {string[]} names
 * @returns {Promise<Record<string, { bytes: Uint8Array, type: 'png', width: number, height: number }>>}
 *   An empty object when rasterising is unavailable — never a rejection.
 */
export async function rasterizeObjectArt(names) {
  const wanted = [...new Set((names || []).map((n) => String(n || '').trim().toLowerCase()))].filter(Boolean)
  if (wanted.length === 0) return {}
  if (typeof document === 'undefined' || typeof Image === 'undefined') return {}

  const out = {}
  for (const name of wanted) {
    try {
      const bytes = await rasterizeOne(name)
      if (bytes) out[name] = { bytes, type: 'png', width: PRINT_PX, height: PRINT_PX }
    } catch {
      // One object failing must not cost the others their pictures.
    }
  }
  return out
}

async function rasterizeOne(name) {
  const svg = objectArtSvg(name, { sizeMm: 11, stroke: '#000000' })
  if (!svg) return null
  const size = PRINT_PX * RASTER_SCALE
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // White ground: a transparent PNG in Word picks up whatever is behind it,
    // and these prints are read in black and white.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    return await canvasToBytes(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('object art failed to load'))
    img.src = url
  })
}

async function canvasToBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}
