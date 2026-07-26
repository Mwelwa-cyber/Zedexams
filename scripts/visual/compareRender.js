/**
 * compareRender — deciding whether a rendered page changed (§4.6).
 *
 * A single percentage threshold is the reason most visual suites get switched
 * off. Set it low and every font-hinting shimmer fails the build; set it high
 * and a lost decimal point passes. Both outcomes end with reviewers ignoring the
 * suite, which is worse than not having one.
 *
 * So the comparison classifies each differing pixel by AMPLITUDE and then by
 * SHAPE, and applies a different bar to each:
 *
 *  - **Minor** differences (below `minorAmplitude`) are rasterisation noise —
 *    sub-pixel hinting, anti-aliased edges shifting by a fraction. A generous
 *    fraction of the page is allowed to differ this way.
 *  - **Significant** differences are ink appearing or disappearing. Almost none
 *    is allowed anywhere.
 *  - A **connected cluster** of significant pixels fails outright regardless of
 *    the page fraction, because that is the shape of content going missing. A
 *    lost decimal point is a handful of pixels — far too few to move any
 *    percentage — but it is a solid, high-amplitude blob, and that is detectable.
 *
 * That last rule is the one that makes the suite worth running. The owner's
 * list — missing punctuation, changed mathematical symbols, thin fraction bars
 * disappearing, arrowheads disappearing, decimal points being lost, small labels
 * becoming unreadable — is entirely made of small, high-amplitude clusters.
 *
 * ## Strict regions
 *
 * Mathematical glyphs and diagram labels get a lower cluster threshold than
 * ordinary paragraph text, because the ink that matters there is smaller. A
 * fixture declares those regions; anything undeclared uses the ordinary bar.
 *
 * ## Connectivity, and why it bridges through noise
 *
 * Components use EIGHT-neighbour connectivity, because a diagonal stroke — the
 * slash of a fraction, the leg of an arrowhead — is diagonally connected and
 * four-connectivity would fragment it into a row of individually harmless
 * pixels.
 *
 * A component is grown over EVERY differing pixel and then judged on how many
 * SIGNIFICANT ones it contains. That is what stops a real defect being
 * fragmented: a missing anti-aliased line has a full-amplitude centre and
 * tapered ends, so the taper is minor and would cut the centre into pieces if
 * only significant pixels could connect. Growing through adjacent difference
 * keeps it whole.
 *
 * It is deliberately NOT dilation. Two defects a few pixels apart stay separate
 * unless there is a continuous trail of differing pixels between them — and such
 * a trail would itself be a change worth reporting. Dilation would merge them and
 * report one finding where there are two.
 *
 * Pure: takes decoded pixel buffers, returns a verdict. No file system, no
 * browser. That is what makes the decision testable with a handful of synthetic
 * pixels instead of a screenshot corpus.
 */

/** Channel difference below which a pixel is rasterisation noise, not ink. */
export const MINOR_AMPLITUDE = 32

/** Fraction of a page allowed to differ by rasterisation noise alone. */
export const MINOR_FRACTION_LIMIT = 0.02

/** Fraction of a page allowed to differ significantly. Near zero on purpose. */
export const SIGNIFICANT_FRACTION_LIMIT = 0.0002

/**
 * Below this many significant pixels the fraction rule stays silent, and the
 * CLUSTER rule decides.
 *
 * Without a floor the fraction rule is scale-sensitive in the wrong direction: a
 * single stray pixel is 0.03% of a 60×60 region and 0.00005% of an A4 page at
 * 150dpi, so the same artefact fails on one and passes on the other. A handful
 * of scattered high-amplitude pixels is glyph-edge noise; whether it is CONTENT
 * is a question about shape, which is what the cluster pass answers. The
 * fraction rule exists for the other case — a lot of ink changing all over the
 * page — and that is never eight pixels.
 */
export const SIGNIFICANT_MIN_PIXELS = 8

/**
 * Connected significant pixels that constitute content, in ordinary text.
 *
 * 6 is deliberately small: a decimal point at 150dpi is roughly 4-9 pixels, and
 * the whole point is to catch it. Isolated 1-5px specks are left to the noise
 * budget, which is what keeps a stray hinting artefact from failing a build.
 */
export const CLUSTER_LIMIT = 6

/** The same, inside a declared strict region. Smaller ink, smaller tolerance. */
export const STRICT_CLUSTER_LIMIT = 2

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/**
 * Is this pixel inside any of the declared strict regions?
 * Regions are `{x, y, width, height}` in pixels, from the fixture.
 */
function inStrictRegion(x, y, regions) {
  for (const r of regions) {
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return true
  }
  return false
}

/**
 * Compare two decoded RGBA pages.
 *
 * @param {object} baseline {width, height, data} — data is RGBA, 4 bytes/pixel
 * @param {object} candidate the same
 * @param {object} [opts]
 * @param {Array}  [opts.strictRegions] regions holding maths or diagram labels
 * @returns {{changed: boolean, reasons: string[], minorPixels: number,
 *   significantPixels: number, largestCluster: number, minorFraction: number,
 *   significantFraction: number, diff: Uint8ClampedArray|null,
 *   sizeChanged: boolean}}
 */
