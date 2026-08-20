/**
 * The geometry of a fraction picture, and the rule that a picture must be
 * TRUE.
 *
 * This is pure because the thing that goes wrong here is invisible on screen.
 * A circle drawn in five wedges under the caption "three quarters" renders
 * perfectly: no error, no warning, nothing red — just a child being taught
 * that a quarter is a fifth. So the partition is computed here, checked here,
 * and the component is left with nothing to decide.
 *
 * Three rules carry it:
 *
 *   THE PARTITION COUNT IS THE DENOMINATOR AND THE SHADED COUNT IS THE
 *   NUMERATOR. `validateVisual` refuses anything else. A picture is not an
 *   illustration OF a fraction, it IS the fraction, and the two numbers on the
 *   page are the two numbers in the drawing.
 *
 *   EQUAL PARTS ARE EQUAL BY CONSTRUCTION, AND UNEQUAL ONES ARE DELIBERATE.
 *   The default share list is `1/parts` repeated, so nothing can be a little
 *   bit off by accident. A question that WANTS unequal pieces — the
 *   equal-parts misconception round, where two of the three oranges must be
 *   cut wrongly — passes an explicit `shares` array and is checked to be
 *   genuinely unequal, because a distractor that is accidentally equal makes
 *   the round unanswerable.
 *
 *   THE ARTWORK AND THE MATHS ARE SEPARATE LAYERS. An orange is a colour, a
 *   stalk and a leaf; the four equal wedges over it are computed here. Nothing
 *   asks an illustrator or a model to draw geometrically perfect thirds —
 *   which is the one thing neither can be relied on to do — so a fraction
 *   picture is exact whatever object it is wearing.
 *
 * No React, no DOM. Every function returns plain numbers, so the same
 * partition can be drawn as SVG, measured in a test, or printed later.
 */

/* ── the objects a fraction can be worn by ─────────────────────────── */

/**
 * The concrete objects, each with the noun a caption uses and the plain
 * worksheet noun it degrades to. The pairing is the point of §5–6: the maths
 * is identical, and a child who only meets circles binds the idea to circles.
 *
 * `ink`/`pale` are the shaded and unshaded fills. They are declared per object
 * rather than per question so a pack cannot introduce a fifth palette.
 */
export const FRACTION_OBJECTS = {
  orange: { noun: 'orange', plural: 'oranges', plain: 'shape', shape: 'circle', ink: '#f79020', pale: '#ffeed6', edge: '#d96f06', top: 'stalk' },
  bun: { noun: 'bun', plural: 'buns', plain: 'bar', shape: 'bar', ink: '#d99441', pale: '#f6e6cf', edge: '#a96b22', top: null },
  chitenge: { noun: 'chitenge', plural: 'chitenges', plain: 'strip', shape: 'strip', ink: '#2f8f83', pale: '#d9efec', edge: '#1d6a60', top: null },
  sweet: { noun: 'sweet', plural: 'sweets', plain: 'counter', shape: 'group', ink: '#d6457a', pale: '#fbdde8', edge: '#a52c58', top: null },
  cake: { noun: 'cake', plural: 'cakes', plain: 'shape', shape: 'circle', ink: '#b3722f', pale: '#f2e2d0', edge: '#7d4c17', top: null },
  bar: { noun: 'bar', plural: 'bars', plain: 'bar', shape: 'bar', ink: '#5b5bd6', pale: '#e4e5fb', edge: '#3f3fae', top: null },
  shape: { noun: 'shape', plural: 'shapes', plain: 'shape', shape: 'circle', ink: '#5b5bd6', pale: '#e4e5fb', edge: '#3f3fae', top: null },
}

export const FRACTION_SHAPES = ['circle', 'bar', 'strip', 'group']

export function objectFor(key) {
  return FRACTION_OBJECTS[key] || FRACTION_OBJECTS.shape
}

/** The word a caption should use for an object, honouring the plain-shape mode. */
export function objectNoun(key, { plain = false, plural = false } = {}) {
  const object = objectFor(key)
  if (plain) return plural ? `${object.plain}s` : object.plain
  return plural ? object.plural : object.noun
}

/* ── shares: how the whole is divided ──────────────────────────────── */

/**
 * The fraction of the whole each region takes, summing to 1.
 *
 * With no `shares` the parts are exactly equal — every region `1/parts` — so
 * an equal partition is what you get by DEFAULT and an unequal one has to be
 * asked for.
 */
