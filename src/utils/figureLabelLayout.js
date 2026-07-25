/**
 * figureLabelLayout — where a figure's labels sit, and what they point at (§4.2).
 *
 * The brief asks for two things this file provides: labels that do not collide,
 * and leader lines that terminate on the correct part.
 *
 * Before this, three renderers each placed labels independently — the studio
 * preview, the print/PDF window and the Word export — and each of them drew a
 * label centred on its authored `(x, y)` with no awareness of any other label.
 * Two parts close together on a diagram (the atrium and the ventricle; the
 * petal and the sepal) produced two pills stacked on the same spot, and the
 * paper was unusable. Nothing anywhere de-collided them.
 *
 * The leader lines had a subtler fault. They were drawn from the label's
 * CENTRE, so the first third of every line ran underneath the pill and came out
 * of the wrong side of it — the line appeared to start beside the label rather
 * than from it, and on a dark diagram it struck through the text. A leader
 * should leave the label at its edge, on the side facing the part, and stop
 * exactly on the part.
 *
 * ## The rule that makes de-collision safe
 *
 * Moving a label is not free. A label with no leader line names the part it is
 * SITTING ON — that is the whole of what tells a reader which part is meant. So
 * a label this module moves grows a leader back to where the teacher put it.
 * Otherwise de-collision would quietly relabel the diagram, which is worse than
 * the overlap it fixed: an overlap is visibly broken, a confidently mislabelled
 * heart is not.
 *
 * ## One reference box, on purpose
 *
 * Positions come back NORMALISED (0–1) so a renderer positioning with
 * percentages and one positioning in pixels get the same answer. The collision
 * pass needs real sizes though, so it runs against a nominal figure box — the
 * size a figure actually prints at in an A4 column. Each renderer still draws
 * its own pill (11px in the preview, 9pt in print, image-relative in Word);
 * what matters is that all of them place it in the same spot, and that the
 * spot was chosen against the geometry of the printed page.
 *
 * Pure: no DOM, no Firebase, no React. Deterministic — same input, same output,
 * every pass in index order, no randomness.
 */

/** The box a figure occupies in an A4 text column, in CSS pixels. */
export const NOMINAL_FIGURE_BOX = { width: 360, height: 240 }

/** Label text size the collision pass reasons about, in CSS pixels. */
const NOMINAL_FONT_PX = 11

/** Horizontal padding inside a text pill, per side. */
const PILL_PAD_X = 6

/**
 * Average advance width of Arial as a fraction of the font size, for mixed-case
 * text. Taken from Arial's published metrics, not measured at runtime and not
 * eyeballed — a nominal figure that is deliberately a little generous, since
 * over-estimating a pill's width separates two labels that would have just
 * touched, while under-estimating leaves them overlapping. It is an estimate
 * rather than a measurement because this module stays pure so the
 * Word exporter and the plain-node tests can call it, and the three renderers
 * draw pills at three different sizes anyway — what they have to agree on is
 * placement. It only has to be good enough to know whether two pills overlap.
 */
const CHAR_WIDTH_RATIO = 0.58

/** Diameter of a numbered marker in identify mode, in CSS pixels. */
const IDENTIFY_DIAMETER = 20

/** How far the leader line stops short of the pill's border, in pixels. */
const LEADER_GAP_PX = 2

/** Passes of the separation loop. Bounded so this can never spin. */
const MAX_PASSES = 24

const clamp01 = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const finite = (n) => Number.isFinite(Number(n))

/**
 * The size of the box a label occupies, in CSS pixels.
 *
 * Identify markers are a fixed circle. Labelled pills grow with their text —
 * which is why a long label is the one most likely to collide, and why the
 * warning suggests shortening it.
 */
export function labelBoxSize(label, { mode = 'labeled', fontSize = NOMINAL_FONT_PX } = {}) {
  if (mode === 'identify') {
    return { width: IDENTIFY_DIAMETER, height: IDENTIFY_DIAMETER }
  }
  const text = String(label?.text == null ? '' : label.text).trim()
  const width = Math.round(text.length * fontSize * CHAR_WIDTH_RATIO + PILL_PAD_X * 2)
  return { width: Math.max(fontSize * 2, width), height: Math.round(fontSize * 1.7) }
}

/**
 * Where a leader line should leave a label: the point at which the straight
 * line to the target crosses the pill's edge.
 *
 * Returns null when the target is inside the pill — a label already sitting on
 * its part needs no line, and drawing a stub inside the box looks like a fault.
 */
