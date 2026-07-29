/**
 * A figure's size and placement, in millimetres, decided once.
 *
 * ## Why millimetres and not a percentage
 *
 * `imageWidth` has always been a preset resolved to a PERCENTAGE of the column
 * (`imageWidth.js`), which is fine while all three renderers share a column
 * width — and they do not. The print window's column is the A4 content box; the
 * preview's is whatever the studio panel is; Word's is the section width minus
 * its own margins. Fifty percent of three different columns is three different
 * figures, and a teacher who sized a diagram to fit beside a question found it
 * bigger in the download.
 *
 * So the percentage is resolved against the DOCUMENT's column — which the layout
 * tokens own — into a physical width, and every renderer is handed millimetres.
 * The preview converts to CSS pixels, the print window to millimetres directly,
 * Word to EMU. All three draw the same figure.
 *
 * ## Word enlarging figures
 *
 * `docx`'s ImageRun takes pixels and converts at 9525 EMU each, so an image
 * embedded at its natural pixel size prints at 96dpi — a 900px-wide diagram
 * becomes 238mm and Word scales it to the page, which is the "diagram is huge in
 * Word" report. The fix is that the embed box is always the RESOLVED box from
 * this module, never the source's natural size; `embedBox` in figureSizing.js
 * then fits the natural image inside it without upscaling.
 *
 * ## What is deliberately not here
 *
 * The band's minimum figure size, and the never-upscale rule, stay in
 * `figureSizing.js`. That module is the §4.2 floor and it is tested against the
 * golden `.docx`; this one resolves the teacher's PREFERENCE and then hands the
 * result to it. Two modules, two decisions, in the order they are made.
 */

import { resolveImageWidthPercent, normaliseImageWidth, DEFAULT_IMAGE_WIDTH } from './imageWidth.js'
import { minFigureMm } from './figureSizing.js'
import { mmToPx, mmToEmu, FIGURE_WIDTH_PRESETS, FIGURE_ALIGNMENTS, FIGURE_MAX_HEIGHT_FRACTION } from '../config/paperLayoutTokens.js'

export const DEFAULT_FIGURE_ALIGNMENT = 'center'

export function normalizeFigureAlignment(value) {
  const v = String(value || '').trim().toLowerCase()
  return FIGURE_ALIGNMENTS.includes(v) ? v : DEFAULT_FIGURE_ALIGNMENT
}

/**
 * The figure settings stored on a question, normalised.
 *
 * Every field is optional and every default reproduces the behaviour papers had
 * before this module, so loading a saved paper cannot move a figure.
 */
export function normalizeFigureSpec(source = {}) {
  const width = source.figureWidthMm ?? source.imageWidthMm
  const explicitMm = Number(width)
  return {
    /** The preset key, kept for the editor's radio buttons. */
    preset: normaliseImageWidth(source.imageWidth ?? source.figureWidth, DEFAULT_IMAGE_WIDTH),
    /** A teacher-typed physical width overrides the preset when present. */
    widthMm: Number.isFinite(explicitMm) && explicitMm > 0 ? Math.min(400, explicitMm) : null,
    maxHeightMm: Number.isFinite(Number(source.figureMaxHeightMm)) && Number(source.figureMaxHeightMm) > 0
      ? Number(source.figureMaxHeightMm)
      : null,
    align: normalizeFigureAlignment(source.figureAlign),
    border: Boolean(source.figureBorder),
    /**
     * A figure is kept with its question unless the teacher says otherwise. The
     * default is the safe one: a diagram on the page after the question it
     * belongs to is a paper the learner cannot answer.
     */
    keepWithQuestion: source.figureKeepWithQuestion !== false,
  }
}

/**
 * Resolve a figure spec into physical dimensions for one document.
 *
 * @param {object} spec    normalizeFigureSpec output
 * @param {object} layout  resolvePaperLayout output — owns the column width
 * @param {object} opts    {band, aspect} the level's floor and the source ratio
 * @returns {{widthMm, heightMm, maxHeightMm, widthPx, heightPx, widthEmu,
 *   heightEmu, align, border, keepWithQuestion, raisedToFloor, floorMm}}
 */