export function sharesFor(parts, shares = null) {
  const count = Math.max(1, Math.floor(Number(parts) || 1))
  if (!Array.isArray(shares) || shares.length !== count) {
    return Array.from({ length: count }, () => 1 / count)
  }
  const values = shares.map((s) => Math.max(0, Number(s) || 0))
  const total = values.reduce((a, b) => a + b, 0)
  if (!total) return Array.from({ length: count }, () => 1 / count)
  return values.map((v) => v / total)
}

/** True when every region is the same size — the thing level 1 tests for. */
export function sharesAreEqual(shares, tolerance = 0.02) {
  if (!Array.isArray(shares) || shares.length < 2) return true
  const first = shares[0]
  return shares.every((s) => Math.abs(s - first) <= tolerance)
}

/* ── circle ────────────────────────────────────────────────────────── */

/**
 * Wedges of a circle, as SVG path data.
 *
 * Angles start at −90° (straight up), which is where a person cutting a round
 * thing starts. The half-way case is why `large` exists: a wedge over 180°
 * needs the large-arc flag or SVG draws the small side of the same arc, which
 * is a wedge of the wrong size — geometry, not styling, so it belongs here.
 */
export function pieWedges({ parts, size = 132, shares = null, inset = 11, dropY = 5 } = {}) {
  const list = sharesFor(parts, shares)
  const r = size / 2 - inset
  const cx = size / 2
  const cy = size / 2 + dropY
  let angle = -Math.PI / 2
  return list.map((share, index) => {
    const next = angle + share * Math.PI * 2
    const x0 = cx + r * Math.cos(angle)
    const y0 = cy + r * Math.sin(angle)
    const x1 = cx + r * Math.cos(next)
    const y1 = cy + r * Math.sin(next)
    const large = share > 0.5 ? 1 : 0
    const path = list.length === 1
      // One part is the whole circle, and a single arc from a point back to
      // itself draws nothing. Two half-arcs draw the circle.
      ? `M${cx},${cy - r} A${r},${r} 0 1,1 ${cx},${cy + r} A${r},${r} 0 1,1 ${cx},${cy - r} Z`
      : `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1} Z`
    angle = next
    return { index, share, path, large }
  })
}

/* ── bar and strip ─────────────────────────────────────────────────── */

/** Segments of a bar, left to right. A strip is the same maths, drawn taller. */
export function barSegments({ parts, width = 232, height = 62, shares = null, gap = 0 } = {}) {
  const list = sharesFor(parts, shares)
  const inner = Math.max(0, width - gap * Math.max(0, list.length - 1))
  let x = 0
  return list.map((share, index) => {
    const w = inner * share
    const seg = { index, share, x, y: 0, width: w, height }
    x += w + gap
    return seg
  })
}

/* ── group ─────────────────────────────────────────────────────────── */

/**
 * A collection of separate things — six oranges in a basket, eight sweets.
 *
 * The bridge from "half of one orange" to "half of six oranges" is a whole
 * teaching step (§14), and it is a different DRAWING: nothing is cut, the
 * whole is the set, and the denominator is how many things there are. The
 * layout wraps at `perRow` so eight sweets read as two rows of four rather
 * than one line a phone has to scroll.
 */
export function groupItems({ count, perRow = 4, cell = 52, gap = 8 } = {}) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  const columns = Math.min(perRow, Math.max(1, total))
  return Array.from({ length: total }, (_, index) => ({
    index,
    row: Math.floor(index / columns),
    column: index % columns,
    x: (index % columns) * (cell + gap),
    y: Math.floor(index / columns) * (cell + gap),
    size: cell,
  }))
}

export function groupBox({ count, perRow = 4, cell = 52, gap = 8 } = {}) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  const columns = Math.min(perRow, Math.max(1, total))
  const rows = Math.max(1, Math.ceil(total / columns))
  return {
    width: columns * cell + (columns - 1) * gap,
    height: rows * cell + (rows - 1) * gap,
    columns,
    rows,
  }
}

/* ── the shaded set ────────────────────────────────────────────────── */

/**
 * Which regions are shaded, as a Set of indices.
 *
 * A caller may pass an explicit list (the learner's own taps) or a count (the
 * pack saying "three of them"). A count shades the FIRST n, which for an equal
 * partition is the only thing that can be meant.
 */
