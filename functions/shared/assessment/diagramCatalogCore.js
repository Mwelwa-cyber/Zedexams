/**
 * src/components/diagrams/diagramCatalog.js
 *
 * ESM mirror of the diagram catalog in /public/studio/11-diagrams.js.
 *
 * Why duplicate?
 *   The original `/studio/11-diagrams.js` is a non-module script loaded into
 *   LessonPlanStudio via a `<script src>` tag — it relies on globals (`esc`,
 *   `$`, `editing`, `doc`, `toast`) defined by sibling studio scripts and
 *   exports nothing. Importing it from React would force us to either:
 *     (a) wait for the global to populate before any quiz can render, or
 *     (b) rewrite the whole `public/studio/` loader chain.
 *
 *   Instead, we copy the catalog object into a clean ESM module here. The
 *   render functions are pure (`(params, color) => svgString`), so they
 *   transplant trivially. The legacy script keeps working for LessonPlanStudio
 *   unchanged; this module is the source of truth for the React app.
 *
 *   Long-term, LessonPlanStudio should import from this module too. That's a
 *   separate refactor.
 *
 * Storage shape on questions / options:
 *
 *   {
 *     libraryKey: 'cylinder',
 *     params: { r: 'r', h: 'h', cap: 'Cylinder' }
 *   }
 *
 * Renderer looks up the entry by `libraryKey`, merges params on top of
 * `defaults`, and calls `render(params, color)` → SVG string.
 *
 * Unknown keys (e.g. catalog entry removed in a future PR) render an
 * accessible placeholder; the data is preserved so a later restore works.
 */

// Tiny SVG-text escaper — every render function below uses it on user-entered
// param values so unbalanced angle brackets in labels can't break the SVG.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Pick a "nice" round step for a value axis (1, 2, 5 × a power of ten) so bar
// and line graphs print a readable numbered y-axis (0, 20, 40, …) the way real
// primary papers do, instead of an unlabelled axis. Returns the step, the top
// gridline (a multiple of the step at/above max) and the tick values.
function niceAxisTicks(max, target = 4) {
  const m = max > 0 ? max : 1
  const raw = m / target
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
  const top = Math.max(step, Math.ceil(m / step) * step)
  const ticks = []
  for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(+v.toFixed(6))
  return { step, top, ticks }
}

/* ── secondary-mathematics helpers ───────────────────────────────────────────
 *
 * The senior figures differ from the primary ones in a way worth stating: a
 * learner MEASURES them. An angle in a circle-theorem diagram, a bearing, the
 * quartile read off an ogive and the image of a rotation all carry marks, so
 * these figures are COMPUTED from their parameters rather than drawn to look
 * about right. Everything below exists so that computation is written once.
 */

// The ink. Most Zambian schools print monochrome and photocopy the master, so
// a grid has to be light enough not to swamp a curve and dark enough to survive
// the copier — `#d9cfbe`, which the primary coordinate grid uses, does not.
const INK = '#1c1612'
const SOFT_INK = '#3a2f25'
const GRID_MINOR = '#a49b8e'
const GRID_MAJOR = '#6f675c'

function nOr(value, fallback) {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/** True for whatever a teacher actually types into a yes/no field. */
function isYes(value) {
  return /^(y|yes|true|1|on)$/i.test(String(value ?? '').trim())
}

/** Round for output: SVG does not need sixteen significant figures. */
const f = (n) => Math.round(n * 100) / 100

/** Split a comma list, dropping blanks. */
const commaList = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * A point on a circle, `deg` measured anticlockwise from the 3 o'clock
 * position — the convention a teacher meets in every textbook diagram, and the
 * one the `points` parameter is documented in.
 */
function onCircle(cx, cy, r, deg) {
  const t = (deg * Math.PI) / 180
  return [cx + r * Math.cos(t), cy - r * Math.sin(t)]
}

/** A text label. Author-entered content is escaped here, once. */
function label(x, y, text, opts = {}) {
  const {
    size = 14, anchor = 'middle', weight = '700', italic = false, fill = INK, extra = '',
  } = opts
  if (text === '' || text === null || text === undefined) return ''
  return `<text x="${f(x)}" y="${f(y)}" font-family="Lora,serif" font-size="${size}"`
    + `${italic ? ' font-style="italic"' : ''} font-weight="${weight}" text-anchor="${anchor}"`
    + ` fill="${fill}"${extra ? ` ${extra}` : ''}>${esc(text)}</text>`
}

/**
 * "Diagram not drawn to scale" — the exam's own caption, printed INSIDE the
 * SVG rather than beside it so it survives the print window, the PDF and Word
 * without three renderers each having to remember it.
 */
function notToScaleNote(w, h, on) {
  if (!on) return ''
  return `<text x="${f(w / 2)}" y="${f(h - 7)}" font-family="Lora,serif" font-size="11"`
    + ` font-style="italic" text-anchor="middle" fill="${SOFT_INK}"`
    + ` data-note="not-to-scale">Diagram not drawn to scale</text>`
}

/** An arrowhead at `tip`, pointing along the direction from `from` to `tip`. */
function arrowHead(from, tip, { size = 9, fill = INK } = {}) {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  const back = a + Math.PI
  const wing = 0.38
  const p1 = [tip[0] + size * Math.cos(back - wing), tip[1] + size * Math.sin(back - wing)]
  const p2 = [tip[0] + size * Math.cos(back + wing), tip[1] + size * Math.sin(back + wing)]
  return `<polygon points="${f(tip[0])},${f(tip[1])} ${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])}" fill="${fill}"/>`
}

/** The angle ∠(p, v, q) in degrees, non-reflex. */
function angleAt(v, p, q) {
  const a = [p[0] - v[0], p[1] - v[1]]
  const b = [q[0] - v[0], q[1] - v[1]]
  const mag = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1])
  if (!mag) return NaN
  const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / mag))
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * The angle marker at `v` between the rays to `p` and `q`, drawn the short way
 * round, with its label on the bisector.
 *
 * A right angle gets the square marker instead of an arc, because that is what
 * it means on an examination paper — an arc through 90° reads as "some angle",
 * and the square reads as "this is the perpendicular", which is often the fact
 * the question turns on.
 */
function angleMark(v, p, q, text, opts = {}) {
  const { r = 26, col = INK, gap = 14, square = null } = opts
  const a1 = Math.atan2(p[1] - v[1], p[0] - v[0])
  const a2 = Math.atan2(q[1] - v[1], q[0] - v[0])
  let delta = a2 - a1
  while (delta <= -Math.PI) delta += 2 * Math.PI
  while (delta > Math.PI) delta -= 2 * Math.PI
  const mid = a1 + delta / 2
  const isRight = square === true || (square !== false && Math.abs(Math.abs(delta) - Math.PI / 2) < 0.02)
  let mark
  if (isRight) {
    const s = 13
    const u1 = [Math.cos(a1), Math.sin(a1)]
    const u2 = [Math.cos(a2), Math.sin(a2)]
    const c1 = [v[0] + s * u1[0], v[1] + s * u1[1]]
    const c2 = [v[0] + s * (u1[0] + u2[0]), v[1] + s * (u1[1] + u2[1])]
    const c3 = [v[0] + s * u2[0], v[1] + s * u2[1]]
    mark = `<polyline points="${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(c3[0])},${f(c3[1])}"`
      + ` fill="none" stroke="${col}" stroke-width="1.5" data-angle-mark="right"/>`
  } else {
    const s = [v[0] + r * Math.cos(a1), v[1] + r * Math.sin(a1)]
    const e = [v[0] + r * Math.cos(a2), v[1] + r * Math.sin(a2)]
    mark = `<path d="M ${f(s[0])},${f(s[1])} A ${r},${r} 0 0,${delta > 0 ? 1 : 0} ${f(e[0])},${f(e[1])}"`
      + ` fill="none" stroke="${col}" stroke-width="1.6" data-angle-mark="arc"/>`
  }
  const lr = isRight ? r + gap + 4 : r + gap
  const lx = v[0] + lr * Math.cos(mid)
  const ly = v[1] + lr * Math.sin(mid) + 4
  return mark + label(lx, ly, text, { size: 13, fill: col })
}

/** "50" → "50°", but "x" stays "x" — a marked angle is often the unknown. */
function degText(value) {
  const n = parseFloat(value)
  const s = String(value ?? '').trim()
  return /^-?\d+(\.\d+)?$/.test(s) ? `${Math.round(n * 10) / 10}°` : s
}
const markText = degText

/* ── circle geometry ─────────────────────────────────────────────────────── */

const CIRCLE_CX = 180, CIRCLE_CY = 152, CIRCLE_R = 104
const NORTH_LEN = 52

/**
 * Everything the circle figure needs, plus the teacher-readable problems with
 * what was typed.
 *
 * Parsing and validating in ONE function is the point: a validator that read
 * the parameters separately from the renderer would be checking a different
 * figure from the one that gets drawn, and would eventually approve a diagram
 * the renderer could not draw (or reject one it could).
 */
