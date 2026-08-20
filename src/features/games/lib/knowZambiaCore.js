/**
 * Pure logic for the `map_place` engine — "Know Zambia", the tap-to-place
 * map game (the fifth catalogue mechanic, and the first with a map).
 *
 * The mechanic comes from the prototype at docs/learner/zedexams-zambia-game.html,
 * and three of its rules are the reason this module exists rather than the
 * geometry living in the component:
 *
 *   THE ROUND GROWS. A round places the ten provinces in three waves — three,
 *   then two more, then the last five — and every province already placed
 *   stays on the map WITH ITS NAME. An empty map with ten labels is a memory
 *   test; a map with three known provinces on it is a lesson in where the
 *   fourth must be. `waveOf` and `anchorsBefore` are what make that testable.
 *
 *   A WRONG TAP TEACHES DIRECTION. Every province carries a positional hint
 *   written relative to something else ("west of the Copperbelt"), and the
 *   feedback names what was tapped before giving it. `hintFor` refuses to
 *   return an empty string, because a hint that says nothing is a red cross
 *   with more words.
 *
 *   THE SMALLEST TARGET IS STILL 44px. Lusaka is the smallest province and
 *   measures about 32px tall on a 360px screen, so `haloRadius` sizes an
 *   invisible circle for any shape that comes up short AT THE WIDTH ACTUALLY
 *   RENDERED. It returns 0 for a shape that is already big enough, so the
 *   halo never steals a tap it did not need to.
 *
 * No React, no DOM: the geometry helpers take plain numbers so
 * scripts/test-know-zambia.mjs can drive them under node, and the component
 * measures the rendered SVG and hands the width in.
 */

/** The ten codes, in the order the dataset lists them. */
export const PROVINCE_CODES = ['nw', 'cb', 'ce', 'lu', 'so', 'we', 'no', 'mu', 'ea', 'lp']

/**
 * Three, then five, then all ten.
 *
 * The first wave is deliberately three spread-out provinces a Grade 7 learner
 * can place from general knowledge — the capital, the mining province, the big
 * one in the west — because those three are what every later hint points at.
 */
export const DEFAULT_WAVES = [
  ['lu', 'cb', 'we'],
  ['so', 'no'],
  ['ce', 'ea', 'lp', 'mu', 'nw'],
]

/** The smallest tap target we will ship, in CSS pixels. */
export const TOUCH_MIN = 44

/** Points per placement, before the combo. */
export const PLACE_POINTS = 20

/* ── geometry ──────────────────────────────────────────────────────── */

/**
 * The points of an SVG path made only of M/L/Z commands, which is what the
 * traced dataset holds. Anything richer would need a real path parser, so
 * `test:know-zambia` asserts the dataset stays in that subset rather than
 * this quietly returning half a province.
 */
export function parsePath(d) {
  const points = []
  const re = /[ML]\s*(-?[\d.]+),(-?[\d.]+)/g
  let match
  while ((match = re.exec(String(d || '')))) points.push([Number(match[1]), Number(match[2])])
  return points
}

export function bboxOf(points) {
  if (!points?.length) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 }
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const [x, y] of points) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

/** Shoelace area — used only to stack halos smallest-last. */
export function areaOf(points) {
  let a = 0
  for (let i = 0, j = (points?.length || 0) - 1; i < (points?.length || 0); j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1])
  }
  return Math.abs(a / 2)
}

export function pointInPolygon([x, y], points) {
  let inside = false
  for (let i = 0, j = (points?.length || 0) - 1; i < (points?.length || 0); j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * WGS84 lon/lat onto the dataset's viewBox, calibrated on Zambia's four
 * extreme points. `lat` is degrees SOUTH as a positive number, which is how
 * the datasets store it.
 */
export function project(projection, lon, lat) {
  const p = projection
  if (!p?.lon || !p?.lat) return [0, 0]
  return [
    (lon - p.lon.min) * p.lon.scale + p.lon.offset,
    (lat - p.lat.min) * p.lat.scale + p.lat.offset,
  ]
}

/**
 * The radius, in viewBox units, of the invisible halo a shape needs to reach
 * `TOUCH_MIN` at the width it is rendered at — or 0 when its own shape is
 * already big enough.
 *
 * `minDim` is the smaller side of the shape's bounding box in viewBox units;
 * `scale` is renderedPx / viewBoxWidth. A halo is never given to a shape that
 * does not need one, because a halo that is not needed only steals taps from
 * the neighbour underneath it.
 */
export function haloRadius(minDim, scale, touchMin = TOUCH_MIN) {
  if (!Number.isFinite(minDim) || !Number.isFinite(scale) || scale <= 0) return 0
  if (minDim * scale >= touchMin) return 0
  return touchMin / 2 / scale
}

/**
 * The shortest distance from a point to a polygon's edge — and, when the point
 * is the label anchor, the radius of the largest circle that fits inside the
 * province there.
 *
 * That radius is how a name is sized. Sizing from the bounding box instead is
 * the same mistake as using a box centre for a position, one step along:
 * North-Western's box is nearly half the country wide while the room around
 * its anchor is not, so box-derived sizing printed its name straight across
 * Copperbelt's whenever both were labelled.
 */
export function distanceToEdge(point, points) {
  let best = Infinity
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j]
    const [bx, by] = points[i]
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx - point[0], ay + t * dy - point[1]))
  }
  return Number.isFinite(best) ? best : 0
}