export function shadedSet(shaded, parts) {
  if (Array.isArray(shaded)) return new Set(shaded.map((i) => Number(i)))
  const n = Math.max(0, Math.min(Math.floor(Number(shaded) || 0), Math.floor(Number(parts) || 0)))
  return new Set(Array.from({ length: n }, (_, i) => i))
}

export function shadedCount(shaded, parts) {
  return shadedSet(shaded, parts).size
}

/* ── the rule ──────────────────────────────────────────────────────── */

/**
 * Is this picture a true picture of this fraction?
 *
 * `{ ok, errors: [{ code, message }] }` — a list rather than a first failure,
 * because a malformed question usually has more than one thing wrong with it
 * and reporting them one build at a time is how an import takes five rounds.
 *
 * `expectEqual` defaults to true. A question that deliberately draws unequal
 * pieces has to say so, and is then checked for the opposite — that the pieces
 * really are unequal — because an "unequal" distractor that came out equal
 * makes its round unanswerable and looks fine on screen.
 */
export function validateVisual(visual = {}) {
  const errors = []
  const add = (code, message) => errors.push({ code, message })

  const shape = visual.shape || 'circle'
  if (!FRACTION_SHAPES.includes(shape)) {
    add('shape', `Unknown shape "${shape}". Use one of: ${FRACTION_SHAPES.join(', ')}.`)
  }

  const parts = Number(visual.parts)
  if (!Number.isInteger(parts) || parts < 1) {
    add('parts', 'The whole must be divided into a whole number of parts, at least 1.')
  }

  const denominator = visual.denominator === undefined ? parts : Number(visual.denominator)
  if (Number.isInteger(parts) && parts >= 1 && Number.isInteger(denominator) && denominator !== parts) {
    add('parts-denominator', `The picture has ${parts} parts but the fraction says ${denominator}. The number of regions IS the bottom number.`)
  }

  if (visual.numerator !== undefined) {
    const numerator = Number(visual.numerator)
    if (!Number.isInteger(numerator) || numerator < 0) {
      add('numerator', 'The top number must be a whole number, 0 or more.')
    } else if (Number.isInteger(denominator) && numerator > denominator && !visual.allowImproper) {
      add('numerator-over', `${numerator} of ${denominator} parts cannot be shaded — there are only ${denominator}. An improper fraction needs more than one whole, and must set allowImproper.`)
    } else if (visual.shaded !== undefined) {
      const count = shadedCount(visual.shaded, parts)
      if (count !== numerator) {
        add('shaded-numerator', `${count} region(s) are shaded but the fraction says ${numerator}. The number of shaded regions IS the top number.`)
      }
    }
  }

  if (Array.isArray(visual.shares)) {
    if (Number.isInteger(parts) && visual.shares.length !== parts) {
      add('shares-length', `${visual.shares.length} share(s) given for ${parts} parts.`)
    }
    if (visual.shares.some((s) => !(Number(s) > 0))) {
      add('shares-value', 'Every share must be greater than zero — a part with no size is not a part.')
    }
  }

  const expectEqual = visual.expectEqual !== false
  const shares = sharesFor(parts, visual.shares)
  const equal = sharesAreEqual(shares)
  if (expectEqual && !equal) {
    add('unequal', 'The parts are not the same size. Halves, thirds and quarters are only those when the pieces are equal — say expectEqual: false if the unevenness is the question.')
  }
  if (!expectEqual && equal) {
    add('not-unequal', 'This picture is meant to show UNEQUAL parts, but the shares came out equal — the round it belongs to would have no wrong answer to find.')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Everything a renderer needs for one picture, with the partition already
 * computed. Throws on an invalid visual rather than drawing a lie — a caller
 * gets the exception in a test or the import, never a learner.
 */
export function buildVisual(visual = {}) {
  const check = validateVisual(visual)
  if (!check.ok) {
    throw new Error(`Invalid fraction visual: ${check.errors.map((e) => e.message).join(' ')}`)
  }
  const shape = visual.shape || 'circle'
  const parts = Number(visual.parts)
  const shares = sharesFor(parts, visual.shares)
  const shaded = shadedSet(visual.shaded ?? visual.numerator ?? 0, parts)
  return {
    shape,
    parts,
    shares,
    shaded,
    object: objectFor(visual.object),
    objectKey: visual.object || 'shape',
    equal: sharesAreEqual(shares),
  }
}