function leaderStart(cx, cy, w, h, tx, ty) {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return null
  // Whether a line is needed is decided by the pill's real edge: if the target
  // is inside the box, the label is already on the part. The cosmetic gap is
  // applied only to where the line STARTS — deciding on the padded box too
  // would leave a dead band a couple of pixels wide in which a label neither
  // covers its part nor points at it.
  const edge = (halfW, halfH) => Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  )
  if (edge(w / 2, h / 2) >= 1) return null
  // Never let the gap push the start past the target it is heading for.
  const t = Math.min(edge(w / 2 + LEADER_GAP_PX, h / 2 + LEADER_GAP_PX), 1)
  return { x: cx + dx * t, y: cy + dy * t }
}

/** Do two axis-aligned boxes overlap? Touching edges do not count. */
function overlaps(a, b) {
  return (
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 &&
    Math.abs(a.cy - b.cy) < (a.h + b.h) / 2
  )
}

/**
 * Resolve every label's final position, its leader line and its target.
 *
 * @param {Array} labels  authored labels: {x, y, text, tx?, ty?} in 0–1
 * @param {object} [opts]
 * @param {number} [opts.width]   figure box width in CSS pixels
 * @param {number} [opts.height]  figure box height in CSS pixels
 * @param {'labeled'|'identify'} [opts.mode]
 * @param {number} [opts.fontSize]
 * @param {Array} [opts.anchors] boxes that push these labels around but never
 *   move themselves: `{x, y, widthPx, heightPx}` in 0–1 plus pixel sizes. Used
 *   by the marking key, where the numbered markers must stay exactly where the
 *   learner's copy put them while the answer names arrange themselves around.
 * @returns {{labels: Array, movedCount: number, unresolvedOverlaps: number}}
 *   each entry: {index, text, x, y, originX, originY, moved,
 *                widthPx, heightPx, leader: {x1,y1,x2,y2}|null,
 *                target: {x, y}|null}
 *   — every coordinate normalised 0–1.
 */
export function resolveFigureLabels(labels = [], opts = {}) {
  const mode = opts.mode === 'identify' ? 'identify' : 'labeled'
  const W = Number(opts.width) > 0 ? Number(opts.width) : NOMINAL_FIGURE_BOX.width
  const H = Number(opts.height) > 0 ? Number(opts.height) : NOMINAL_FIGURE_BOX.height
  const fontSize = Number(opts.fontSize) > 0 ? Number(opts.fontSize) : NOMINAL_FONT_PX
  const list = Array.isArray(labels) ? labels : []

  // Everything below works in pixels within the figure box, then converts back.
  const boxes = list.map((label, index) => {
    const size = labelBoxSize(label, { mode, fontSize })
    const originX = clamp01(label?.x)
    const originY = clamp01(label?.y)
    return {
      index,
      text: String(label?.text == null ? '' : label.text),
      cx: originX * W,
      cy: originY * H,
      originPx: { x: originX * W, y: originY * H },
      w: Math.min(size.width, W),
      h: Math.min(size.height, H),
      // An authored target: the part the teacher pointed the label at.
      target: finite(label?.tx) && finite(label?.ty)
        ? { x: clamp01(label.tx) * W, y: clamp01(label.ty) * H }
        : null,
    }
  })

  // Immovable obstacles. They take part in every overlap test and are never
  // displaced, so the movable labels flow around them.
  const anchors = (Array.isArray(opts.anchors) ? opts.anchors : []).map(a => ({
    fixed: true,
    cx: clamp01(a?.x) * W,
    cy: clamp01(a?.y) * H,
    w: Math.min(Number(a?.widthPx) > 0 ? Number(a.widthPx) : 0, W),
    h: Math.min(Number(a?.heightPx) > 0 ? Number(a.heightPx) : 0, H),
  })).filter(a => a.w > 0 && a.h > 0)

  const clampIntoFigure = (b) => {
    if (b.fixed) return
    b.cx = Math.max(b.w / 2, Math.min(W - b.w / 2, b.cx))
    b.cy = Math.max(b.h / 2, Math.min(H - b.h / 2, b.cy))
  }

  // Separation. Each pass pushes overlapping pairs apart along the axis of
  // least penetration and re-clamps into the figure; clamping can reintroduce
  // an overlap, so the loop is bounded and the result is best-effort rather
  // than guaranteed. What is guaranteed is that it is the same every time.
  const all = boxes.concat(anchors)
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moved = false
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i]
        const b = all[j]
        if (a.fixed && b.fixed) continue
        if (!overlaps(a, b)) continue
        const overlapX = (a.w + b.w) / 2 - Math.abs(a.cx - b.cx)
        const overlapY = (a.h + b.h) / 2 - Math.abs(a.cy - b.cy)
        // Two labels dropped on exactly the same point have no axis to
        // separate along; break the tie by index so the result is stable.
        const dx = a.cx === b.cx ? (i < j ? -1 : 1) : Math.sign(a.cx - b.cx)
        const dy = a.cy === b.cy ? (i < j ? -1 : 1) : Math.sign(a.cy - b.cy)
        // A fixed box does not give ground, so the movable one absorbs the
        // whole separation rather than half of it.
        const aShare = a.fixed ? 0 : (b.fixed ? 1 : 0.5)
        const bShare = b.fixed ? 0 : (a.fixed ? 1 : 0.5)
        if (overlapX < overlapY) {
          const shift = overlapX + 1
          a.cx += dx * shift * aShare
          b.cx -= dx * shift * bShare
        } else {
          const shift = overlapY + 1
          a.cy += dy * shift * aShare
          b.cy -= dy * shift * bShare
        }
        clampIntoFigure(a)
        clampIntoFigure(b)
        moved = true
      }
    }
    if (!moved) break
  }
  boxes.forEach(clampIntoFigure)

  let unresolvedOverlaps = 0
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (!(all[i].fixed && all[j].fixed) && overlaps(all[i], all[j])) unresolvedOverlaps += 1
    }
  }

  let movedCount = 0
  const resolved = boxes.map((b) => {
    const shifted = Math.abs(b.cx - b.originPx.x) > 0.5 || Math.abs(b.cy - b.originPx.y) > 0.5
    if (shifted) movedCount += 1
    // A label that was moved but has no authored target grows one pointing back
    // to where it was placed — otherwise de-collision would silently change
    // which part the label names.
    const target = b.target || (shifted ? { x: b.originPx.x, y: b.originPx.y } : null)
    const start = target ? leaderStart(b.cx, b.cy, b.w, b.h, target.x, target.y) : null
    return {
      index: b.index,
      text: b.text,
      x: b.cx / W,
      y: b.cy / H,
      originX: b.originPx.x / W,
      originY: b.originPx.y / H,
      moved: shifted,
      widthPx: b.w,
      heightPx: b.h,
      target: target ? { x: target.x / W, y: target.y / H } : null,
      leader: start && target
        ? { x1: start.x / W, y1: start.y / H, x2: target.x / W, y2: target.y / H }
        : null,
    }
  })

  return { labels: resolved, movedCount, unresolvedOverlaps }
}