/**
 * The font size a province's name gets, from the room actually available at
 * its anchor rather than from the width of its bounding box. Clamped either
 * side: never smaller than a name can be read at, never larger than the
 * biggest province would take.
 */
export function labelSizeFor(shape) {
  const chars = Math.max(1, String(shape?.name || '').length)
  const room = Number(shape?.inscribed) || 0
  return Math.max(1.9, Math.min(3.1, (room * 2 * 0.95) / (chars * 0.55)))
}

/** Geometry per province, computed once: points, bbox, area, label anchor. */
export function buildGeometry(provinces) {
  const out = {}
  for (const code of PROVINCE_CODES) {
    const province = provinces?.[code]
    if (!province) continue
    const points = parsePath(province.d)
    out[code] = {
      code,
      name: province.n,
      points,
      bbox: bboxOf(points),
      area: areaOf(points),
      anchor: province.c,
      inscribed: distanceToEdge(province.c, points),
    }
  }
  return out
}

/* ── the round ─────────────────────────────────────────────────────── */

/** The waves a pack plays: its own if it declares them, else the default. */
export function wavesFor(game) {
  const declared = game?.waves
  if (!Array.isArray(declared) || !declared.length) return DEFAULT_WAVES
  const clean = declared
    .map((wave) => (Array.isArray(wave) ? wave.filter((code) => PROVINCE_CODES.includes(code)) : []))
    .filter((wave) => wave.length)
  return clean.length ? clean : DEFAULT_WAVES
}

/** Every province a round will ask for, in order. */
export function placementsIn(waves) {
  return waves.flat()
}

/** Which wave a province belongs to, or -1. */
export function waveOf(waves, code) {
  return waves.findIndex((wave) => wave.includes(code))
}

/**
 * The provinces already on the map when a wave starts — the anchors a hint is
 * allowed to point at. This is the rule the prototype's guard checks and the
 * reason the waves are ordered as they are.
 */
export function anchorsBefore(waves, waveIndex) {
  return waves.slice(0, Math.max(0, waveIndex)).flat()
}

/** 20 × combo, the same shape every other mechanic pays. */
export function placeGain(combo = 1) {
  return PLACE_POINTS * Math.max(1, Math.floor(Number(combo) || 1))
}

/**
 * The positional hint for a province. Never empty: a province with no hint in
 * the dataset falls back to naming its region, because the alternative is
 * feedback that says only "no".
 */
export function hintFor(facts, provinces, code) {
  const hint = facts?.provinces?.[code]?.hint
  if (hint) return hint
  const region = provinces?.[code]?.region
  const name = provinces?.[code]?.n || 'It'
  return region ? `${name} is in the ${region} of the country.` : `${name} is somewhere else on the map.`
}

/** The fact shown when a province is placed correctly. */
export function factFor(facts, provinces, code) {
  return facts?.provinces?.[code]?.fact || provinces?.[code]?.n || ''
}

/** Stars for the end screen — the same thresholds the other mechanics use. */
export function starsForScore(score) {
  const value = Number(score) || 0
  if (value >= 140) return 3
  if (value >= 60) return 2
  return 1
}

/**
 * The payload `useGameFinish` saves. Kept here so the engine has no scoring
 * decisions of its own — the server still validates what it is sent.
 */
export function roundResult({ game, score, solved, misses, peakCombo, timeSpent }) {
  return {
    game,
    score: Number(score) || 0,
    correct: Number(solved) || 0,
    total: Number(solved || 0) + Number(misses || 0),
    peakCombo: Number(peakCombo) || 1,
    timeSpent: Number(timeSpent) || 0,
  }
}