function circleTheoremModel(p) {
  const issues = []
  const pts = new Map()
  const centreName = String(p.centre ?? 'O').trim() || 'O'
  pts.centreName = centreName
  pts.set(centreName, [CIRCLE_CX, CIRCLE_CY])
  const onCirc = new Set()

  for (const item of commaList(p.points)) {
    const m = /^([^@]+)@\s*(-?[\d.]+)\s*$/.exec(item)
    if (!m) {
      issues.push({ field: 'points', message: `"${item}" is not a point. Write each one as a name, @, and its position in degrees — for example A@160.` })
      continue
    }
    const name = m[1].trim()
    if (!name) continue
    if (pts.has(name)) {
      issues.push({ field: 'points', message: `"${name}" is used twice. Give each point its own name.` })
      continue
    }
    pts.set(name, onCircle(CIRCLE_CX, CIRCLE_CY, CIRCLE_R, parseFloat(m[2])))
    onCirc.add(name)
  }
  if (onCirc.size < 2) {
    issues.push({ field: 'points', message: 'Put at least two points on the circle, for example A@160,B@60.' })
  }

  // Tangent at a point, naming the two ends so an alternate-segment angle has
  // something to be measured to.
  let tangent = null
  const raw = String(p.tangent ?? '').trim()
  if (raw) {
    const m = /^([^:]+):\s*([^,]+)\s*,\s*(.+)$/.exec(raw)
    if (!m) {
      issues.push({ field: 'tangent', message: 'Write the tangent as the point it touches, a colon, then the names of its two ends — for example C:T,U.' })
    } else {
      const at = m[1].trim()
      const base = pts.get(at)
      if (!base || !onCirc.has(at)) {
        issues.push({ field: 'tangent', message: `A tangent touches the circle, so "${at}" must be one of your points on the circle.` })
      } else {
        // Perpendicular to the radius, which is what makes it a tangent.
        const ux = (base[0] - CIRCLE_CX) / CIRCLE_R, uy = (base[1] - CIRCLE_CY) / CIRCLE_R
        const tx = -uy, ty = ux
        const L = 92
        const a = [base[0] - tx * L, base[1] - ty * L]
        const b = [base[0] + tx * L, base[1] + ty * L]
        const n1 = m[2].trim(), n2 = m[3].trim()
        if (n1 && !pts.has(n1)) pts.set(n1, a)
        if (n2 && !pts.has(n2)) pts.set(n2, b)
        tangent = { at, a, b }
      }
    }
  }

  const joins = []
  for (const item of commaList(p.joins)) {
    const [from, to] = item.split('-').map((s) => s.trim())
    if (!from || !to) {
      issues.push({ field: 'joins', message: `"${item}" is not a line. Write each one as two point names with a dash between them, for example A-B.` })
      continue
    }
    for (const name of [from, to]) {
      if (!pts.has(name)) issues.push({ field: 'joins', message: `"${name}" is not one of your points. Add it above, or correct the spelling.` })
    }
    joins.push([from, to])
  }

  const angles = []
  for (const item of commaList(p.angles)) {
    const eq = item.indexOf('=')
    if (eq < 0) {
      issues.push({ field: 'angles', message: `"${item}" needs an = and a label, for example ABC=40 or ABC=x.` })
      continue
    }
    const names = item.slice(0, eq).trim()
    const text = item.slice(eq + 1).trim()
    // Three single-letter names is how a paper writes it; dashes let a figure
    // use longer names without the notation becoming ambiguous.
    const parts = names.includes('-')
      ? names.split('-').map((s) => s.trim())
      : names.split('')
    if (parts.length !== 3 || parts.some((s) => !s)) {
      issues.push({ field: 'angles', message: `"${names}" must name three points — the two arms and the corner between them, for example ABC (or A-B-C).` })
      continue
    }
    const missing = parts.filter((n) => !pts.has(n))
    if (missing.length) {
      issues.push({ field: 'angles', message: `"${missing[0]}" is not one of your points. Add it above, or correct the spelling.` })
      continue
    }
    angles.push({ from: parts[0], vertex: parts[1], to: parts[2], text })
  }

  // Only when the figure claims to be drawn to scale is the drawn angle a
  // promise. A circle-theorem diagram normally is not, which is why the caption
  // exists — but a teacher who turns it off is telling learners they may
  // measure, and then a 110° mark on a 63° corner is a wrong answer on the page.
  if (!isYes(p.notToScale)) {
    for (const ang of angles) {
      const n = parseFloat(ang.text)
      if (!/^-?\d+(\.\d+)?$/.test(ang.text) || !Number.isFinite(n)) continue
      const drawn = angleAt(pts.get(ang.vertex), pts.get(ang.from), pts.get(ang.to))
      if (Number.isFinite(drawn) && Math.abs(drawn - n) > 2) {
        issues.push({
          field: 'angles',
          message: `You marked ${ang.from}${ang.vertex}${ang.to} as ${n}°, but where the points sit it is drawn as ${Math.round(drawn)}°. Move the points, or switch "Diagram not drawn to scale" back on.`,
        })
      }
    }
  }

  return { pts, joins, angles, tangent, issues }
}

/* ── bearings ────────────────────────────────────────────────────────────── */

/** An arc from north, clockwise, to the leg — always the way a bearing is read. */
function bearingArc(at, bearingDeg, r = 30) {
  const t = ((bearingDeg % 360) + 360) % 360
  const text = `${String(Math.round(t)).padStart(3, '0')}°`
  const mid = (t / 2) * (Math.PI / 180)
  const lx = at[0] + (r + 17) * Math.sin(mid)
  const ly = at[1] - (r + 17) * Math.cos(mid) + 4
  if (t < 0.5 || t > 359.5) return label(lx, ly, text, { size: 12, fill: INK })
  const rad = (t * Math.PI) / 180
  const start = [at[0], at[1] - r]
  const end = [at[0] + r * Math.sin(rad), at[1] - r * Math.cos(rad)]
  // sweep-flag 1 is the positive-angle direction, which with SVG's y pointing
  // down is clockwise on the page — the direction a bearing is measured in.
  return `<path d="M ${f(start[0])},${f(start[1])} A ${r},${r} 0 ${t > 180 ? 1 : 0},1 ${f(end[0])},${f(end[1])}"`
    + ` fill="none" stroke="${INK}" stroke-width="1.5" data-bearing="${f(t)}"/>`
    + label(lx, ly, text, { size: 12, fill: INK })
}

/**
 * Walk the journey in real units, then fit it to the box with ONE scale factor.
 *
 * Scaling the axes separately would fit the drawing more snugly and quietly
 * change every bearing on it, which is the whole content of the question.
 */
function bearingsModel(p) {
  const issues = []
  const legs = []
  const model = new Map()
  const raw = String(p.legs ?? '').split(';').map((s) => s.trim()).filter(Boolean)

  for (const item of raw) {
    const parts = item.split(',').map((s) => s.trim())
    const [pair, bearingRaw, distanceRaw] = parts
    const [from, to] = String(pair ?? '').split('>').map((s) => s.trim())
    if (!from || !to || parts.length < 3) {
      issues.push({ field: 'legs', message: `"${item}" is not a leg. Write each one as from>to, bearing, distance — for example A>B,060,8.` })
      continue
    }
    const bearing = parseFloat(bearingRaw)
    const distance = parseFloat(distanceRaw)
    if (!Number.isFinite(bearing) || bearing < 0 || bearing >= 360) {
      issues.push({ field: 'legs', message: `The bearing on leg ${from}>${to} must be a number from 000 to 359.` })
      continue
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      issues.push({ field: 'legs', message: `The distance on leg ${from}>${to} must be a positive number.` })
      continue
    }
    if (!model.size) model.set(from, [0, 0])
    if (!model.has(from)) {
      issues.push({ field: 'legs', message: `Leg ${from}>${to} starts at "${from}", which no earlier leg reaches. Journeys are drawn in order.` })
      continue
    }
    const rad = (bearing * Math.PI) / 180
    const base = model.get(from)
    // North is -y, and a bearing turns clockwise from it.
    model.set(to, [base[0] + distance * Math.sin(rad), base[1] - distance * Math.cos(rad)])
    legs.push({ from, to, bearing, distance, distanceText: String(distanceRaw ?? '').trim() })
  }
  if (!legs.length) {
    issues.push({ field: 'legs', message: 'Add at least one leg, for example A>B,060,8.' })
  }

  const W = 420, H = 372
  const pad = 46, padTop = NORTH_LEN + 24
  const xs = [...model.values()].map((v) => v[0])
  const ys = [...model.values()].map((v) => v[1])
  const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 0
  const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 0
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1
  const scale = Math.min((W - 2 * pad) / spanX, (H - padTop - pad - 18) / spanY)
  const at = new Map()
  const offX = (W - spanX * scale) / 2 - minX * scale
  const offY = padTop - minY * scale
  for (const [name, v] of model) at.set(name, [offX + v[0] * scale, offY + v[1] * scale])

  return { legs, at, issues }
}

/* ── triangles ───────────────────────────────────────────────────────────── */

/**
 * Build the triangle from whatever angles the teacher stated.
 *
 * Two numeric angles determine the shape exactly, and it is then DRAWN at those
 * angles — a learner measuring a 50° corner reads 50°. One numeric angle still
 * fixes that corner truly and splits the rest evenly, because drawing one
 * stated angle correctly beats drawing none. No numeric angle falls back to a
 * plain scalene shape, which is what an all-symbolic figure wants anyway.
 */
function triangleModel(p) {
  const issues = []
  const read = (v) => {
    const s = String(v ?? '').trim()
    return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null
  }
  const given = { A: read(p.angleA), B: read(p.angleB), C: read(p.angleC) }
  for (const [k, v] of Object.entries(given)) {
    if (v !== null && (v <= 0 || v >= 180)) {
      issues.push({ field: `angle${k}`, message: `An angle in a triangle is between 0° and 180°. Correct the angle at ${k}.` })
      given[k] = null
    }
  }
  const known = Object.entries(given).filter(([, v]) => v !== null)
  const sum = known.reduce((t, [, v]) => t + v, 0)
  if (known.length === 3 && Math.abs(sum - 180) > 0.5) {
    issues.push({ field: 'angleC', message: `The three angles add up to ${Math.round(sum)}°. In a triangle they must add up to 180°.` })
  } else if (known.length === 2 && sum >= 180) {
    issues.push({ field: 'angleB', message: `Those two angles already add up to ${Math.round(sum)}°, leaving nothing for the third. Two angles of a triangle add up to less than 180°.` })
  }

  let alpha, beta
  if (given.A !== null && given.B !== null) {
    alpha = given.A; beta = given.B
  } else if (given.A !== null && given.C !== null) {
    alpha = given.A; beta = 180 - given.A - given.C
  } else if (given.B !== null && given.C !== null) {
    beta = given.B; alpha = 180 - given.B - given.C
  } else if (known.length === 1) {
    const [k, v] = known[0]
    const rest = (180 - v) / 2
    alpha = k === 'A' ? v : rest
    beta = k === 'B' ? v : rest
  } else {
    alpha = 62; beta = 48
  }
  if (!(alpha > 0 && beta > 0 && alpha + beta < 180)) { alpha = 62; beta = 48 }

  // Unit construction with AB along the x axis (y up), then fitted to the box.
  const a = (alpha * Math.PI) / 180, b = (beta * Math.PI) / 180
  const ac = Math.sin(b) / Math.sin(a + b)
  const raw = { A: [0, 0], B: [1, 0], C: [ac * Math.cos(a), ac * Math.sin(a)] }
  const W = 360, H = 300, pad = 52
  const xs = [raw.A[0], raw.B[0], raw.C[0]], ys = [raw.A[1], raw.B[1], raw.C[1]]
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const scale = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad - 14) / (maxY - minY || 1))
  const offX = (W - (maxX - minX) * scale) / 2 - minX * scale
  const offY = (H - 14 - (maxY - minY) * scale) / 2 + maxY * scale
  const put = ([x, y]) => [offX + x * scale, offY - y * scale]
  return { A: put(raw.A), B: put(raw.B), C: put(raw.C), issues }
}

