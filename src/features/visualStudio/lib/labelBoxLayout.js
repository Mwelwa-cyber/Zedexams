/**
 * Label-box layout for the Diagram Library (Visual Studio v2, 1B + 2F — pure).
 *
 * Works entirely in the asset model's normalized 0–1 coordinate space
 * (`anchor` = the point ON the part, `box` = where the label box sits), so the
 * same layout renders identically on a phone canvas, the A4 paper block and
 * every export. Three jobs:
 *
 *   • autoPlaceBoxes — 1B "auto box placement": each box goes to the NEARER
 *     left/right margin, stacked greedy-push-down so boxes never overlap each
 *     other (or sit on top of the art, which lives between the margins).
 *   • perfectLayout — 2F "one button": boxes assigned to the side of their
 *     anchor, sorted by anchor.y, distributed EVENLY down the margin. Sorting
 *     by y per side is what eliminates leader-line crossings in almost all
 *     cases — deliberately not a routing solver.
 *   • crossingLeaderPairs — the deterministic segment-intersection check the
 *     Smart Suggestions panel (2D) surfaces as "two leader lines cross".
 *
 * Never mutates input labels; every function returns new objects.
 */

// Margin columns the boxes stack in (box centre x), and the vertical band
// they may occupy. Between the columns is the art.
export const BOX_COLUMN_LEFT_X = 0.08
export const BOX_COLUMN_RIGHT_X = 0.92
export const BOX_BAND_TOP_Y = 0.06
export const BOX_BAND_BOTTOM_Y = 0.94
// Minimum vertical spacing between two stacked boxes (≈ one label pill +
// breathing room at A4-column scale).
export const BOX_MIN_GAP_Y = 0.07

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

/** Which margin a label's box belongs on: the side its anchor is nearer to. */
export function sideForAnchor(anchor) {
  return (anchor?.x ?? 0.5) >= 0.5 ? 'right' : 'left'
}

/**
 * Greedy push-down stacking for one side: give each label its anchor's y,
 * then push any box that would overlap the one above it down by the minimum
 * gap. If the stack runs past the bottom of the band, compress it back up
 * (evenly) so every box stays printable.
 *
 * @param {Array} sideLabels labels for ONE side, any order
 * @returns {Map<object, number>} label → box y
 */
function stackSide(sideLabels) {
  const ordered = [...sideLabels].sort((a, b) => (a.anchor?.y ?? 0) - (b.anchor?.y ?? 0))
  const ys = []
  for (const l of ordered) {
    const want = clamp(l.anchor?.y ?? 0.5, BOX_BAND_TOP_Y, BOX_BAND_BOTTOM_Y)
    const min = ys.length ? ys[ys.length - 1] + BOX_MIN_GAP_Y : want
    ys.push(Math.max(want, min))
  }
  // Overflow past the bottom → shift the whole tail up, then if the stack is
  // taller than the band, fall back to even distribution (still uncrossed,
  // because the y-order is preserved).
  const overflow = ys.length ? ys[ys.length - 1] - BOX_BAND_BOTTOM_Y : 0
  if (overflow > 0) {
    for (let i = ys.length - 1; i >= 0; i -= 1) {
      const maxY = BOX_BAND_BOTTOM_Y - (ys.length - 1 - i) * BOX_MIN_GAP_Y
      ys[i] = Math.min(ys[i], maxY)
    }
    if (ys[0] < BOX_BAND_TOP_Y) {
      const n = ys.length
      for (let i = 0; i < n; i += 1) {
        ys[i] = n === 1
          ? (BOX_BAND_TOP_Y + BOX_BAND_BOTTOM_Y) / 2
          : BOX_BAND_TOP_Y + (i * (BOX_BAND_BOTTOM_Y - BOX_BAND_TOP_Y)) / (n - 1)
      }
    }
  }
  return new Map(ordered.map((l, i) => [l, ys[i]]))
}

/**
 * 1B auto box placement: every label's box moves to the nearer margin,
 * stacked without overlaps. Input order is preserved in the result.
 */
export function autoPlaceBoxes(labels = []) {
  const left = labels.filter((l) => sideForAnchor(l.anchor) === 'left')
  const right = labels.filter((l) => sideForAnchor(l.anchor) === 'right')
  const leftY = stackSide(left)
  const rightY = stackSide(right)
  return labels.map((l) => {
    const isLeft = sideForAnchor(l.anchor) === 'left'
    return {
      ...l,
      box: {
        x: isLeft ? BOX_COLUMN_LEFT_X : BOX_COLUMN_RIGHT_X,
        y: (isLeft ? leftY : rightY).get(l),
      },
    }
  })
}

/**
 * 2F "✦ Perfect layout": boxes to the side of their anchor, sorted by
 * anchor.y, distributed EVENLY down the band — clean aligned columns with
 * uncrossed same-side leaders by construction.
 */
export function perfectLayout(labels = []) {
  const bySide = { left: [], right: [] }
  for (const l of labels) bySide[sideForAnchor(l.anchor)].push(l)
  const yFor = new Map()
  for (const side of ['left', 'right']) {
    const ordered = [...bySide[side]].sort((a, b) => (a.anchor?.y ?? 0) - (b.anchor?.y ?? 0))
    const n = ordered.length
    ordered.forEach((l, i) => {
      yFor.set(l, n === 1
        ? (BOX_BAND_TOP_Y + BOX_BAND_BOTTOM_Y) / 2
        : BOX_BAND_TOP_Y + (i * (BOX_BAND_BOTTOM_Y - BOX_BAND_TOP_Y)) / (n - 1))
    })
  }
  return labels.map((l) => ({
    ...l,
    box: {
      x: sideForAnchor(l.anchor) === 'left' ? BOX_COLUMN_LEFT_X : BOX_COLUMN_RIGHT_X,
      y: yFor.get(l),
    },
  }))
}

/**
 * Do two closed segments properly intersect? Shared endpoints (two leaders
 * meeting AT the same anchor point) do not count as a crossing.
 */
export function segmentsIntersect(a1, a2, b1, b2) {
  const d = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = d(b1, b2, a1)
  const d2 = d(b1, b2, a2)
  const d3 = d(a1, a2, b1)
  const d4 = d(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * Every pair of labels whose leader lines (box → anchor) cross — the input to
 * the "two leader lines cross" Smart Suggestion, whose Fix is perfectLayout.
 * @returns {Array<[string, string]>} pairs of label ids
 */
export function crossingLeaderPairs(labels = []) {
  const out = []
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i]
      const b = labels[j]
      if (!a?.anchor || !a?.box || !b?.anchor || !b?.box) continue
      if (segmentsIntersect(a.box, a.anchor, b.box, b.anchor)) {
        out.push([String(a.id || i), String(b.id || j)])
      }
    }
  }
  return out
}
