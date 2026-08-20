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
