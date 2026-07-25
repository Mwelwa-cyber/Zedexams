/**
 * figureSizing — how big a figure must be on the page (§4.2).
 *
 * The brief: *"Enforce a minimum rendered size per band."* Phase 2 gave every
 * band a `minFigureSizeMm` — 45mm at Early Childhood down to 30mm at senior
 * secondary — and then nothing applied it. It was rendered into the generator's
 * prompt (so the model was *told* about it) and ignored by every renderer, which
 * means a Nursery picture-matching question could print at whatever size the
 * teacher's width preset produced. A five-year-old cannot answer a question
 * about a picture they cannot make out.
 *
 * So the band's minimum is a FLOOR the width preset may not go under. A teacher
 * who picks "Small" on a Form 4 diagram gets a small diagram; the same choice on
 * a Nursery worksheet is raised to the level's floor, because at that level the
 * size is a pedagogical requirement rather than a layout preference.
 *
 * Units. The band declares millimetres — what a teacher can hold a ruler
 * against. Everything downstream works in CSS PIXELS (96 per inch), because
 * that is what both consumers take: the rasteriser draws a canvas of that many
 * pixels, and `docx`'s ImageRun converts its width/height straight to EMU at
 * 9525 per pixel. Treating that box as points instead — 72 per inch — silently
 * under-applies the floor by a third, which is exactly the bug the golden file
 * caught: a "45mm" Nursery figure embedding at 34mm.
 *
 * `mmToPt` is kept for anything that genuinely wants typographic points.
 *
 * Pure: no DOM, no Firebase. The band is passed in.
 */

/** CSS pixels per inch — the constant every browser lays out against. */
const PX_PER_INCH = 96
/** Points per inch — Word's unit. */
const PT_PER_INCH = 72
const MM_PER_INCH = 25.4

/**
 * Rasterisation multiplier for figures embedded in Word (§4.2: "a high-DPI
 * raster fallback generated for DOCX").
 *
 * The embed box is in 96dpi CSS pixels; a printer works at 300dpi. Rendering at
 * 4× lands at ~384dpi of source detail behind the embedded box, which survives
 * printing without the fuzzy edges 2× gave on a laser printer. Higher would only
 * grow the .docx for detail no printer resolves.
 */
export const FIGURE_RASTER_SCALE = 4

/** Millimetres → CSS pixels. */
export function mmToPx(mm) {
  const n = Number(mm)
  if (!Number.isFinite(n) || n <= 0) return 0
  return (n / MM_PER_INCH) * PX_PER_INCH
}

/** Millimetres → points (the docx unit). */
export function mmToPt(mm) {
  const n = Number(mm)
  if (!Number.isFinite(n) || n <= 0) return 0
  return (n / MM_PER_INCH) * PT_PER_INCH
}

/** Points → millimetres. */
export function ptToMm(pt) {
  const n = Number(pt)
  if (!Number.isFinite(n) || n <= 0) return 0
  return (n / PT_PER_INCH) * MM_PER_INCH
}

/** CSS pixels → millimetres, for reporting a size back in the band's own unit. */
export function pxToMm(px) {
  const n = Number(px)
  if (!Number.isFinite(n) || n <= 0) return 0
  return (n / PX_PER_INCH) * MM_PER_INCH
}

/**
 * The band's minimum figure size in millimetres, or 0 when the band is unknown.
 *
 * 0 means "no floor" rather than "no figures": an unrecognised level must not
 * make figures unprintable, it just has no stage-specific requirement to apply.
 */
export function minFigureMm(band) {
  const mm = Number(band && band.minFigureSizeMm)
  return Number.isFinite(mm) && mm > 0 ? mm : 0
}

/**
 * Work out the box a figure is rendered into.
 *
 * @param {object} args
 * @param {number} args.maxWidth   the layout's full-width box, in CSS pixels
 * @param {number} args.maxHeight  the layout's height cap, in CSS pixels
 * @param {number} [args.aspect]   width ÷ height of the source (default 1.6)
 * @param {number} [args.widthPercent] the teacher's width preset, 1-100
 * @param {object} [args.band]     the resolved band, for its minimum
 * @returns {{width: number, height: number, raisedToFloor: boolean,
 *   floorPx: number, rasterWidth: number, rasterHeight: number}}
 *   every size in CSS pixels — the unit both the rasteriser and docx take
 */
export function figureBox({
  maxWidth = 360, maxHeight = 220, aspect = 1.6, widthPercent = 100, band = null,
}) {
  const safeAspect = Number.isFinite(Number(aspect)) && Number(aspect) > 0
    ? Number(aspect) : 1.6
  const pct = Number.isFinite(Number(widthPercent)) && Number(widthPercent) > 0
    ? Math.min(100, Number(widthPercent)) / 100
    : 1

  // Start from the teacher's choice, then fit inside the height cap.
  let width = maxWidth * pct
  let height = width / safeAspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * safeAspect
  }

  // The band's floor applies to the SMALLER side: a wide, short diagram whose
  // height fell under the minimum is just as unreadable as a narrow one, and the
  // band's number is about how big the thing is on the page, not how wide.
  const floorPx = mmToPx(minFigureMm(band))
  let raisedToFloor = false
  if (floorPx > 0 && Math.min(width, height) < floorPx) {
    raisedToFloor = true
    if (width < height) {
      width = floorPx
      height = width / safeAspect
    } else {
      height = floorPx
      width = height * safeAspect
    }
    // Raising to the floor must never push the figure off the page. The page
    // wins — a figure wider than the text column is a worse failure than one
    // slightly under the recommended size, and the studio surfaces the shortfall
    // rather than silently overflowing.
    if (width > maxWidth) {
      width = maxWidth
      height = width / safeAspect
    }
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    raisedToFloor,
    floorPx: Math.round(floorPx),
    rasterWidth: Math.round(width * FIGURE_RASTER_SCALE),
    rasterHeight: Math.round(height * FIGURE_RASTER_SCALE),
  }
}

/**
 * Does this box still fall short of the level's requirement?
 *
 * True only when the page could not accommodate the floor — the one case
 * `figureBox` cannot fix on its own, and therefore the one worth telling a
 * teacher about rather than silently accepting.
 */
export function isBelowBandMinimum(box, band) {
  const floorPx = mmToPx(minFigureMm(band))
  if (floorPx <= 0 || !box) return false
  return Math.min(box.width, box.height) < floorPx - 1
}

/**
 * A plain-language note for a figure that could not reach its level's minimum.
 * '' when there is nothing to say.
 */
export function figureSizeWarning(box, band, label = 'A figure') {
  if (!isBelowBandMinimum(box, band)) return ''
  const want = Math.round(minFigureMm(band))
  const got = Math.round(pxToMm(Math.min(box.width, box.height)))
  return (
    `${label} prints about ${got}mm across. At this level pictures should be at ` +
    `least ${want}mm so learners can make out the detail — try a wider page ` +
    'layout or a simpler picture.'
  )
}