/**
 * The marking key's version of an identify diagram (§4.3).
 *
 * The brief asks for "one source producing an unlabelled learner version and a
 * labelled marking-scheme version, with corresponding letters". Only the first
 * half existed: both copies carried the SAME numbered figure, and the answers
 * appeared under it as "1. Aorta  2. Vena cava". A teacher marking forty
 * scripts had to cross-reference number → name → position on the picture, for
 * every question, on every script — the list told them what the answers were
 * but never where.
 *
 * So the key now names the parts on the figure itself. The numbers are what
 * make the two copies correspond, and correspondence is only real if the
 * numbers do not move: the markers are resolved EXACTLY as the learner's copy
 * resolves them, then passed to the name pills as immovable anchors. A name
 * cannot shove a marker off its part, and each name carries a leader line back
 * to the marker it belongs to.
 *
 * @returns {{markers: Array, names: Array, unresolvedOverlaps: number}}
 *   `markers` is identical to `resolveFigureLabels(labels, {mode:'identify'})`.
 */
export function resolveAnswerKeyLabels(labels = [], opts = {}) {
  const markers = resolveFigureLabels(labels, { ...opts, mode: 'identify' })
  const list = Array.isArray(labels) ? labels : []
  // Each name starts life on its marker and is pushed off it by the anchor,
  // which is what grows the leader line back — the same rule that stops
  // de-collision from silently relabelling a diagram.
  const named = markers.labels.map(m => ({
    x: m.x,
    y: m.y,
    tx: m.x,
    ty: m.y,
    text: String(list[m.index]?.text == null ? '' : list[m.index].text).trim(),
  }))
  const anchors = markers.labels.map(m => ({
    x: m.x, y: m.y, widthPx: m.widthPx, heightPx: m.heightPx,
  }))
  const names = resolveFigureLabels(named, { ...opts, mode: 'labeled', anchors })
  return {
    markers: markers.labels,
    // A blank answer is a marker the teacher hand-marks; it gets no pill rather
    // than an empty box floating beside a number.
    names: names.labels.filter(n => n.text.length > 0),
    unresolvedOverlaps: markers.unresolvedOverlaps + names.unresolvedOverlaps,
  }
}

/**
 * A plain-language note when labels could not be separated. '' when there is
 * nothing to say — which is the usual case.
 *
 * A teacher reads this, so it names what to do rather than what went wrong.
 */
export function figureLabelWarning(result, label = 'A figure') {
  if (!result || !result.unresolvedOverlaps) return ''
  const n = result.unresolvedOverlaps
  return (
    `${label} has ${n === 1 ? 'two labels that overlap' : `${n} pairs of labels that overlap`} ` +
    'and could not be moved apart on the page — try shortening the label text, ' +
    'spreading the labels out, or making the picture bigger.'
  )
}