export const DIAGRAM_CATALOG = {
  // ============ SHAPES 2D ============
  triangle: { cat: 'Shapes 2D', name: 'Triangle', defaults: { a: 'A', b: 'B', c: 'C', cap: 'Triangle ABC' }, fields: [['a', 'Vertex A'], ['b', 'Vertex B'], ['c', 'Vertex C'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="160,30 40,200 280,200" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="22" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="30" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text><text x="290" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.c)}</text></svg>` },
  righttriangle: { cat: 'Shapes 2D', name: 'Right Triangle', defaults: { a: 'A', b: 'B', c: 'C', cap: 'Right-angled triangle' }, fields: [['a', 'A'], ['b', 'B'], ['c', 'C'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="60,40 60,200 280,200" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><rect x="60" y="184" width="16" height="16" fill="none" stroke="${col}" stroke-width="1.6"/><text x="50" y="35" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="end" fill="#1c1612">${esc(p.a)}</text><text x="50" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="end" fill="#1c1612">${esc(p.b)}</text><text x="290" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.c)}</text></svg>` },
  square: { cat: 'Shapes 2D', name: 'Square', defaults: { side: 'side', cap: 'Square' }, fields: [['side', 'Side label'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><rect x="40" y="40" width="160" height="160" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="120" y="30" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  rectangle: { cat: 'Shapes 2D', name: 'Rectangle', defaults: { l: 'length', w: 'width', cap: 'Rectangle' }, fields: [['l', 'Length'], ['w', 'Width'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" width="320"><rect x="40" y="40" width="240" height="120" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="30" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.l)}</text><text x="30" y="105" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="end" fill="#3a2f25">${esc(p.w)}</text></svg>` },
  parallelogram: { cat: 'Shapes 2D', name: 'Parallelogram', defaults: { base: 'base', side: 'side', cap: 'Parallelogram' }, fields: [['base', 'Base'], ['side', 'Side'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="80,40 300,40 240,160 20,160" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="180" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.base)}</text><text x="30" y="105" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="end" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  trapezium: { cat: 'Shapes 2D', name: 'Trapezium', defaults: { top: 'a', bottom: 'b', height: 'h', cap: 'Trapezium' }, fields: [['top', 'Top side'], ['bottom', 'Bottom side'], ['height', 'Height'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="80,40 240,40 300,160 20,160" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="32" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.top)}</text><text x="160" y="180" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.bottom)}</text><text x="170" y="105" font-family="Lora,serif" font-style="italic" font-size="14" fill="#3a2f25">${esc(p.height)}</text><line x1="160" y1="40" x2="160" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/></svg>` },
  rhombus: { cat: 'Shapes 2D', name: 'Rhombus', defaults: { side: 'a', cap: 'Rhombus' }, fields: [['side', 'Side'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><polygon points="120,30 220,120 120,210 20,120" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="180" y="65" font-family="Lora,serif" font-style="italic" font-size="14" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  pentagon: { cat: 'Shapes 2D', name: 'Pentagon', defaults: { cap: 'Regular pentagon' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><polygon points="120,30 220,105 180,215 60,215 20,105" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/></svg>` },
  hexagon: { cat: 'Shapes 2D', name: 'Hexagon', defaults: { cap: 'Regular hexagon' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><polygon points="120,30 210,80 210,180 120,230 30,180 30,80" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/></svg>` },
  circle: { cat: 'Shapes 2D', name: 'Circle', defaults: { center: 'O', radius: 'r', cap: 'Circle, centre O' }, fields: [['center', 'Centre'], ['radius', 'Radius'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="120" cy="120" r="90" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><line x1="120" y1="120" x2="210" y2="120" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3"/><circle cx="120" cy="120" r="3.5" fill="#1c1612"/><text x="115" y="115" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="end" fill="#1c1612">${esc(p.center)}</text><text x="165" y="113" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.radius)}</text></svg>` },
  angle: { cat: 'Shapes 2D', name: 'Angle', defaults: { label: 'θ', cap: 'Angle θ' }, fields: [['label', 'Angle label'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 280 220" xmlns="http://www.w3.org/2000/svg" width="280"><line x1="40" y1="180" x2="240" y2="180" stroke="#1c1612" stroke-width="2"/><line x1="40" y1="180" x2="220" y2="50" stroke="#1c1612" stroke-width="2"/><path d="M 90,180 A 50,50 0 0,0 78,150" fill="none" stroke="${col}" stroke-width="2"/><text x="100" y="170" font-family="Lora,serif" font-style="italic" font-size="16" fill="${col}">${esc(p.label)}</text></svg>` },
  triangleangle: { cat: 'Shapes 2D', name: 'Triangle (angle)', defaults: { angle: 'c', a: '', b: '', cc: '', cap: 'Angle marked c' }, fields: [['angle', 'Angle label'], ['a', 'Apex vertex'], ['b', 'Bottom-left vertex'], ['cc', 'Bottom-right vertex'], ['cap', 'Caption']],
    render: (p, col) => {
      // Apex at (160,40); base from (60,200) to (260,200). Angle arc sits at the apex.
      const ax = 160, ay = 40
      // Unit directions from the apex down each side, for the arc + label placement.
      const lLen = Math.hypot(60 - ax, 200 - ay), rLen = Math.hypot(260 - ax, 200 - ay)
      const lUx = (60 - ax) / lLen, lUy = (200 - ay) / lLen
      const rUx = (260 - ax) / rLen, rUy = (200 - ay) / rLen
      const aR = 34
      const arc = `<path d="M ${ax + lUx * aR},${ay + lUy * aR} A ${aR},${aR} 0 0,1 ${ax + rUx * aR},${ay + rUy * aR}" fill="none" stroke="${col}" stroke-width="2"/>`
      const lblX = ax + (lUx + rUx) / 2 * (aR + 22), lblY = ay + (lUy + rUy) / 2 * (aR + 22) + 5
      const vtx = (x, y, anchor, t) => t ? `<text x="${x}" y="${y}" font-family="Lora,serif" font-size="15" font-weight="700" text-anchor="${anchor}" fill="#1c1612">${esc(t)}</text>` : ''
      return `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="${ax},${ay} 60,200 260,200" fill="${col}" fill-opacity=".1" stroke="#1c1612" stroke-width="2.2"/>${arc}<text x="${lblX}" y="${lblY}" font-family="Lora,serif" font-style="italic" font-size="16" font-weight="700" text-anchor="middle" fill="${col}">${esc(p.angle)}</text>${vtx(ax, ay - 8, 'middle', p.a)}${vtx(50, 214, 'end', p.b)}${vtx(270, 214, 'start', p.cc)}</svg>`
    } },
  parallelogramh: { cat: 'Shapes 2D', name: 'Parallelogram (base × height)', defaults: { base: 'b', height: 'h', cap: 'Parallelogram' }, fields: [['base', 'Base'], ['height', 'Height'], ['cap', 'Caption']],
    render: (p, col) => {
      // Slanted parallelogram; dashed perpendicular (vertical) height to the base.
      // Outline: TL(110,50) TR(290,50) BR(230,180) BL(50,180). The base is
      // horizontal (y=180) so the height is a vertical drop; right-angle marker
      // at the foot. footX=150 sits under the top edge (110..290) and on the
      // base segment (50..230).
      const footX = 150, topY = 50, baseY = 180
      return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="110,50 290,50 230,180 50,180" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><line x1="${footX}" y1="${topY}" x2="${footX}" y2="${baseY}" stroke="${col}" stroke-width="1.4" stroke-dasharray="4 3"/><rect x="${footX}" y="${baseY - 14}" width="14" height="14" fill="none" stroke="${col}" stroke-width="1.3"/><text x="140" y="${baseY + 22}" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.base)}</text><text x="${footX + 8}" y="120" font-family="Lora,serif" font-style="italic" font-size="14" fill="#3a2f25">${esc(p.height)}</text></svg>`
    } },

  clockface: { cat: 'Shapes 2D', name: 'Clock face', defaults: { hour: '3', minute: '00', cap: 'Clock face' }, fields: [['hour', 'Hour (1-12)'], ['minute', 'Minute (0-59)'], ['cap', 'Caption']],
    render: (p, col) => {
      // Analogue clock for "tell the time" questions. Everything is computed
      // from the numeric hour/minute (no author text is rendered) so labels
      // can't inject markup — hour/minute parse to numbers and fall back to a
      // sensible time when blank.
      const H = (((parseInt(p.hour, 10) % 12) + 12) % 12)
      const Mraw = parseInt(p.minute, 10)
      const M = Number.isFinite(Mraw) ? (((Mraw % 60) + 60) % 60) : 0
      const cx = 120, cy = 120, R = 92
      const pt = (deg, len) => [cx + len * Math.sin(deg * Math.PI / 180), cy - len * Math.cos(deg * Math.PI / 180)]
      let ticks = ''
      for (let i = 0; i < 60; i++) {
        const isHour = i % 5 === 0
        const [x1, y1] = pt(i * 6, R - 3)
        const [x2, y2] = pt(i * 6, R - (isHour ? 12 : 7))
        ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#1c1612" stroke-width="${isHour ? 1.6 : 0.7}"/>`
      }
      let nums = ''
      for (let i = 1; i <= 12; i++) {
        const [x, y] = pt(i * 30, R - 22)
        nums += `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-family="Lora,serif" font-size="15" font-weight="700" text-anchor="middle" fill="#1c1612">${i}</text>`
      }
      const [hx, hy] = pt((H + M / 60) * 30, R - 42)
      const [mx, my] = pt(M * 6, R - 18)
      return `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" stroke="${col}" stroke-width="2.4"/>${ticks}${nums}<line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#1c1612" stroke-width="4" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="4" fill="#1c1612"/></svg>`
    } },
  protractor: { cat: 'Shapes 2D', name: 'Protractor (angle)', defaults: { angle: '60', cap: 'Angle measured on a protractor' }, fields: [['angle', 'Angle (degrees)'], ['cap', 'Caption']],
    render: (p, col) => {
      // An angle shown on a half-disc protractor, read from the right-hand base
      // (0°) round to the left (180°). Both the arm and the label use the same
      // parsed-and-clamped numeric angle, so no raw author text is rendered.
      const deg = parseFloat(p.angle)
      const a = Number.isFinite(deg) ? Math.max(0, Math.min(180, deg)) : 60
      const cx = 150, cy = 150, R = 116
      const at = (d, r) => [cx + r * Math.cos(d * Math.PI / 180), cy - r * Math.sin(d * Math.PI / 180)]
      let ticks = ''
      for (let d = 0; d <= 180; d += 10) {
        const major = d % 30 === 0
        const [x1, y1] = at(d, R)
        const [x2, y2] = at(d, R - (major ? 14 : 8))
        ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${major ? 1.4 : 0.8}"/>`
        if (major) {
          const [lx, ly] = at(d, R - 26)
          ticks += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" font-family="Lora,serif" font-size="10" text-anchor="middle" fill="#3a2f25">${d}</text>`
        }
      }
      const [lx, ly] = at(180, R), [rx, ry] = at(0, R)
      const [ax, ay] = at(a, R)
      const [arc0x, arc0y] = at(0, 38), [arcAx, arcAy] = at(a, 38)
      const largeArc = a > 180 ? 1 : 0
      const [lblx, lbly] = at(a / 2, 60)
      // Label with the SAME normalised angle the arm is drawn at (a), not the
      // raw param — so "60°" can't become "60°°" and a clamped arm (200 → 180)
      // never contradicts its label. `a` is numeric, so it needs no escaping.
      const aLabel = Number.isInteger(a) ? a : +a.toFixed(1)
      return `<svg viewBox="0 0 300 184" xmlns="http://www.w3.org/2000/svg" width="300"><path d="M ${lx.toFixed(1)},${ly} A ${R},${R} 0 0,1 ${rx.toFixed(1)},${ry} Z" fill="${col}" fill-opacity=".07" stroke="${col}" stroke-width="2"/>${ticks}<line x1="${cx}" y1="${cy}" x2="${rx.toFixed(1)}" y2="${ry}" stroke="#1c1612" stroke-width="2.2"/><line x1="${cx}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="#1c1612" stroke-width="2.2"/><path d="M ${arc0x.toFixed(1)},${arc0y.toFixed(1)} A 38,38 0 ${largeArc},0 ${arcAx.toFixed(1)},${arcAy.toFixed(1)}" fill="none" stroke="#1c1612" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#1c1612"/><text x="${lblx.toFixed(1)}" y="${lbly.toFixed(1)}" font-family="Lora,serif" font-style="italic" font-size="15" font-weight="700" text-anchor="middle" fill="${col}">${aLabel}°</text></svg>`
    } },

  // ============ SHAPES 3D ============
  cube: { cat: 'Shapes 3D', name: 'Cube', defaults: { side: 'a', cap: 'Cube' }, fields: [['side', 'Side label'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 260 240" xmlns="http://www.w3.org/2000/svg" width="260"><polygon points="40,80 160,80 220,40 100,40" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><polygon points="160,80 220,40 220,160 160,200" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><polygon points="40,80 160,80 160,200 40,200" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="2"/><line x1="40" y1="80" x2="100" y2="40" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="40" x2="100" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="40" y1="200" x2="100" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="160" x2="220" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="100" y="225" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  cuboid: { cat: 'Shapes 3D', name: 'Cuboid', defaults: { l: 'l', w: 'w', h: 'h', cap: 'Cuboid' }, fields: [['l', 'Length'], ['w', 'Width'], ['h', 'Height'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="40,80 200,80 260,40 100,40" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><polygon points="200,80 260,40 260,180 200,220" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><polygon points="40,80 200,80 200,220 40,220" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="2"/><line x1="40" y1="80" x2="100" y2="40" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="40" x2="100" y2="180" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="40" y1="220" x2="100" y2="180" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="180" x2="260" y2="180" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="120" y="240" font-family="Lora,serif" font-style="italic" font-size="13" text-anchor="middle" fill="#3a2f25">${esc(p.l)}</text><text x="280" y="120" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.h)}</text><text x="230" y="50" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.w)}</text></svg>` },
  cylinder: { cat: 'Shapes 3D', name: 'Cylinder', defaults: { r: 'r', h: 'h', cap: 'Cylinder' }, fields: [['r', 'Radius'], ['h', 'Height'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 220 280" xmlns="http://www.w3.org/2000/svg" width="220"><ellipse cx="110" cy="50" rx="80" ry="20" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><line x1="30" y1="50" x2="30" y2="230" stroke="${col}" stroke-width="2"/><line x1="190" y1="50" x2="190" y2="230" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,0 190,230" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,1 190,230" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="110" y="46" font-family="Lora,serif" font-style="italic" font-size="13" text-anchor="middle" fill="#1c1612">${esc(p.r)}</text><text x="200" y="140" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.h)}</text></svg>` },
  cone: { cat: 'Shapes 3D', name: 'Cone', defaults: { r: 'r', h: 'h', cap: 'Cone' }, fields: [['r', 'Radius'], ['h', 'Height'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 220 280" xmlns="http://www.w3.org/2000/svg" width="220"><line x1="110" y1="30" x2="30" y2="230" stroke="${col}" stroke-width="2"/><line x1="110" y1="30" x2="190" y2="230" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,0 190,230" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,1 190,230" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="110" y1="30" x2="110" y2="230" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="120" y="135" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.h)}</text><text x="150" y="245" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.r)}</text></svg>` },
  sphere: { cat: 'Shapes 3D', name: 'Sphere', defaults: { r: 'r', cap: 'Sphere' }, fields: [['r', 'Radius'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="120" cy="120" r="90" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><ellipse cx="120" cy="120" rx="90" ry="25" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="120" y1="120" x2="210" y2="120" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3"/><circle cx="120" cy="120" r="3" fill="#1c1612"/><text x="160" y="113" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.r)}</text></svg>` },

  // ============ GRAPHS ============
  numberline: { cat: 'Graphs', name: 'Number Line', defaults: { min: '-5', max: '5', step: '1', highlight: '0', cap: 'Number line' }, fields: [['min', 'Min'], ['max', 'Max'], ['step', 'Step'], ['highlight', 'Highlight'], ['cap', 'Caption']],
    render: (p, col) => {
      const min = parseFloat(p.min), max = parseFloat(p.max), step = parseFloat(p.step) || 1, w = 540, m = 30, axisY = 50
      const inX = v => m + ((v - min) / (max - min)) * (w - 2 * m)
      let ticks = ''
      for (let v = min; v <= max + 0.0001; v += step) {
        const x = inX(v)
        ticks += `<line x1="${x}" y1="${axisY - 7}" x2="${x}" y2="${axisY + 7}" stroke="#1c1612" stroke-width="1.2"/><text x="${x}" y="${axisY + 24}" font-family="Lora,serif" font-size="12" text-anchor="middle" fill="#1c1612">${+v.toFixed(2)}</text>`
      }
      const h = parseFloat(p.highlight)
      const hl = (!isNaN(h) && h >= min && h <= max) ? `<circle cx="${inX(h)}" cy="${axisY}" r="6" fill="${col}"/>` : ''
      return `<svg viewBox="0 0 ${w} 90" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${m - 4}" y1="${axisY}" x2="${w - m + 4}" y2="${axisY}" stroke="#1c1612" stroke-width="1.6"/><polygon points="${m - 10},${axisY} ${m - 4},${axisY - 5} ${m - 4},${axisY + 5}" fill="#1c1612"/><polygon points="${w - m + 10},${axisY} ${w - m + 4},${axisY - 5} ${w - m + 4},${axisY + 5}" fill="#1c1612"/>${ticks}${hl}</svg>`
    } },
  numberlinejump: { cat: 'Graphs', name: 'Number Line (jumps)', defaults: { min: '-5', max: '5', step: '1', jumps: '-3>2,2>-1', cap: 'Number line jumps' }, fields: [['min', 'Min'], ['max', 'Max'], ['step', 'Step'], ['jumps', 'Jumps e.g. -3>2,2>5'], ['cap', 'Caption']],
    render: (p, col) => {
      // Integer arithmetic shown as directional hops over a number line, e.g.
      // start at -3, jump +5 to land on 2. `jumps` is a comma list of "from>to"
      // pairs using values on the line. The axis sits low so arcs have room
      // above; deltas (+5 / -3) are computed from the numeric endpoints so no
      // author text is rendered (ticks + deltas are all numeric → injection-safe).
      const min = parseFloat(p.min), max = parseFloat(p.max), step = parseFloat(p.step) || 1
      const w = 540, m = 30, axisY = 110
      const inX = v => m + ((v - min) / (max - min)) * (w - 2 * m)
      let ticks = ''
      for (let v = min; v <= max + 0.0001; v += step) {
        const x = inX(v)
        ticks += `<line x1="${x}" y1="${axisY - 7}" x2="${x}" y2="${axisY + 7}" stroke="#1c1612" stroke-width="1.2"/><text x="${x}" y="${axisY + 24}" font-family="Lora,serif" font-size="12" text-anchor="middle" fill="#1c1612">${+v.toFixed(2)}</text>`
      }
      const jumps = String(p.jumps ?? '').split(',').map(s => s.trim()).filter(Boolean)
      let arcs = ''
      const dots = new Set()
      for (const jump of jumps) {
        const [a, b] = jump.split('>').map(s => parseFloat(s))
        if (isNaN(a) || isNaN(b) || a < min || a > max || b < min || b > max) continue
        const x1 = inX(a), x2 = inX(b), midX = (x1 + x2) / 2
        const apexY = axisY - Math.min(80, 28 + Math.abs(x2 - x1) * 0.32)
        arcs += `<path d="M ${x1},${axisY} Q ${midX},${apexY} ${x2},${axisY}" fill="none" stroke="${col}" stroke-width="2"/>`
        // Arrowhead landing on the axis at the destination.
        arcs += `<polygon points="${x2},${axisY} ${x2 - 5},${axisY - 9} ${x2 + 5},${axisY - 9}" fill="${col}"/>`
        const d = b - a
        const label = (d >= 0 ? '+' : '-') + (+Math.abs(d).toFixed(2))
        arcs += `<text x="${midX}" y="${apexY - 5}" font-family="Lora,serif" font-size="13" font-weight="700" text-anchor="middle" fill="${col}">${label}</text>`
        dots.add(a); dots.add(b)
      }
      const dotSvg = [...dots].map(v => `<circle cx="${inX(v)}" cy="${axisY}" r="5" fill="#1c1612"/>`).join('')
      return `<svg viewBox="0 0 ${w} 150" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${m - 4}" y1="${axisY}" x2="${w - m + 4}" y2="${axisY}" stroke="#1c1612" stroke-width="1.6"/><polygon points="${m - 10},${axisY} ${m - 4},${axisY - 5} ${m - 4},${axisY + 5}" fill="#1c1612"/><polygon points="${w - m + 10},${axisY} ${w - m + 4},${axisY - 5} ${w - m + 4},${axisY + 5}" fill="#1c1612"/>${ticks}${arcs}${dotSvg}</svg>`
    } },
  coordgrid: { cat: 'Graphs', name: 'Coordinate Grid', defaults: { range: '5', cap: 'Cartesian plane' }, fields: [['range', 'Range (±)'], ['cap', 'Caption']],
    render: (p, _col) => {
      const r = parseInt(p.range, 10) || 5, size = 320, m = 20, ax = (size - 2 * m) / (2 * r)
      let lines = ''
      for (let i = -r; i <= r; i++) {
        const x = m + (i + r) * ax, y = m + (i + r) * ax
        const stroke = i === 0 ? '#1c1612' : '#d9cfbe', sw = i === 0 ? 1.6 : 0.8
        lines += `<line x1="${x}" y1="${m}" x2="${x}" y2="${size - m}" stroke="${stroke}" stroke-width="${sw}"/><line x1="${m}" y1="${y}" x2="${size - m}" y2="${y}" stroke="${stroke}" stroke-width="${sw}"/>`
        if (i !== 0) lines += `<text x="${m + (i + r) * ax}" y="${m + r * ax + 14}" font-family="Lora,serif" font-size="10" text-anchor="middle" fill="#3a2f25">${i}</text><text x="${m + r * ax - 6}" y="${m + (r - i) * ax + 4}" font-family="Lora,serif" font-size="10" text-anchor="end" fill="#3a2f25">${i}</text>`
      }
      return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" width="${size}">${lines}<text x="${size - 14}" y="${m + r * ax - 6}" font-family="Lora,serif" font-style="italic" font-size="13" fill="#1c1612">x</text><text x="${m + r * ax + 8}" y="${m + 12}" font-family="Lora,serif" font-style="italic" font-size="13" fill="#1c1612">y</text></svg>`
    } },
  fractionbar: { cat: 'Graphs', name: 'Fraction Bar', defaults: { parts: '4', shaded: '3', cap: '3/4' }, fields: [['parts', 'Total parts'], ['shaded', 'Shaded'], ['cap', 'Caption']],
    render: (p, col) => {
      const parts = Math.max(1, parseInt(p.parts, 10) || 1)
      const shaded = Math.min(parts, Math.max(0, parseInt(p.shaded, 10) || 0))
      const w = 480, h = 80, pw = w / parts
      let bars = ''
      for (let i = 0; i < parts; i++) bars += `<rect x="${i * pw}" y="0" width="${pw}" height="${h}" fill="${i < shaded ? col : '#fff'}" fill-opacity="${i < shaded ? '.55' : '1'}" stroke="${col}" stroke-width="2"/>`
      return `<svg viewBox="0 0 ${w} ${h + 30}" xmlns="http://www.w3.org/2000/svg" width="${w}">${bars}<text x="${w / 2}" y="${h + 24}" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${shaded} / ${parts}</text></svg>`
    } },
  barchart: { cat: 'Graphs', name: 'Bar Chart', defaults: { labels: 'Mon,Tue,Wed,Thu,Fri', values: '12,18,9,15,21', cap: 'Bar chart' }, fields: [['labels', 'Labels'], ['values', 'Values'], ['cap', 'Caption']],
    render: (p, col) => {
      const labels = p.labels.split(',').map(s => s.trim())
      const values = p.values.split(',').map(s => parseFloat(s) || 0)
      const w = 460, h = 250, padL = 46, padR = 22, padT = 22, padB = 40
      const plotW = w - padL - padR, plotH = h - padT - padB, baseY = h - padB
      const { top, ticks } = niceAxisTicks(Math.max(...values, 1))
      const yOf = v => baseY - (v / top) * plotH
      let grid = ''
      ticks.forEach(t => {
        const y = yOf(t)
        if (t !== 0) grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#e4dccd" stroke-width="1"/>`
        grid += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" font-family="Lora,serif" font-size="11" text-anchor="end" fill="#3a2f25">${t}</text>`
      })
      const slot = plotW / values.length, bw = slot * 0.6
      let bars = ''
      values.forEach((v, i) => {
        const x = padL + i * slot + (slot - bw) / 2, y = yOf(v)
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(baseY - y).toFixed(1)}" fill="${col}" fill-opacity=".75"/><text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">${v}</text><text x="${(x + bw / 2).toFixed(1)}" y="${baseY + 16}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#3a2f25">${esc(labels[i] || '')}</text>`
      })
      return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" width="${w}">${grid}<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${baseY}" stroke="#1c1612" stroke-width="1.2"/><line x1="${padL}" y1="${baseY}" x2="${w - padR}" y2="${baseY}" stroke="#1c1612" stroke-width="1.2"/>${bars}</svg>`
    } },
  piechart: { cat: 'Graphs', name: 'Pie Chart', defaults: { labels: 'A,B,C,D', values: '30,25,20,25', cap: 'Pie chart' }, fields: [['labels', 'Labels'], ['values', 'Values'], ['cap', 'Caption']],
    render: (p, col) => {
      const labels = p.labels.split(',').map(s => s.trim())
      const values = p.values.split(',').map(s => parseFloat(s) || 0)
      const total = values.reduce((a, b) => a + b, 0) || 1
      const cx = 140, cy = 140, r = 100
      const palette = [col, '#b8492a', '#c89a3a', '#365314', '#581c87', '#1e3a8a', '#831843']
      let angle = -Math.PI / 2, slices = ''
      values.forEach((v, i) => {
        const a2 = angle + (v / total) * 2 * Math.PI
        const large = (a2 - angle) > Math.PI ? 1 : 0
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
        const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
        const mid = (angle + a2) / 2
        slices += `<path d="M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${palette[i % palette.length]}" fill-opacity=".75" stroke="#fff" stroke-width="2"/>`
        const lx = cx + (r + 18) * Math.cos(mid), ly = cy + (r + 18) * Math.sin(mid)
        slices += `<text x="${lx}" y="${ly + 4}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">${esc(labels[i] || '')}</text>`
        angle = a2
      })
      return `<svg viewBox="0 0 280 290" xmlns="http://www.w3.org/2000/svg" width="280">${slices}</svg>`
    } },
  linegraph: { cat: 'Graphs', name: 'Line Graph', defaults: { labels: 'Mon,Tue,Wed,Thu,Fri', values: '5,8,6,12,10', cap: 'Line graph' }, fields: [['labels', 'X labels'], ['values', 'Y values'], ['cap', 'Caption']],
    render: (p, col) => {
      const labels = p.labels.split(',').map(s => s.trim())
      const values = p.values.split(',').map(s => parseFloat(s) || 0)
      const w = 460, h = 250, padL = 46, padR = 22, padT = 22, padB = 40
      const plotW = w - padL - padR, plotH = h - padT - padB, baseY = h - padB
      const { top, ticks } = niceAxisTicks(Math.max(...values, 1))
      const yOf = v => baseY - (v / top) * plotH
      const xStep = plotW / (values.length - 1 || 1)
      const xOf = i => padL + i * xStep
      let grid = ''
      ticks.forEach(t => {
        const y = yOf(t)
        if (t !== 0) grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#e4dccd" stroke-width="1"/>`
        grid += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" font-family="Lora,serif" font-size="11" text-anchor="end" fill="#3a2f25">${t}</text>`
      })
      const points = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
      const dots = values.map((v, i) => `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="4" fill="${col}"/>`).join('')
      const xlabs = labels.map((l, i) => `<text x="${xOf(i).toFixed(1)}" y="${baseY + 16}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#3a2f25">${esc(l)}</text>`).join('')
      return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" width="${w}">${grid}<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${baseY}" stroke="#1c1612" stroke-width="1.2"/><line x1="${padL}" y1="${baseY}" x2="${w - padR}" y2="${baseY}" stroke="#1c1612" stroke-width="1.2"/><polyline points="${points}" fill="none" stroke="${col}" stroke-width="2.5"/>${dots}${xlabs}</svg>`
    } },
  venn2: { cat: 'Graphs', name: '2-Set Venn', defaults: { a: 'Set A', b: 'Set B', cap: 'Venn diagram' }, fields: [['a', 'Set A'], ['b', 'Set B'], ['cap', 'Caption']],
    render: (p, c) => `<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg" width="360"><circle cx="135" cy="110" r="80" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="2"/><circle cx="225" cy="110" r="80" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="2"/><text x="90" y="115" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="270" y="115" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text><text x="180" y="115" font-family="Lora,serif" font-size="14" font-weight="600" text-anchor="middle" fill="#1c1612">A∩B</text></svg>` },
  venn3: { cat: 'Graphs', name: '3-Set Venn', defaults: { a: 'A', b: 'B', c: 'C', cap: 'Venn of three sets' }, fields: [['a', 'Set A'], ['b', 'Set B'], ['c', 'Set C'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" width="360"><circle cx="140" cy="130" r="80" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/><circle cx="220" cy="130" r="80" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/><circle cx="180" cy="200" r="80" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/><text x="80" y="100" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="280" y="100" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text><text x="180" y="290" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.c)}</text></svg>` },
  vennelements: { cat: 'Graphs', name: 'Venn (with elements)', defaults: { a: 'A', b: 'B', onlyA: '', both: '', onlyB: '', outside: '', cap: 'Venn diagram' }, fields: [['a', 'Set A name'], ['b', 'Set B name'], ['onlyA', 'In A only'], ['both', 'In A∩B'], ['onlyB', 'In B only'], ['outside', 'Outside both'], ['cap', 'Caption']],
    render: (p, c) => {
      // Two overlapping circles inside a universal-set rectangle. Elements are
      // comma-separated; each region's items wrap onto stacked <tspan> rows so a
      // handful of numbers stay readable. Region anchors: A-only ~x95, A∩B ~x180,
      // B-only ~x265, outside near the top-left corner of the rectangle.
      const rows = (raw, cx, cy, anchor) => {
        const items = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
        if (!items.length) return ''
        const lh = 16, startY = cy - ((items.length - 1) * lh) / 2
        const spans = items.map((it, i) => `<tspan x="${cx}" y="${startY + i * lh}">${esc(it)}</tspan>`).join('')
        return `<text font-family="Lora,serif" font-size="13" text-anchor="${anchor}" fill="#1c1612">${spans}</text>`
      }
      return `<svg viewBox="0 0 360 250" xmlns="http://www.w3.org/2000/svg" width="360"><rect x="8" y="8" width="344" height="234" rx="6" fill="none" stroke="#1c1612" stroke-width="1.4"/><text x="20" y="26" font-family="Lora,serif" font-size="13" font-weight="700" fill="#1c1612">E</text><circle cx="140" cy="125" r="85" fill="${c}" fill-opacity=".16" stroke="${c}" stroke-width="2"/><circle cx="230" cy="125" r="85" fill="${c}" fill-opacity=".16" stroke="${c}" stroke-width="2"/><text x="78" y="55" font-family="Lora,serif" font-size="15" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="292" y="55" font-family="Lora,serif" font-size="15" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text>${rows(p.onlyA, 95, 125, 'middle')}${rows(p.both, 185, 125, 'middle')}${rows(p.onlyB, 275, 125, 'middle')}${rows(p.outside, 36, 60, 'start')}</svg>`
    } },

  // ============ CIRCLE GEOMETRY ============
  //
  // One parametric figure covers the whole family — angle at the centre, angles
  // in the same segment, cyclic quadrilaterals, tangent and radius, the
  // alternate segment — because on paper they ARE one figure: a circle, some
  // named points on it, some lines between them, and the angles the question
  // turns on. Six near-identical catalog entries would have been six places to
  // fix the same bug.
  circletheorem: {
    cat: 'Circle Geometry',
    name: 'Circle theorem',
    defaults: {
      centre: 'O',
      points: 'A@160,B@60,C@300',
      joins: 'O-A,O-C,A-B,B-C',
      angles: 'AOC=110,ABC=x',
      tangent: '',
      notToScale: 'yes',
      cap: 'Circle with centre O',
    },
    fields: [
      ['centre', 'Centre label'],
      ['points', 'Points on the circle, e.g. A@160,B@60,C@300 (degrees anticlockwise from 3 o\'clock)'],
      ['joins', 'Lines to draw, e.g. O-A,A-B,B-C'],
      ['angles', 'Angles to mark, e.g. AOC=110,ABC=x'],
      ['tangent', 'Tangent at a point, e.g. C:T,U (names its two ends)'],
      ['notToScale', 'Print "Diagram not drawn to scale" (yes/no)'],
      ['cap', 'Caption'],
    ],
    validate: (p) => circleTheoremModel(p).issues,
    render: (p, col) => {
      const W = 360, H = 336
      const { pts, joins, angles, tangent } = circleTheoremModel(p)
      const cx = CIRCLE_CX, cy = CIRCLE_CY, R = CIRCLE_R
      let out = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="2.2"/>`
      if (tangent) {
        out += `<line x1="${f(tangent.a[0])}" y1="${f(tangent.a[1])}" x2="${f(tangent.b[0])}" y2="${f(tangent.b[1])}"`
          + ` stroke="${col}" stroke-width="2.2" data-tangent="${esc(tangent.at)}"/>`
      }
      for (const [from, to] of joins) {
        const a = pts.get(from), b = pts.get(to)
        if (!a || !b) continue
        out += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"`
          + ` stroke="${INK}" stroke-width="1.9" data-join="${esc(from)}${esc(to)}"/>`
      }
      for (const ang of angles) {
        const v = pts.get(ang.vertex), a = pts.get(ang.from), b = pts.get(ang.to)
        if (!v || !a || !b) continue
        // A smaller arc at the centre keeps it clear of the two radii's labels.
        out += angleMark(v, a, b, degText(ang.text), { r: ang.vertex === pts.centreName ? 30 : 24, col: INK })
      }
      for (const [name, pt] of pts) {
        const isCentre = name === pts.centreName
        out += `<circle cx="${f(pt[0])}" cy="${f(pt[1])}" r="${isCentre ? 3.6 : 3.2}" fill="${INK}" data-point="${esc(name)}"/>`
        // Push the name away from the middle of the figure so it never sits on
        // a chord — the direction is the point's own, so a figure with points
        // anywhere round the circle still reads.
        const dx = pt[0] - cx, dy = pt[1] - cy
        const m = Math.hypot(dx, dy) || 1
        const off = isCentre ? 0 : 17
        out += label(pt[0] + (isCentre ? -10 : (dx / m) * off), pt[1] + (isCentre ? -9 : (dy / m) * off + 5),
          name, { size: 15, anchor: isCentre ? 'end' : 'middle' })
      }
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="${W}">`
        + `${out}${notToScaleNote(W, H, isYes(p.notToScale))}</svg>`
    },
  },

  // ============ BEARINGS ============
  bearings: {
    cat: 'Bearings',
    name: 'Bearings journey',
    defaults: {
      legs: 'A>B,060,8;B>C,135,6',
      unit: 'km',
      notToScale: 'no',
      cap: 'Bearings journey',
    },
    fields: [
      ['legs', 'Legs, e.g. A>B,060,8;B>C,135,6 (from>to, bearing, distance)'],
      ['unit', 'Distance unit'],
      ['notToScale', 'Print "Diagram not drawn to scale" (yes/no)'],
      ['cap', 'Caption'],
    ],
    validate: (p) => bearingsModel(p).issues,
    render: (p, col) => {
      const W = 420, H = 372
      const { legs, at } = bearingsModel(p)
      const unit = String(p.unit ?? '').trim()
      let out = ''
      const starts = new Set()
      for (const leg of legs) {
        const a = at.get(leg.from), b = at.get(leg.to)
        if (!a || !b) continue
        if (!starts.has(leg.from)) {
          starts.add(leg.from)
          // The north line is what makes a bearing readable: every angle on the
          // page is measured from it, so it is drawn at every point a leg
          // leaves from, not just the first.
          const top = [a[0], a[1] - NORTH_LEN]
          out += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(top[0])}" y2="${f(top[1] + 8)}"`
            + ` stroke="${SOFT_INK}" stroke-width="1.3" stroke-dasharray="5 4" data-north="${esc(leg.from)}"/>`
            + arrowHead([a[0], a[1] - 20], top, { size: 8, fill: SOFT_INK })
            + label(a[0], top[1] - 6, 'N', { size: 12, fill: SOFT_INK })
        }
        out += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"`
          + ` stroke="${col}" stroke-width="2.2" data-leg="${esc(leg.from)}${esc(leg.to)}"/>`
          + arrowHead(a, b, { size: 9, fill: col })
        out += bearingArc(a, leg.bearing)
        // The distance sits beside its own leg, on the side away from the turn.
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
        const text = unit ? `${leg.distanceText} ${unit}` : leg.distanceText
        out += label(mx + nx * 15, my + ny * 15 + 4, text, { size: 12, weight: '600', fill: SOFT_INK })
      }
      for (const [name, pt] of at) {
        out += `<circle cx="${f(pt[0])}" cy="${f(pt[1])}" r="4" fill="${INK}" data-point="${esc(name)}"/>`
          + label(pt[0] + 13, pt[1] + 16, name, { size: 15 })
      }
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="${W}">`
        + `${out}${notToScaleNote(W, H, isYes(p.notToScale))}</svg>`
    },
  },

  // ============ TRIGONOMETRY ============
  elevation: {
    cat: 'Trigonometry',
    name: 'Angle of elevation / depression',
    defaults: {
      angle: '35',
      mode: 'elevation',
      observer: 'A',
      object: 'B',
      base: '50 m',
      height: 'h',
      notToScale: 'no',
      cap: 'Angle of elevation',
    },
    fields: [
      ['angle', 'Angle (degrees)'],
      ['mode', 'elevation or depression'],
      ['observer', 'Observer label'],
      ['object', 'Object label'],
      ['base', 'Horizontal distance label'],
      ['height', 'Vertical label'],
      ['notToScale', 'Print "Diagram not drawn to scale" (yes/no)'],
      ['cap', 'Caption'],
    ],
    validate: (p) => {
      const a = parseFloat(p.angle)
      if (!Number.isFinite(a)) {
        return [{ field: 'angle', message: 'Give the angle as a number of degrees, for example 35.' }]
      }
      if (a <= 0 || a >= 90) {
        return [{ field: 'angle', message: 'An angle of elevation or depression is between 0° and 90°. Enter a value in that range.' }]
      }
      return []
    },
    render: (p, col) => {
      const W = 400, H = 300
      const depression = /depress/i.test(String(p.mode ?? ''))
      const theta = Math.max(3, Math.min(87, nOr(p.angle, 35)))
      const rad = (theta * Math.PI) / 180
      // Fit the true triangle into the box: start from the widest base that
      // fits, and shrink it if the resulting height would not.
      let base = 260, rise = base * Math.tan(rad)
      if (rise > 176) { rise = 176; base = rise / Math.tan(rad) }
      const left = 60, groundY = depression ? 40 + rise : 216
      const obs = depression ? [left, 40] : [left, groundY]
      const foot = [left + base, groundY]
      const top = depression ? [left + base, 40 + rise] : [left + base, groundY - rise]
      const horizEnd = depression ? [left + base + 26, 40] : foot
      let out = ''
      // Ground / horizontal reference. In depression the horizontal through the
      // observer is the dashed one the angle is measured from; the ground is
      // solid underneath.
      if (depression) {
        out += `<line x1="${f(obs[0])}" y1="${f(obs[1])}" x2="${f(horizEnd[0])}" y2="${f(obs[1])}"`
          + ` stroke="${SOFT_INK}" stroke-width="1.4" stroke-dasharray="6 4" data-horizontal="1"/>`
        out += `<line x1="${f(obs[0] - 26)}" y1="${f(groundY)}" x2="${f(foot[0] + 30)}" y2="${f(groundY)}"`
          + ` stroke="${INK}" stroke-width="2" data-ground="1"/>`
        out += `<line x1="${f(obs[0])}" y1="${f(obs[1])}" x2="${f(obs[0])}" y2="${f(groundY)}"`
          + ` stroke="${col}" stroke-width="2.2" data-vertical="1"/>`
        out += `<line x1="${f(obs[0])}" y1="${f(obs[1])}" x2="${f(top[0])}" y2="${f(top[1])}"`
          + ` stroke="${INK}" stroke-width="1.9" data-sightline="1"/>`
        out += angleMark(obs, horizEnd, top, degText(theta), { r: 40, col: INK })
        out += `<circle cx="${f(obs[0])}" cy="${f(obs[1])}" r="3.6" fill="${INK}" data-point="observer"/>`
        out += `<circle cx="${f(top[0])}" cy="${f(top[1])}" r="3.6" fill="${INK}" data-point="object"/>`
        out += label(obs[0] - 12, obs[1] - 6, p.observer, { size: 15, anchor: 'end' })
        out += label(top[0] + 12, top[1] + 5, p.object, { size: 15, anchor: 'start' })
        out += label((obs[0] + top[0]) / 2, groundY + 20, p.base, { size: 13, weight: '600', italic: true, fill: SOFT_INK })
        out += label(obs[0] - 10, (obs[1] + groundY) / 2, p.height, { size: 13, weight: '600', italic: true, anchor: 'end', fill: SOFT_INK })
      } else {
        out += `<line x1="${f(obs[0] - 26)}" y1="${f(groundY)}" x2="${f(foot[0] + 30)}" y2="${f(groundY)}"`
          + ` stroke="${INK}" stroke-width="2" data-ground="1"/>`
        out += `<line x1="${f(foot[0])}" y1="${f(foot[1])}" x2="${f(top[0])}" y2="${f(top[1])}"`
          + ` stroke="${col}" stroke-width="2.2" data-vertical="1"/>`
        out += `<line x1="${f(obs[0])}" y1="${f(obs[1])}" x2="${f(top[0])}" y2="${f(top[1])}"`
          + ` stroke="${INK}" stroke-width="1.9" data-sightline="1"/>`
        out += angleMark(obs, foot, top, degText(theta), { r: 40, col: INK })
        out += angleMark(foot, obs, top, '', { r: 13, col: INK, square: true })
        out += `<circle cx="${f(obs[0])}" cy="${f(obs[1])}" r="3.6" fill="${INK}" data-point="observer"/>`
        out += `<circle cx="${f(top[0])}" cy="${f(top[1])}" r="3.6" fill="${INK}" data-point="object"/>`
        out += label(obs[0] - 12, obs[1] + 5, p.observer, { size: 15, anchor: 'end' })
        out += label(top[0] + 12, top[1] + 5, p.object, { size: 15, anchor: 'start' })
        out += label((obs[0] + foot[0]) / 2, groundY + 20, p.base, { size: 13, weight: '600', italic: true, fill: SOFT_INK })
        out += label(foot[0] + 10, (top[1] + foot[1]) / 2, p.height, { size: 13, weight: '600', italic: true, anchor: 'start', fill: SOFT_INK })
      }
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="${W}">`
        + `${out}${notToScaleNote(W, H, isYes(p.notToScale))}</svg>`
    },
  },

  labelledtriangle: {
    cat: 'Trigonometry',
    name: 'Triangle (sides and angles)',
    defaults: {
      a: 'A', b: 'B', c: 'C',
      angleA: '50', angleB: '60', angleC: '',
      sideAB: '', sideBC: '8 cm', sideCA: '',
      notToScale: 'yes',
      cap: 'Triangle ABC',
    },
    fields: [
      ['a', 'Vertex A'], ['b', 'Vertex B'], ['c', 'Vertex C'],
      ['angleA', 'Angle at A'], ['angleB', 'Angle at B'], ['angleC', 'Angle at C'],
      ['sideAB', 'Side AB'], ['sideBC', 'Side BC'], ['sideCA', 'Side CA'],
      ['notToScale', 'Print "Diagram not drawn to scale" (yes/no)'],
      ['cap', 'Caption'],
    ],
    validate: (p) => triangleModel(p).issues,
    render: (p, col) => {
      const W = 360, H = 300
      const { A, B, C } = triangleModel(p)
      let out = `<polygon points="${f(A[0])},${f(A[1])} ${f(B[0])},${f(B[1])} ${f(C[0])},${f(C[1])}"`
        + ` fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="2.2"/>`
      out += angleMark(A, B, C, markText(p.angleA), { r: 24, col: INK })
      out += angleMark(B, C, A, markText(p.angleB), { r: 24, col: INK })
      out += angleMark(C, A, B, markText(p.angleC), { r: 24, col: INK })
      const centroid = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3]
      const side = (u, v, text) => {
        if (!String(text ?? '').trim()) return ''
        const mx = (u[0] + v[0]) / 2, my = (u[1] + v[1]) / 2
        const dx = mx - centroid[0], dy = my - centroid[1]
        const m = Math.hypot(dx, dy) || 1
        return label(mx + (dx / m) * 20, my + (dy / m) * 20 + 4, text,
          { size: 13, weight: '600', italic: true, fill: SOFT_INK })
      }
      out += side(A, B, p.sideAB) + side(B, C, p.sideBC) + side(C, A, p.sideCA)
      const vertex = (pt, name) => {
        const dx = pt[0] - centroid[0], dy = pt[1] - centroid[1]
        const m = Math.hypot(dx, dy) || 1
        return `<circle cx="${f(pt[0])}" cy="${f(pt[1])}" r="3.2" fill="${INK}" data-point="${esc(name)}"/>`
          + label(pt[0] + (dx / m) * 18, pt[1] + (dy / m) * 18 + 5, name, { size: 15 })
      }
      out += vertex(A, p.a) + vertex(B, p.b) + vertex(C, p.c)
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="${W}">`
        + `${out}${notToScaleNote(W, H, isYes(p.notToScale))}</svg>`
    },
  },

  // ============ SCIENCE ============
  plantcell: { cat: 'Science', name: 'Plant Cell', defaults: { cap: 'Plant cell' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 360 280" xmlns="http://www.w3.org/2000/svg" width="360"><rect x="20" y="20" width="320" height="240" rx="14" fill="#d9f0c8" stroke="${col}" stroke-width="3"/><rect x="32" y="32" width="296" height="216" rx="8" fill="#fff" stroke="#7a9a4a" stroke-width="1.5"/><ellipse cx="180" cy="140" rx="40" ry="34" fill="#7a9a4a" fill-opacity=".4" stroke="#365314" stroke-width="1.6"/><circle cx="180" cy="140" r="14" fill="#365314"/><ellipse cx="80" cy="80" rx="14" ry="8" fill="#7a9a4a"/><ellipse cx="280" cy="90" rx="14" ry="8" fill="#7a9a4a"/><ellipse cx="100" cy="200" rx="14" ry="8" fill="#7a9a4a"/><ellipse cx="280" cy="200" rx="14" ry="8" fill="#7a9a4a"/><text x="180" y="143" font-family="Lora,serif" font-size="9" text-anchor="middle" fill="#fff">nucleus</text><text x="80" y="65" font-family="Lora,serif" font-size="10" text-anchor="middle" fill="#1c1612">chloroplast</text><text x="40" y="270" font-family="Lora,serif" font-size="10" fill="#1c1612">cell wall →</text></svg>` },
  animalcell: { cat: 'Science', name: 'Animal Cell', defaults: { cap: 'Animal cell' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 320 280" xmlns="http://www.w3.org/2000/svg" width="320"><ellipse cx="160" cy="140" rx="140" ry="120" fill="#fce4d6" stroke="${col}" stroke-width="2.5"/><circle cx="160" cy="140" r="40" fill="#b8492a" fill-opacity=".5" stroke="#7c2d12" stroke-width="1.6"/><circle cx="160" cy="140" r="14" fill="#7c2d12"/><ellipse cx="90" cy="100" rx="20" ry="10" fill="#c89a3a" fill-opacity=".7"/><ellipse cx="240" cy="180" rx="22" ry="12" fill="#c89a3a" fill-opacity=".7"/><circle cx="100" cy="200" r="6" fill="#7c2d12"/><circle cx="220" cy="80" r="6" fill="#7c2d12"/><text x="160" y="143" font-family="Lora,serif" font-size="9" text-anchor="middle" fill="#fff">nucleus</text><text x="90" y="100" font-family="Lora,serif" font-size="9" text-anchor="middle" fill="#1c1612">mitochondrion</text></svg>` },
  circuit: { cat: 'Science', name: 'Simple Circuit', defaults: { cap: 'Simple electric circuit' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg" width="360"><rect x="40" y="40" width="280" height="160" fill="none" stroke="${col}" stroke-width="2.5"/><line x1="60" y1="40" x2="80" y2="40" stroke="#fff" stroke-width="6"/><line x1="60" y1="36" x2="60" y2="44" stroke="#1c1612" stroke-width="3"/><line x1="80" y1="30" x2="80" y2="50" stroke="#1c1612" stroke-width="3"/><line x1="65" y1="36" x2="65" y2="44" stroke="#1c1612" stroke-width="3"/><line x1="75" y1="30" x2="75" y2="50" stroke="#1c1612" stroke-width="3"/><text x="55" y="25" font-family="Lora,serif" font-size="11" fill="#1c1612">Battery</text><circle cx="180" cy="40" r="14" fill="#fff9c4" stroke="${col}" stroke-width="2"/><line x1="170" y1="30" x2="190" y2="50" stroke="${col}" stroke-width="1.5"/><line x1="190" y1="30" x2="170" y2="50" stroke="${col}" stroke-width="1.5"/><text x="180" y="22" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">Bulb</text><line x1="280" y1="40" x2="300" y2="40" stroke="#fff" stroke-width="6"/><line x1="280" y1="40" x2="305" y2="20" stroke="#1c1612" stroke-width="2.5"/><circle cx="280" cy="40" r="3" fill="#1c1612"/><circle cx="300" cy="40" r="3" fill="#1c1612"/><text x="290" y="65" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">Switch</text></svg>` },
  forcearrows: { cat: 'Science', name: 'Force Arrows', defaults: { up: 'N (Normal)', down: 'W (Weight)', left: 'F (Friction)', right: 'P (Push)', cap: 'Forces on object' }, fields: [['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 280" xmlns="http://www.w3.org/2000/svg" width="320"><rect x="120" y="120" width="80" height="40" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2.5"/><line x1="160" y1="120" x2="160" y2="40" stroke="#1c1612" stroke-width="2.5"/><polygon points="160,30 154,46 166,46" fill="#1c1612"/><text x="170" y="60" font-family="Lora,serif" font-size="11" fill="#1c1612">${esc(p.up)}</text><line x1="160" y1="160" x2="160" y2="240" stroke="#1c1612" stroke-width="2.5"/><polygon points="160,250 154,234 166,234" fill="#1c1612"/><text x="170" y="220" font-family="Lora,serif" font-size="11" fill="#1c1612">${esc(p.down)}</text><line x1="120" y1="140" x2="40" y2="140" stroke="#1c1612" stroke-width="2.5"/><polygon points="30,140 46,134 46,146" fill="#1c1612"/><text x="60" y="130" font-family="Lora,serif" font-size="11" fill="#1c1612">${esc(p.left)}</text><line x1="200" y1="140" x2="280" y2="140" stroke="#1c1612" stroke-width="2.5"/><polygon points="290,140 274,134 274,146" fill="#1c1612"/><text x="240" y="130" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">${esc(p.right)}</text></svg>` },
  foodchain: { cat: 'Science', name: 'Food Chain', defaults: { a: 'Sun', b: 'Grass', c: 'Goat', d: 'Lion', cap: 'Food chain' }, fields: [['a', 'Item 1'], ['b', 'Item 2'], ['c', 'Item 3'], ['d', 'Item 4'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 540 120" xmlns="http://www.w3.org/2000/svg" width="540"><g font-family="Lora,serif" font-size="13" font-weight="600">${[p.a, p.b, p.c, p.d].map((t, i) => `<rect x="${20 + i * 130}" y="40" width="100" height="40" rx="6" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><text x="${70 + i * 130}" y="64" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`).join('')}${[0, 1, 2].map(i => `<line x1="${120 + i * 130}" y1="60" x2="${145 + i * 130}" y2="60" stroke="#1c1612" stroke-width="2"/><polygon points="${150 + i * 130},60 ${143 + i * 130},56 ${143 + i * 130},64" fill="#1c1612"/>`).join('')}</g></svg>` },

  // ============ GEOGRAPHY ============
  compass: { cat: 'Geography', name: 'Compass Rose', defaults: { cap: 'Compass rose' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="120" cy="120" r="100" fill="none" stroke="${col}" stroke-width="1.5"/><polygon points="120,30 130,120 120,210 110,120" fill="${col}" fill-opacity=".5" stroke="${col}" stroke-width="1.5"/><polygon points="30,120 120,130 210,120 120,110" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.5"/><text x="120" y="22" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">N</text><text x="120" y="232" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">S</text><text x="20" y="126" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">W</text><text x="222" y="126" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">E</text><circle cx="120" cy="120" r="6" fill="${col}"/></svg>` },
  contourlines: { cat: 'Geography', name: 'Contour Lines', defaults: { cap: 'Contour lines (hill)' }, fields: [['cap', 'Caption']],
    render: (_p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><ellipse cx="160" cy="120" rx="140" ry="90" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="110" ry="70" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="80" ry="50" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="50" ry="30" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="20" ry="12" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.6"/><text x="160" y="124" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">peak</text></svg>` },

  // ============ ORGANISERS ============
  mindmap: { cat: 'Organisers', name: 'Mind Map', defaults: { centre: 'Topic', a: 'Idea 1', b: 'Idea 2', c: 'Idea 3', d: 'Idea 4', cap: 'Mind map' }, fields: [['centre', 'Centre'], ['a', 'Branch 1'], ['b', 'Branch 2'], ['c', 'Branch 3'], ['d', 'Branch 4'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 480 320" xmlns="http://www.w3.org/2000/svg" width="480"><line x1="240" y1="160" x2="100" y2="60" stroke="${col}" stroke-width="2"/><line x1="240" y1="160" x2="380" y2="60" stroke="${col}" stroke-width="2"/><line x1="240" y1="160" x2="100" y2="260" stroke="${col}" stroke-width="2"/><line x1="240" y1="160" x2="380" y2="260" stroke="${col}" stroke-width="2"/><ellipse cx="240" cy="160" rx="70" ry="34" fill="${col}" stroke="${col}" stroke-width="2"/><text x="240" y="166" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="middle" fill="#fff">${esc(p.centre)}</text>${[[100, 60, p.a], [380, 60, p.b], [100, 260, p.c], [380, 260, p.d]].map(([x, y, t]) => `<rect x="${x - 55}" y="${y - 18}" width="110" height="36" rx="18" fill="#fff" stroke="${col}" stroke-width="2"/><text x="${x}" y="${y + 5}" font-family="Lora,serif" font-size="12" font-weight="600" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`).join('')}</svg>` },
  tchart: { cat: 'Organisers', name: 'T-Chart', defaults: { left: 'Side A', right: 'Side B', cap: 'Comparison' }, fields: [['left', 'Left header'], ['right', 'Right header'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="400"><line x1="20" y1="60" x2="380" y2="60" stroke="${col}" stroke-width="2.5"/><line x1="200" y1="20" x2="200" y2="220" stroke="${col}" stroke-width="2.5"/><text x="110" y="44" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.left)}</text><text x="290" y="44" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.right)}</text>${[80, 110, 140, 170, 200].map(y => `<line x1="30" y1="${y}" x2="180" y2="${y}" stroke="#c4b69e" stroke-width="1"/><line x1="220" y1="${y}" x2="370" y2="${y}" stroke="#c4b69e" stroke-width="1"/>`).join('')}</svg>` },
  timeline: { cat: 'Organisers', name: 'Timeline', defaults: { years: '1964,1980,1991,2011,2024', events: 'Independence,One-party,Multi-party,New Constitution,Today', cap: 'Timeline' }, fields: [['years', 'Markers'], ['events', 'Events'], ['cap', 'Caption']],
    render: (p, col) => {
      const years = p.years.split(',').map(s => s.trim())
      const events = p.events.split(',').map(s => s.trim())
      const w = 560, axisY = 120, m = 40
      const step = (w - 2 * m) / (years.length - 1 || 1)
      let dots = ''
      years.forEach((y, i) => {
        const x = m + i * step
        dots += `<circle cx="${x}" cy="${axisY}" r="7" fill="${col}"/><text x="${x}" y="${axisY + 28}" font-family="Lora,serif" font-size="12" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(y)}</text><text x="${x}" y="${axisY - 18}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#3a2f25">${esc(events[i] || '')}</text>`
      })
      return `<svg viewBox="0 0 ${w} 200" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${m}" y1="${axisY}" x2="${w - m}" y2="${axisY}" stroke="${col}" stroke-width="2.5"/>${dots}</svg>`
    } },
  flowchart: { cat: 'Organisers', name: 'Flowchart', defaults: { a: 'Start', b: 'Process', c: 'Decide?', d: 'End', cap: 'Flowchart' }, fields: [['a', 'Step 1'], ['b', 'Step 2'], ['c', 'Step 3'], ['d', 'Step 4'], ['cap', 'Caption']],
    render: (p, col) => `<svg viewBox="0 0 200 360" xmlns="http://www.w3.org/2000/svg" width="200"><g font-family="Lora,serif" font-size="13" font-weight="600">${[p.a, p.b, p.c, p.d].map((t, i) => `<rect x="20" y="${20 + i * 84}" width="160" height="50" rx="${i === 2 ? 0 : 14}" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2" transform="${i === 2 ? `rotate(45 100 ${45 + i * 84})` : ''}" /><text x="100" y="${50 + i * 84}" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`).join('')}${[0, 1, 2].map(i => `<line x1="100" y1="${72 + i * 84}" x2="100" y2="${102 + i * 84}" stroke="#1c1612" stroke-width="2"/><polygon points="100,${108 + i * 84} 95,${100 + i * 84} 105,${100 + i * 84}" fill="#1c1612"/>`).join('')}</g></svg>` },
  mapping: { cat: 'Organisers', name: 'Mapping / Relation', defaults: { left: '1,2,3', right: '2,3,6', links: '1>1,2>2,3>3', cap: 'Mapping diagram' }, fields: [['left', 'Left items (comma list)'], ['right', 'Right items (comma list)'], ['links', 'Arrows e.g. 1>2,2>2'], ['cap', 'Caption']],
    render: (p, col) => {
      // Two columns of ovals (domain → co-domain) with arrowed lines between them.
      // `links` is a comma list of "L>R" using 1-based row indices into each column.
      const left = String(p.left ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const right = String(p.right ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const links = String(p.links ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const rowH = 54, padTop = 36, lx = 90, rx = 290, rxW = 56, rxH = 20
      const h = padTop + Math.max(left.length, right.length, 1) * rowH
      const colY = (n, i) => padTop + i * rowH + ((Math.max(left.length, right.length) - n) * rowH) / 2
      const ovals = (items, cx, n) => items.map((t, i) => {
        const cy = colY(n, i)
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rxW}" ry="${rxH}" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="1.8"/><text x="${cx}" y="${cy + 5}" font-family="Lora,serif" font-size="14" font-weight="600" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`
      }).join('')
      const arrows = links.map(link => {
        const [a, b] = link.split('>').map(s => parseInt(s, 10))
        if (!a || !b || a > left.length || b > right.length) return ''
        const y1 = colY(left.length, a - 1), y2 = colY(right.length, b - 1)
        const x1 = lx + rxW + 2, x2 = rx - rxW - 2
        const tipX = x2 - 9
        return `<line x1="${x1}" y1="${y1}" x2="${tipX}" y2="${y2}" stroke="#1c1612" stroke-width="1.6"/><polygon points="${x2},${y2} ${tipX - 1},${y2 - 5} ${tipX - 1},${y2 + 5}" fill="#1c1612"/>`
      }).join('')
      return `<svg viewBox="0 0 380 ${h}" xmlns="http://www.w3.org/2000/svg" width="380"><ellipse cx="${lx}" cy="${h / 2 + 4}" rx="74" ry="${h / 2 - 6}" fill="none" stroke="${col}" stroke-width="1.2" stroke-dasharray="5 4"/><ellipse cx="${rx}" cy="${h / 2 + 4}" rx="74" ry="${h / 2 - 6}" fill="none" stroke="${col}" stroke-width="1.2" stroke-dasharray="5 4"/>${arrows}${ovals(left, lx, left.length)}${ovals(right, rx, right.length)}</svg>`
    } },
}

const DEFAULT_COLOR = '#7c2d12'

export function getDiagram(libraryKey) {
  return DIAGRAM_CATALOG[libraryKey] || null
}

export function getCategories() {
  const seen = new Set()
  const order = []
  for (const entry of Object.values(DIAGRAM_CATALOG)) {
    if (!seen.has(entry.cat)) {
      seen.add(entry.cat)
      order.push(entry.cat)
    }
  }
  return order
}

export function getDiagramsByCategory(category) {
  const result = []
  for (const [key, entry] of Object.entries(DIAGRAM_CATALOG)) {
    if (!category || category === 'All' || entry.cat === category) {
      result.push({ key, ...entry })
    }
  }
  return result
}

/**
 * Render a diagram to an SVG string by looking up the key in the catalog.
 *
 * Returns null if the key is unknown — callers should display a placeholder
 * (and ideally keep the source data so re-adding the entry restores rendering).
 */
export function renderDiagramSvg(libraryKey, params, color = DEFAULT_COLOR) {
  const entry = getDiagram(libraryKey)
  if (!entry) return null
  const merged = { ...entry.defaults, ...(params || {}) }
  try {
    return entry.render(merged, color)
  } catch (err) {
    console.error('[diagramCatalog] render failed for', libraryKey, err)
    return null
  }
}