/* ── the map modes ─────────────────────────────────────────────────── *
 *
 * The place-the-province round above is one mechanic on this map. Five more
 * come from the prototype at docs/learner/zedexams-zambia-map-modes.html, and
 * they are modes of the SAME engine rather than five new engines, because the
 * map, the halos, the label anchors and the glyph-not-colour rule are already
 * settled here and none of them changes per mode.
 *
 * A pack picks its mode with `mode:`; a pack that names none plays 'place',
 * so the pack that already shipped keeps working untouched.
 *
 * Everything below is a pure function of the datasets. That is not tidiness:
 * three of these modes can be WRONG WHILE THE GAME STILL PLAYS PERFECTLY — a
 * journey through two provinces that do not touch is still tappable in order,
 * and an odd-one-out set whose odd province is not actually odd still lights
 * four provinces and accepts a tap. Nothing on screen can tell. Keeping the
 * rules here is what lets scripts/test-know-zambia.mjs ask the data whether
 * each lesson is true.
 */

/** Every mode this engine can play. 'place' is the original round. */
export const MAP_MODES = ['place', 'capital', 'journey', 'odd', 'neighbours', 'ceremony']

/** The mode a pack plays. Unknown or missing falls back to 'place'. */
export function modeOf(game) {
  const mode = game?.mode
  return MAP_MODES.includes(mode) ? mode : 'place'
}

/** Which provinces share a border with which, from the dataset. */
export function adjacencyOf(geo) {
  return geo?.adjacency?.edges || {}
}

/** Do these two provinces share a border? */
export function provincesTouch(geo, a, b) {
  return (adjacencyOf(geo)[a] || []).includes(b)
}

/* ── 1. Where's the capital? ───────────────────────────────────────── */

/**
 * One step per provincial capital, each carrying the coordinates the pin is
 * PLOTTED from rather than a position picked by eye. A capital with no
 * coordinates is dropped instead of being drawn at 0,0 in the Atlantic.
 */
export function capitalSteps(facts) {
  return (facts?.capitals || [])
    .filter((c) => PROVINCE_CODES.includes(c?.province) && Number.isFinite(c?.lon) && Number.isFinite(c?.lat))
    .map((c) => ({
      kind: 'capital',
      answer: c.province,
      town: c.town,
      lon: c.lon,
      lat: c.lat,
      fact: c.fact || '',
      hint: c.hint || '',
    }))
}

/* ── 2. Journey ────────────────────────────────────────────────────── */

/** The routes a journey pack can play, or the one it names in `routeId`. */
export function journeysFor(facts, game) {
  const all = (facts?.journeys || []).filter((r) => Array.isArray(r?.provinces) && r.provinces.length > 1)
  const wanted = game?.routeId
  if (!wanted) return all
  const one = all.filter((r) => r.id === wanted)
  return one.length ? one : all
}

/**
 * What to say when a learner taps a province during a journey.
 *
 * This is the whole reason journey mode is worth building. A place-the-label
 * game can only say right or wrong; here the map already knows WHY the tap was
 * wrong, and the four answers are four different lessons:
 *
 *   visited  — you have already been there, and it is numbered on the strip
 *   start    — the journey starts somewhere, and not here
 *   adjacent — it really does touch where you are, so you could drive there;
 *              it is just not the way to where you are going
 *   far      — it does not touch where you are at all, so you cannot reach it
 *              without crossing something in between
 *
 * Collapsing the last two into one "wrong, try again" is what loses the
 * lesson: the difference between them IS the shape of the country.
 */
export function journeyVerdict({ geo, route, atIndex, tapped }) {
  const sequence = route?.provinces || []
  const want = sequence[atIndex]
  if (tapped === want) {
    return { ok: true, kind: 'next', title: '', body: route?.legs?.[tapped] || '' }
  }
  const already = sequence.indexOf(tapped)
  if (already >= 0 && already < atIndex) {
    return {
      ok: false,
      kind: 'visited',
      title: 'You have been there',
      body: `You passed through ${nameIn(geo, tapped)} already — it is number ${already + 1} on the strip. Which province comes next?`,
    }
  }
  const here = atIndex > 0 ? sequence[atIndex - 1] : null
  if (!here) {
    return {
      ok: false,
      kind: 'start',
      title: 'That is not where you start',
      body: `${route?.from || 'The journey'} is in ${nameIn(geo, want)}. Start in the province you are leaving from.`,
    }
  }
  if (provincesTouch(geo, tapped, here)) {
    return {
      ok: false,
      kind: 'adjacent',
      title: `${nameIn(geo, tapped)} does touch ${nameIn(geo, here)}`,
      body: `So you could drive there — but you are heading for ${route?.to || 'the end of the road'}, and this road does not go that way. Which province that touches ${nameIn(geo, here)} takes you towards ${route?.to || 'it'}?`,
    }
  }
  return {
    ok: false,
    kind: 'far',
    title: `${nameIn(geo, tapped)} does not touch ${nameIn(geo, here)}`,
    body: `You are in ${nameIn(geo, here)}. You cannot reach ${nameIn(geo, tapped)} from there without crossing a province in between. Which province touches ${nameIn(geo, here)} on the way to ${route?.to || 'the end'}?`,
  }
}