export function comparePages(baseline, candidate, opts = {}) {
  const strictRegions = Array.isArray(opts.strictRegions) ? opts.strictRegions : []
  const result = {
    changed: false,
    reasons: [],
    minorPixels: 0,
    significantPixels: 0,
    largestCluster: 0,
    minorFraction: 0,
    significantFraction: 0,
    diff: null,
    sizeChanged: false,
  }

  if (!baseline || !candidate || !baseline.data || !candidate.data) {
    result.changed = true
    result.reasons.push('a page could not be read, so nothing can be compared')
    return result
  }
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    // Never resample to compare. A page that changed size IS the finding, and
    // scaling one to fit the other would turn a layout regression into a blur.
    result.changed = true
    result.sizeChanged = true
    result.reasons.push(
      `the page size changed (${baseline.width}×${baseline.height} → `
      + `${candidate.width}×${candidate.height})`,
    )
    return result
  }

  const { width, height } = baseline
  const total = width * height
  // 0 = same, 1 = minor, 2 = significant. Kept as a flat map so the cluster
  // pass can walk it without re-reading the images.
  const classes = new Uint8Array(total)
  const diff = new Uint8ClampedArray(total * 4)

  for (let i = 0; i < total; i += 1) {
    const p = i * 4
    // Amplitude is the largest single-channel change, not an average: a red
    // arrowhead vanishing against white moves one channel hard and the mean
    // would dilute it.
    const amplitude = Math.max(
      Math.abs(baseline.data[p] - candidate.data[p]),
      Math.abs(baseline.data[p + 1] - candidate.data[p + 1]),
      Math.abs(baseline.data[p + 2] - candidate.data[p + 2]),
      Math.abs(baseline.data[p + 3] - candidate.data[p + 3]),
    )
    if (amplitude === 0) {
      // Unchanged pixels are dimmed rather than dropped, so a reviewer can see
      // WHERE on the page the change is.
      const grey = clamp(255 - (255 - baseline.data[p]) * 0.15, 0, 255)
      diff[p] = grey
      diff[p + 1] = grey
      diff[p + 2] = grey
      diff[p + 3] = 255
      continue
    }
    if (amplitude < MINOR_AMPLITUDE) {
      classes[i] = 1
      result.minorPixels += 1
      diff[p] = 255
      diff[p + 1] = 235
      diff[p + 2] = 130
      diff[p + 3] = 255
      continue
    }
    classes[i] = 2
    result.significantPixels += 1
    diff[p] = 220
    diff[p + 1] = 20
    diff[p + 2] = 60
    diff[p + 3] = 255
  }

  result.diff = diff
  result.minorFraction = result.minorPixels / total
  result.significantFraction = result.significantPixels / total

  // Connected components over EVERY differing pixel, scored on the SIGNIFICANT
  // ones they contain. See the header: growing through adjacent difference keeps
  // a tapered missing line whole, while staying short of dilation so two nearby
  // defects are not merged into one finding.
  //
  // Iterative flood fill with an explicit stack — a recursive one blows the call
  // stack on a full-page change, which is exactly when the suite must still
  // produce a report.
  const seen = new Uint8Array(total)
  const stack = []
  let largest = 0
  let largestStrict = 0
  for (let i = 0; i < total; i += 1) {
    if (classes[i] === 0 || seen[i]) continue
    let significant = 0
    let strictSignificant = 0
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const idx = stack.pop()
      const x = idx % width
      const y = (idx - x) / width
      if (classes[idx] === 2) {
        significant += 1
        if (inStrictRegion(x, y, strictRegions)) strictSignificant += 1
      }
      // Eight-neighbour: a diagonal stroke is diagonally connected, and
      // four-connectivity would fragment it into harmless-looking pixels.
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const n = ny * width + nx
          if (classes[n] === 0 || seen[n]) continue
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (significant > largest) largest = significant
    if (strictSignificant > largestStrict) largestStrict = strictSignificant
  }
  result.largestCluster = largest

  if (largestStrict >= STRICT_CLUSTER_LIMIT) {
    result.changed = true
    result.reasons.push(
      `${largestStrict} connected ink pixels changed inside a maths or label region `
      + `(limit ${STRICT_CLUSTER_LIMIT}) — a symbol or label may have changed`,
    )
  } else if (largest >= CLUSTER_LIMIT) {
    result.changed = true
    result.reasons.push(
      `${largest} connected ink pixels changed together (limit ${CLUSTER_LIMIT}) — `
      + 'this is the shape of content appearing or disappearing, not rasterisation noise',
    )
  }
  if (result.significantPixels >= SIGNIFICANT_MIN_PIXELS
    && result.significantFraction > SIGNIFICANT_FRACTION_LIMIT) {
    result.changed = true
    result.reasons.push(
      `${(result.significantFraction * 100).toFixed(4)}% of the page changed `
      + `substantially (limit ${(SIGNIFICANT_FRACTION_LIMIT * 100).toFixed(4)}%)`,
    )
  }
  if (result.minorFraction > MINOR_FRACTION_LIMIT) {
    result.changed = true
    result.reasons.push(
      `${(result.minorFraction * 100).toFixed(2)}% of the page differs even `
      + `allowing for rasterisation noise (limit ${(MINOR_FRACTION_LIMIT * 100).toFixed(2)}%)`,
    )
  }
  return result
}

/**
 * A one-line summary for the CI comparison report.
 *
 * Names the fixture ID rather than a display title, because a title gets renamed
 * and a baseline is filed under the ID.
 */
export function summarisePageComparison(fixtureId, pageNumber, comparison) {
  const verdict = comparison.changed ? 'CHANGED' : 'ok'
  return [
    `${verdict}  ${fixtureId} page ${pageNumber}`,
    `minor ${(comparison.minorFraction * 100).toFixed(3)}%`,
    `significant ${(comparison.significantFraction * 100).toFixed(4)}%`,
    `largest cluster ${comparison.largestCluster}px`,
  ].join(' · ')
}
