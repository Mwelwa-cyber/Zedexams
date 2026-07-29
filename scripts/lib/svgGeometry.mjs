/**
 * scripts/lib/svgGeometry.mjs — read a catalog figure back off the page.
 *
 * The secondary-mathematics figures carry marks. A learner measures the angle
 * in a circle-theorem diagram, reads a value off a plotted quadratic, and takes
 * the median from where an ogive's read-off line lands. So "the SVG renders"
 * is not the property under test — "the SVG says the true thing" is, and the
 * only way to test that is to parse what was actually drawn and do the
 * mathematics on it.
 *
 * This is a test harness, not shipped code: it lives under scripts/ and nothing
 * in src/ or functions/ imports it.
 *
 * Two halves:
 *
 *   1. A tiny SVG reader. The catalog emits a flat, generated, well-formed
 *      subset (no namespaces, no entities beyond `esc()`'s five, no CDATA, no
 *      self-nesting), so a regex tokeniser is honest here in a way it would not
 *      be against arbitrary SVG in the wild.
 *
 *   2. Plane geometry over what it read — angles, bearings, distances — plus
 *      `plotFrame`, which converts a drawn pixel back into GRAPH coordinates.
 *
 * On plotFrame and why it is not circular. A grid figure declares its transform
 * on the root element (`data-plot-*`). A test that only read those attributes
 * would be asserting the renderer's own claim about itself, which is worth
 * nothing. So the transform is used ONLY to interpret coordinates, and every
 * grid family additionally has a test that the declared frame agrees with where
 * the axis NUMBERS were actually painted (`assertFrameMatchesAxisLabels`). Get
 * the frame wrong and the axis labels move with it, so the two cannot both lie
 * in the same direction.
 */

/** Every attribute on one element, plus the text between its tags if any. */
function parseAttrs(raw) {
  const attrs = {}
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(raw))) attrs[m[1]] = m[2]
  return attrs
}

/**
 * Flatten an SVG string into `[{tag, attrs, text}]` in document order.
 *
 * `text` is the raw inner text for `<text>`/`<tspan>` elements — the escaped
 * form, deliberately: a test asserting a label reads exactly what a reader will
 * see, entities and all.
 */
export function parseSvg(svg) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) {
    throw new Error('parseSvg needs an SVG string')
  }
  const elements = []
  // Matches <tag ...attrs/> and <tag ...attrs>text</tag>. The catalog never
  // nests an element inside a <text> other than <tspan>, which this picks up as
  // its own element (with its own coordinates) — which is what a test wants.
  const re = /<([a-zA-Z]+)((?:\s+[a-zA-Z_:][-\w:.]*\s*=\s*"[^"]*")*)\s*(\/?)>([^<]*)/g
  let m
  while ((m = re.exec(svg))) {
    elements.push({ tag: m[1], attrs: parseAttrs(m[2]), text: m[4] ?? '' })
  }
  const root = elements.find((el) => el.tag === 'svg')
  if (!root) throw new Error('no <svg> root element')
  return { root, elements }
}

/** Every element with this tag, optionally filtered. */
export function select(parsed, tag, filter) {
  const list = parsed.elements.filter((el) => el.tag === tag)
  return filter ? list.filter(filter) : list
}

/** One element, asserting there is exactly one. */
export function selectOne(parsed, tag, filter) {
  const list = select(parsed, tag, filter)
  if (list.length !== 1) {
    throw new Error(`expected exactly one <${tag}>${filter ? ' matching the filter' : ''}, found ${list.length}`)
  }
  return list[0]
}

/** An attribute as a number. Throws rather than yielding NaN into an assertion. */
export function num(el, name) {
  const v = parseFloat(el.attrs[name])
  if (!Number.isFinite(v)) {
    throw new Error(`<${el.tag}> has no numeric "${name}" (got ${JSON.stringify(el.attrs[name])})`)
  }
  return v
}

/** `points="1,2 3,4"` → `[[1,2],[3,4]]`. Accepts space- or comma-separated pairs. */
export function points(el) {
  const raw = el.attrs.points || ''
  const nums = raw.trim().split(/[\s,]+/).filter(Boolean).map(Number)
  if (nums.length % 2 !== 0 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`<${el.tag}> has a malformed points list: ${JSON.stringify(raw)}`)
  }
  const out = []
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

/**
 * Split a path `d` into `[{cmd, args:[numbers]}]`.
 *
 * Absolute commands only, which is all the catalog emits — a relative command
 * would silently change what an assertion means, so it throws instead.
 */
export function pathCommands(el) {
  const d = typeof el === 'string' ? el : el.attrs.d || ''
  const out = []
  const re = /([A-Za-z])([^A-Za-z]*)/g
  let m
  while ((m = re.exec(d))) {
    const cmd = m[1]
    if (cmd !== cmd.toUpperCase() && cmd !== 'z') {
      throw new Error(`relative path command "${cmd}" — the catalog draws in absolute coordinates`)
    }
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (args.some((n) => !Number.isFinite(n))) {
      throw new Error(`path command "${cmd}" has a non-numeric argument in ${JSON.stringify(d)}`)
    }
    out.push({ cmd: cmd.toUpperCase(), args })
  }
  return out
}