/** A province's name from the geometry dataset, never an empty string. */
export function nameIn(geo, code) {
  return geo?.provinces?.[code]?.n || String(code || '')
}

/* ── 3. Odd one out ────────────────────────────────────────────────── */

/**
 * Evaluate one of the rules an odd-one-out set declares against the data.
 *
 * The sets say what they are ASKING (`borders:cd`, `borders:any`, `touches:ce`)
 * and never which province is the answer, so a set cannot drift into being
 * quietly untrue. Returns null for a rule this does not understand, which the
 * validator treats as a failure rather than as a pass.
 */
export function oddRuleHolds({ facts, geo, code, rule }) {
  const borders = facts?.provinces?.[code]?.borders
  if (!Array.isArray(borders)) return null
  if (rule === 'borders:any') return borders.length > 0
  if (typeof rule !== 'string') return null
  if (rule.startsWith('borders:')) return rule.slice(8).split('|').some((c) => borders.includes(c))
  if (rule.startsWith('touches:')) return provincesTouch(geo, code, rule.slice(8))
  return null
}

/**
 * The odd-one-out sets that are actually sound — exactly three of the four
 * satisfying the rule, and the fourth being the one the set calls odd.
 *
 * A set that fails is DROPPED rather than shown, so bad data costs a question
 * instead of teaching a falsehood. test:know-zambia fails the build on the
 * same condition, so nothing should ever reach this filter in practice.
 */
export function oddSteps(facts, geo) {
  return (facts?.oddOneOut || [])
    .filter((set) => {
      if (!Array.isArray(set?.set) || set.set.length !== 4) return false
      if (!set.set.includes(set.odd)) return false
      const verdicts = set.set.map((code) => oddRuleHolds({ facts, geo, code, rule: set.rule }))
      if (verdicts.some((v) => v === null)) return false
      const holds = set.set.filter((code, i) => verdicts[i])
      const dont = set.set.filter((code, i) => !verdicts[i])
      return holds.length === 3 && dont.length === 1 && dont[0] === set.odd
    })
    .map((set) => ({ kind: 'odd', answer: set.odd, set: set.set, q: set.q || '', why: set.why || '' }))
}

/* ── 4. Our neighbours ─────────────────────────────────────────────── */

/** The eight countries, each with the box it is placed in. */
export function neighbourSteps(facts) {
  return (facts?.neighbours || [])
    .filter((n) => n?.code && Array.isArray(n?.zone) && n.zone.length === 4)
    .map((n) => ({
      kind: 'neighbour',
      answer: n.code,
      name: n.name || n.code,
      zone: n.zone,
      side: n.side || '',
      fact: n.fact || '',
      hint: n.hint || '',
    }))
}

/* ── 5. Where's the ceremony? ──────────────────────────────────────── */

/**
 * Three questions per ceremony, and only the first is on the map.
 *
 * That split is the point rather than a shortage of map ideas: a learner who
 * only ever taps a map stops reading the question. Tapping the province is
 * followed by two plain option questions — whose ceremony, and when — so the
 * mode places the ceremony in a culture and a season and not only on a map.
 */
export function ceremonySteps(facts, rng = defaultRng) {
  const out = []
  for (const c of facts?.ceremonies || []) {
    if (!PROVINCE_CODES.includes(c?.province)) continue
    out.push({ kind: 'ceremonyWhere', name: c.name, answer: c.province, fact: c.fact || '', hint: c.hint || '' })
    // The dataset lists the correct people/month FIRST on every ceremony, so
    // dealing the options in stored order would let a learner tap the top row
    // without reading. Dealt fresh per round; the answer travels by TEXT
    // (`pickOption` compares strings), so no index needs remapping.
    if (Array.isArray(c.peopleOptions) && c.peopleOptions.includes(c.people)) {
      out.push({ kind: 'ceremonyWho', name: c.name, answer: c.people, options: shuffledOptions(c.peopleOptions, rng), why: c.fact || '' })
    }
    if (Array.isArray(c.monthOptions) && c.monthOptions.includes(c.month)) {
      out.push({ kind: 'ceremonyWhen', name: c.name, answer: c.month, options: shuffledOptions(c.monthOptions, rng), why: c.monthWhy || '' })
    }
  }
  return out
}

