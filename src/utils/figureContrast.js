/**
 * figureContrast — will this picture still say anything in black and white? (§4.2)
 *
 * `monochrome.js` checks the ink WE choose. This checks the ink we don't: the
 * pixels of a generated or uploaded figure. A diagram that tells its parts apart
 * by colour — a red artery beside a blue vein, a green stem against a brown
 * root — is perfectly clear on screen and prints as one undifferentiated grey.
 * The learner is then asked to name a part they cannot see.
 *
 * That is not a hypothetical for this market. Most Zambian schools print
 * monochrome, and two of the three image styles the studio offers ask the model
 * for colour outright.
 *
 * ## What is actually being measured
 *
 * Not "is this colourful" — a colourful figure whose colours differ in LIGHTNESS
 * survives greyscale perfectly well. The failure is narrower and worth naming
 * precisely: two regions that a reader must tell apart, which differ in hue but
 * NOT in luminance. Those are the ones the printer merges.
 *
 * So the summary counts, among a figure's prominent colours, the pairs that are
 * far apart in colour and close together in grey. One such pair covering a
 * meaningful share of the picture is enough to make it unreadable.
 *
 * A second, simpler failure is also checked: a figure with almost no luminance
 * range at all (a pale wash, or a photo of a grey object in grey light) has
 * nothing for a printer to work with regardless of hue.
 *
 * Pure: takes a colour census, not an image. The caller does the sampling —
 * which needs a canvas — so the judgement itself stays testable under plain
 * node with a handful of synthetic pixels.
 */

import { relativeLuminance, contrastRatio } from './monochrome.js'

/**
 * A pair of colours closer than this in printed grey will look like one tone.
 *
 * 1.2:1 is well below WCAG's lowest threshold on purpose: this is not asking
 * whether the two are comfortably distinguishable, it is asking whether they
 * have collapsed. Two greys at 1.2:1 differ by a few percent of luminance,
 * which a laser printer's halftone and a photocopier's contrast curve will
 * finish off.
 */
export const MERGE_RATIO = 1.2

/**
 * How different two colours must be to count as "a reader is meant to tell
 * these apart", as a distance in RGB (0–441). 60 is roughly the gap between
 * colours a person would give different names.
 */
export const DISTINCT_COLOUR_DISTANCE = 60

/**
 * A colour must cover at least this share of the figure to be judged. Below it,
 * a colour is an outline, an artefact or an anti-aliasing fringe — not a region
 * anybody is asked to identify.
 */
export const PROMINENT_SHARE = 0.04

/** Below this luminance spread there is not enough range to print anything. */
export const FLAT_LUMINANCE_RANGE = 0.12

/**
 * Reduce a pixel census to the numbers the verdict needs.
 *
 * @param {Array<{r:number,g:number,b:number,count:number}>} census
 *   quantised colours and how many pixels each covers. The caller decides the
 *   quantisation; anything from 4 to 6 bits per channel gives the same verdict.
 * @returns {{total:number, prominent:Array, luminanceRange:number,
 *   mergingPairs:Array, mergingShare:number}}
 */