export function resolveFigureBox(spec, layout, { band = null, aspect = 1.6 } = {}) {
  const columnMm = layout?.content?.widthMm ?? layout?.figure?.fullWidthMm ?? 174
  const pageHeightMm = layout?.page?.heightMm ?? 297
  const safeAspect = Number.isFinite(Number(aspect)) && Number(aspect) > 0 ? Number(aspect) : 1.6

  // The preset, as a fraction of the DOCUMENT's column — the whole point of the
  // module. `full` is the column, not a fixed 174mm, so a narrow-margin A5 paper
  // gets a full-width figure that is actually full width.
  const presetMm = spec?.preset && FIGURE_WIDTH_PRESETS[spec.preset]?.widthMm != null
    ? FIGURE_WIDTH_PRESETS[spec.preset].widthMm
    : (columnMm * resolveImageWidthPercent(spec?.preset)) / 100

  let widthMm = spec?.widthMm ?? presetMm
  // The column always wins. A figure wider than the text column is clipped at
  // the right edge in print and silently rescaled by Word, and those two
  // failures look different enough that nobody connects them to one cause.
  widthMm = Math.min(widthMm, columnMm)

  const capMm = Math.min(
    spec?.maxHeightMm ?? Number.POSITIVE_INFINITY,
    layout?.figure?.maxHeightMm ?? pageHeightMm * FIGURE_MAX_HEIGHT_FRACTION,
  )
  let heightMm = widthMm / safeAspect
  if (heightMm > capMm) {
    heightMm = capMm
    widthMm = heightMm * safeAspect
  }

  // The band's floor, applied to the smaller side, exactly as figureSizing does
  // it — and, exactly as there, the page still wins.
  const floorMm = minFigureMm(band)
  let raisedToFloor = false
  if (floorMm > 0 && Math.min(widthMm, heightMm) < floorMm) {
    raisedToFloor = true
    if (widthMm < heightMm) {
      widthMm = floorMm
      heightMm = widthMm / safeAspect
    } else {
      heightMm = floorMm
      widthMm = heightMm * safeAspect
    }
    if (widthMm > columnMm) {
      widthMm = columnMm
      heightMm = widthMm / safeAspect
    }
  }

  const round = (n) => Math.round(n * 100) / 100
  return {
    widthMm: round(widthMm),
    heightMm: round(heightMm),
    maxHeightMm: Number.isFinite(capMm) ? round(capMm) : null,
    widthPx: Math.round(mmToPx(widthMm)),
    heightPx: Math.round(mmToPx(heightMm)),
    widthEmu: mmToEmu(widthMm),
    heightEmu: mmToEmu(heightMm),
    /** The share of the column the figure occupies, for CSS that wants a %. */
    widthPercent: Math.max(1, Math.min(100, Math.round((widthMm / columnMm) * 100))),
    align: normalizeFigureAlignment(spec?.align),
    border: Boolean(spec?.border),
    keepWithQuestion: spec?.keepWithQuestion !== false,
    raisedToFloor,
    floorMm,
    /** True when the figure could not reach the level's floor. Advisory. */
    belowFloor: floorMm > 0 && Math.min(widthMm, heightMm) < floorMm - 0.5,
  }
}

/**
 * Is this figure too big for what is left of a page?
 *
 * Used by the validation report: a figure taller than the content box cannot be
 * placed anywhere without splitting, and no pagination rule can rescue it.
 */
export function figureOverflowsPage(box, layout) {
  const contentHeight = layout?.content?.heightMm ?? 0
  const contentWidth = layout?.content?.widthMm ?? 0
  if (!box || !contentHeight || !contentWidth) return false
  return box.heightMm > contentHeight || box.widthMm > contentWidth + 0.5
}