/**
 * Crypto-backed uniform [0, 1) — same rationale as duelCore's: outcomes
 * are not secrets, but CodeQL rightly refuses `Math.random` for a draw
 * that shapes a scored round, and `crypto.getRandomValues` exists in
 * every runtime this code sees. Tests inject a seeded rng.
 */
function defaultRng() {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0] / 4294967296
}

/** Fisher–Yates copy, used to deal a step's options in a fresh order. */
export function shuffledOptions(options, rng = defaultRng) {
  const out = options.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ── building a round ──────────────────────────────────────────────── */

/**
 * The steps a pack's round plays, in order.
 *
 * STEP order is the dataset's own throughout. Shuffling it would make a round
 * harder to reproduce from a bug report for no teaching gain, and the
 * tricky-pool replay below already stops a round being the same twice for a
 * learner who missed something. The OPTIONS within a ceremony step are the one
 * exception (see ceremonySteps): the dataset lists the answer first, and a
 * stable answer position is a leak, not reproducibility.
 */
export function stepsFor({ game, facts, geo }) {
  switch (modeOf(game)) {
    case 'capital': return capitalSteps(facts)
    case 'odd': return oddSteps(facts, geo)
    case 'neighbours': return neighbourSteps(facts)
    case 'ceremony': return ceremonySteps(facts)
    default: return []
  }
}

/**
 * The queue after a pass: the steps that were missed, once, then done.
 *
 * Deliberately not a spaced-repetition schedule and not a loop that can run
 * for ever — one replay of what caught the learner, then the round ends.
 */
export function replayQueue(missed) {
  return Array.isArray(missed) ? missed.slice() : []
}

/**
 * Split the light markup the datasets use for emphasis into plain segments.
 *
 * The odd-one-out questions are written with <b> around the thing being asked
 * about ("share a border with the <b>DR Congo</b>"), which is worth keeping —
 * it is the word the whole question turns on. Rendering it with
 * dangerouslySetInnerHTML would mean a content file could put markup into the
 * learner app, so the tags are parsed here into segments a component maps over
 * as ordinary text children instead.
 *
 * SCANNED, NOT STRIPPED WITH A REGEX. The first version removed tags with
 * `replace(/<[^>]*>/g, '')`, which CodeQL was right to flag. That pattern only
 * removes a tag that is CLOSED: "a <script alert(1)" has no ">" anywhere, so
 * nothing matches and the whole thing passes through untouched — which is
 * precisely what the alert said, that the result "may still contain <script".
 * Nothing downstream could have been injected, because React escapes text
 * children and that is the actual guarantee, but a function that removes
 * markup should not be defeated by leaving a bracket off.
 *
 * The scanner gives a property the regex could not: `<` is only ever consumed
 * as the start of a tag and never appended to a segment, so NO OUTPUT SEGMENT
 * CAN CONTAIN "<" AT ALL, whatever the input. A tag that is not <b> or
 * <strong> is dropped with its brackets; an unclosed "<" drops the rest of
 * the string rather than leaving a fragment behind. A lone ">" is kept — it is
 * an ordinary character in "3 > 2", and it cannot begin an element.
 */
export function richSegments(text) {
  const source = String(text || '')
  const out = []
  let buffer = ''
  let bold = false
  let i = 0
  const flush = () => {
    if (buffer) out.push({ text: buffer, bold })
    buffer = ''
  }
  while (i < source.length) {
    if (source[i] !== '<') {
      buffer += source[i]
      i += 1
      continue
    }
    const close = source.indexOf('>', i)
    if (close < 0) break // an unclosed tag: drop it and everything after it
    const tag = source.slice(i + 1, close).trim().toLowerCase()
    if (tag === 'b' || tag === 'strong') {
      flush()
      bold = true
    } else if (tag === '/b' || tag === '/strong') {
      flush()
      bold = false
    }
    // anything else is dropped whole, brackets included
    i = close + 1
  }
  flush()
  return out.filter((seg) => seg.text.length > 0)
}