export function summariseColours(census = []) {
  const rows = (Array.isArray(census) ? census : [])
    .map((c) => ({
      r: Math.max(0, Math.min(255, Math.round(Number(c?.r) || 0))),
      g: Math.max(0, Math.min(255, Math.round(Number(c?.g) || 0))),
      b: Math.max(0, Math.min(255, Math.round(Number(c?.b) || 0))),
      count: Math.max(0, Number(c?.count) || 0),
    }))
    .filter((c) => c.count > 0)

  const total = rows.reduce((sum, c) => sum + c.count, 0)
  if (!total) {
    return { total: 0, prominent: [], luminanceRange: 0, mergingPairs: [], mergingShare: 0 }
  }

  const withLuma = rows.map((c) => ({
    ...c,
    share: c.count / total,
    luminance: relativeLuminance(`rgb(${c.r},${c.g},${c.b})`) ?? 0,
    hex: `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`,
  }))

  const prominent = withLuma
    .filter((c) => c.share >= PROMINENT_SHARE)
    .sort((a, b) => b.share - a.share)

  // Range across the whole figure, not just the prominent colours: a dark
  // outline is what saves an otherwise flat picture.
  const lumas = withLuma.map((c) => c.luminance)
  const luminanceRange = Math.max(...lumas) - Math.min(...lumas)

  // Pairs a reader is meant to distinguish that the printer will merge.
  const mergingPairs = []
  for (let i = 0; i < prominent.length; i += 1) {
    for (let j = i + 1; j < prominent.length; j += 1) {
      const a = prominent[i]
      const b = prominent[j]
      const distance = Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
      if (distance < DISTINCT_COLOUR_DISTANCE) continue
      const ratio = contrastRatio(a.hex, b.hex) ?? 1
      if (ratio > MERGE_RATIO) continue
      mergingPairs.push({
        a: a.hex, b: b.hex, distance: Math.round(distance),
        ratio: Math.round(ratio * 100) / 100,
        share: a.share + b.share,
      })
    }
  }
  mergingPairs.sort((x, y) => y.share - x.share)

  return {
    total,
    prominent,
    luminanceRange,
    mergingPairs,
    // The share of the figure taken up by the worst offending pair, which is
    // what decides whether the merge matters or is a detail in a corner.
    mergingShare: mergingPairs.length ? mergingPairs[0].share : 0,
  }
}

/**
 * The verdict for a figure.
 *
 * - `ok`               — prints fine.
 * - `colour_dependent` — regions a reader must tell apart merge into one grey.
 * - `flat`             — not enough luminance range to print anything.
 * - `unknown`          — nothing was sampled; never reported as a pass.
 *
 * Deliberately conservative. A false "this may not print" costs a teacher ten
 * seconds; a false "fine" costs a class an unanswerable question.
 */
export function assessFigurePrintability(summary) {
  if (!summary || !summary.total) return { verdict: 'unknown', detail: null }
  if (summary.mergingPairs.length && summary.mergingShare >= PROMINENT_SHARE * 2) {
    return { verdict: 'colour_dependent', detail: summary.mergingPairs[0] }
  }
  if (summary.luminanceRange < FLAT_LUMINANCE_RANGE) {
    return { verdict: 'flat', detail: { range: summary.luminanceRange } }
  }
  return { verdict: 'ok', detail: null }
}

/**
 * A plain-language note for a figure that will not print well. '' when there is
 * nothing to say.
 *
 * It names the fix rather than the measurement, because the teacher's options
 * are to regenerate the picture or pick a different style — not to reason about
 * luminance.
 */
export function figurePrintWarning(assessment, label = 'A picture on this paper') {
  if (!assessment) return ''
  if (assessment.verdict === 'colour_dependent') {
    return (
      `${label} uses colour to tell its parts apart, so they will look the same ` +
      'shade of grey when the paper is printed in black and white. Regenerate it ' +
      'as a black-and-white line drawing, or label the parts instead of colouring them.'
    )
  }
  if (assessment.verdict === 'flat') {
    return (
      `${label} is very pale and may come out almost blank when printed. ` +
      'Regenerate it with stronger outlines.'
    )
  }
  return ''
}

/**
 * Quantise raw RGBA pixels into a colour census.
 *
 * Separate from the sampling so a caller with pixels from any source — a canvas,
 * a test, a future server-side decoder — gets the same census. `bits` is per
 * channel; 5 keeps 32 levels, which is more than enough to tell regions apart
 * and few enough to keep the pair comparison small.
 *
 * Fully transparent pixels are skipped: a figure on a transparent background
 * prints on white, and counting the transparency as a colour would report a
 * merge with whatever sits behind it.
 */
export function censusFromPixels(pixels, { bits = 5 } = {}) {
  const step = 256 >> bits
  const counts = new Map()
  const data = pixels || []
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    const r = Math.min(255, Math.floor(data[i] / step) * step + (step >> 1))
    const g = Math.min(255, Math.floor(data[i + 1] / step) * step + (step >> 1))
    const b = Math.min(255, Math.floor(data[i + 2] / step) * step + (step >> 1))
    const key = (r << 16) | (g << 8) | b
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts, ([key, count]) => ({
    r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count,
  }))
}