/** Every point a path passes THROUGH — command endpoints, not control points. */
export function pathPoints(el) {
  const out = []
  for (const { cmd, args } of pathCommands(el)) {
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < args.length; i += 2) out.push([args[i], args[i + 1]])
    } else if (cmd === 'A') {
      // rx ry rot large sweep x y — the last pair is where the arc lands.
      if (args.length >= 7) out.push([args[args.length - 2], args[args.length - 1]])
    } else if (cmd === 'Q') {
      // cx cy x y — the control point is not on the curve; the endpoint is.
      if (args.length >= 4) out.push([args[args.length - 2], args[args.length - 1]])
    }
  }
  return out
}

/** All rendered text, in document order, unescaped back to what a reader sees. */
export function texts(parsed) {
  return parsed.elements
    .filter((el) => (el.tag === 'text' || el.tag === 'tspan') && el.text.trim())
    .map((el) => unescapeSvgText(el.text.trim()))
}

/** The inverse of the catalog's `esc()`. */
export function unescapeSvgText(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/* ── plane geometry ──────────────────────────────────────────────────────── */

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** The angle ∠(a, vertex, b) in degrees, always the non-reflex 0–180 value. */
export function angleBetween(vertex, a, b) {
  const v1 = [a[0] - vertex[0], a[1] - vertex[1]]
  const v2 = [b[0] - vertex[0], b[1] - vertex[1]]
  const dot = v1[0] * v2[0] + v1[1] * v2[1]
  const mag = Math.hypot(...v1) * Math.hypot(...v2)
  if (mag === 0) throw new Error('angleBetween: a point coincides with the vertex')
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI
}

/**
 * The three-figure bearing of `to` from `from`, in SVG coordinates.
 *
 * SVG's y axis points DOWN, so north is −y. Getting that backwards yields a
 * bearing reflected about the east–west line — which looks plausible and is
 * wrong, so it is written once, here.
 */
export function bearingFromNorth(from, to) {
  const dx = to[0] - from[0]
  const dy = -(to[1] - from[1])
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI
  return (deg + 360) % 360
}

/** Assert two numbers agree to `tol` (default a tenth of a pixel/unit). */
export function approx(actual, expected, tol = 0.1, what = 'value') {
  if (!Number.isFinite(actual)) throw new Error(`${what}: expected a number, got ${actual}`)
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${what}: expected ${expected} ± ${tol}, got ${actual}`)
  }
}

/** Assert two points agree to `tol`. */
export function approxPoint(actual, expected, tol = 0.6, what = 'point') {
  approx(actual[0], expected[0], tol, `${what} x`)
  approx(actual[1], expected[1], tol, `${what} y`)
}

/* ── graph coordinates ───────────────────────────────────────────────────── */

/**
 * The plotting frame a grid figure declares on its root element.
 *
 * `data-plot-ox` / `data-plot-oy` are the SVG pixel coordinates of the graph
 * origin; `data-plot-ux` / `data-plot-uy` are pixels per graph unit along each
 * axis. `uy` is a positive magnitude — the y flip lives here rather than in
 * every caller's head.
 */
export function plotFrame(parsed) {
  const root = parsed.root
  const need = (name) => {
    const v = parseFloat(root.attrs[name])
    if (!Number.isFinite(v)) {
      throw new Error(`this figure declares no ${name} — a grid figure must publish its plotting frame`)
    }
    return v
  }
  const ox = need('data-plot-ox')
  const oy = need('data-plot-oy')
  const ux = need('data-plot-ux')
  const uy = need('data-plot-uy')
  return {
    ox, oy, ux, uy,
    toSvg: ([gx, gy]) => [ox + gx * ux, oy - gy * uy],
    toGraph: ([x, y]) => [(x - ox) / ux, (oy - y) / uy],
  }
}

/**
 * Prove the declared frame is the one the figure actually drew in.
 *
 * Reads the numbered axis labels off the page and checks each sits where the
 * frame says its value belongs. This is what stops `plotFrame` from being the
 * renderer marking its own homework: a wrong frame moves the labels too, so a
 * figure cannot satisfy both this and a geometry assertion while lying.
 */
export function assertFrameMatchesAxisLabels(parsed, frame, { tol = 1.2 } = {}) {
  const labels = parsed.elements.filter(
    (el) => el.tag === 'text' && el.attrs['data-axis'] && el.text.trim(),
  )
  if (labels.length < 2) {
    throw new Error('a grid figure must number its axes (found fewer than two data-axis labels)')
  }
  for (const el of labels) {
    const value = Number(el.text.trim())
    if (!Number.isFinite(value)) continue
    const axis = el.attrs['data-axis']
    if (axis === 'x') {
      approx(num(el, 'x'), frame.toSvg([value, 0])[0], tol, `x-axis label "${value}"`)
    } else if (axis === 'y') {
      approx(num(el, 'y'), frame.toSvg([0, value])[1] + Number(el.attrs['data-baseline'] || 0), tol,
        `y-axis label "${value}"`)
    }
  }
}

/** Every point of a polygon/polyline/path, converted into graph coordinates. */
export function graphPoints(frame, el) {
  const raw = el.attrs.points !== undefined ? points(el) : pathPoints(el)
  return raw.map((p) => frame.toGraph(p))
}
