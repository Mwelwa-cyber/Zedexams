/**
 * Where things are on the road — the perspective, and nothing else.
 *
 * Pure arithmetic, no canvas, so `test:spelling-ride` can assert the two
 * properties that were got wrong during the prototype's development and must
 * not come back:
 *
 *   THE ROAD RECEDES TO A VANISHING POINT. Its half-width is a function of
 *   screen y and goes to zero at the vanishing point. A road of constant width
 *   does not read as a road going away — it reads as a wall going up, and the
 *   rows sliding down it read as sliding down a wall.
 *
 *   A ROW NEAR THE HORIZON MOVES SLOWLY AND THEN SWEEPS PAST. `trackToScreen`
 *   is deliberately non-linear (a power curve): equal steps of road become
 *   small steps of screen in the distance and large ones close up, which is
 *   what perspective actually does. A linear map makes the whole road move at
 *   one speed and kills the sense of travel.
 *
 * The one thing every renderer must agree on is that TRACK UNITS ARE THE
 * MODEL'S and screen pixels are the view's. `spellingRideCore` moves rows in
 * track units and never learns the screen size; this module is the only
 * translation, and it only goes one way.
 */

/** The horizon, the vanishing point and the rider, for a viewport. */
export function roadGeometry(width, height) {
  const w = Math.max(1, Number(width) || 0)
  const h = Math.max(1, Number(height) || 0)
  const horizonY = h * 0.42
  return {
    width: w,
    height: h,
    horizonY,
    // The vanishing point sits ABOVE the horizon line, so the road's edges
    // still have a little width where they meet the treeline rather than
    // pinching to a point exactly on it.
    vanishY: horizonY - 30,
    roadTopY: horizonY + 6,
    riderY: h * 0.80,
    // Where a row is answered: just above the rider's front wheel.
    resolveY: h * 0.80 - 10,
  }
}

/** Half the tarmac's width at a screen y. Zero at the vanishing point. */
export function halfWidthAt(screenY, geom) {
  const span = geom.height - geom.vanishY
  if (span <= 0) return 0
  return Math.max(0, geom.width * 0.46 * ((screenY - geom.vanishY) / span))
}

/** One lane's width at a screen y — the tarmac is three lanes wide. */
export function laneWidthAt(screenY, geom) {
  return (2 * halfWidthAt(screenY, geom)) / 3
}

/** The centre of lane `i` (0,1,2) at a screen y. */
export function laneCentreAt(index, screenY, geom) {
  return geom.width / 2 + (index - 1) * laneWidthAt(screenY, geom)
}

/**
 * A row's screen y from its track y.
 *
 * Track 0 is the rider. `SPAWN_Y` (−70) is the far distance, so the mapping
 * takes `[-70, riderY]` onto `[roadTop, rider]` through a power curve, and
 * continues past the rider linearly so a resolved row can slide off the
 * bottom of the screen rather than stopping dead on it.
 */
export function trackToScreen(trackY, geom) {
  const top = geom.roadTopY
  const rider = geom.resolveY
  const progress = (Number(trackY) + 70) / (rider + 70)
  if (progress <= 0) return top
  if (progress <= 1) return top + (rider - top) * Math.pow(progress, 1.8)
  return rider + (progress - 1) * 1.8 * (rider - top)
}

/**
 * How big a thing at this depth should be drawn, as a fraction of its size at
 * the rider. Floored so a far tile is small rather than invisible.
 */
export function depthScale(screenY, geom) {
  const atRider = halfWidthAt(geom.riderY, geom)
  if (atRider <= 0) return 0.12
  return Math.max(0.12, halfWidthAt(screenY, geom) / atRider)
}

/**
 * Which lane a tap at `x` means.
 *
 * SCREEN THIRDS, not the tarmac's own width at the rider. A learner aiming at
 * the left lane taps the left of the SCREEN — including the verge, which under
 * a tarmac-relative test would be a tap on nothing. There is no way to miss.
 */
export function laneFromX(x, width) {
  const w = Math.max(1, Number(width) || 0)
  return Math.max(0, Math.min(2, Math.floor((Number(x) || 0) / (w / 3))))
}

/** How far a resolved row has faded out, 1 → 0 over `life` seconds. */
export function fadeOut(age, life = 0.45) {
  return Math.max(0, 1 - (Number(age) || 0) / life)
}

/** How far a distant row has faded IN, by depth. */
export function fadeIn(scale) {
  return Math.max(0, Math.min(1, (scale - 0.18) / 0.28))
}
