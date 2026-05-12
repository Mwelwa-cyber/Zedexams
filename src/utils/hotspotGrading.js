/**
 * src/utils/hotspotGrading.js
 *
 * Pure grading helper for `type: 'hotspot'` questions — image-with-target
 * labelling questions like "click the right ventricle on this heart
 * diagram" or "tap Lusaka on this map of Zambia."
 *
 * Coordinate convention
 * ---------------------
 * Both the learner's answer and the teacher's stored region use NORMALISED
 * coordinates: x and y in [0, 1] where (0, 0) is the top-left corner of
 * the image and (1, 1) is the bottom-right. Normalising at the call-site
 * means the same stored region grades correctly regardless of the screen
 * size the learner happens to be on — phone, tablet, or laptop. The
 * editor + runner both convert from pixel offsets to normalised coords
 * using `clientX - rect.left) / rect.width`.
 *
 * `radius` is also normalised: a radius of 0.05 means "5 % of the image's
 * shortest side" in the grader's eye. The editor caps radius at 0.5 (the
 * region can never exceed half the image).
 *
 * Lives in its own module — alongside numericGrading.js — so the unit
 * tests in scripts/ can import it without dragging in Firebase.
 */

/**
 * Returns true iff the learner's tap (given.x, given.y) is within
 * `correctRegion.radius` of the centre (correctRegion.x, correctRegion.y).
 *
 * All coordinates are normalised to [0, 1]. Any out-of-range, missing,
 * or non-numeric input returns false — incorrect, but never throwing.
 *
 * Worked example:
 *   const region = { x: 0.5, y: 0.5, radius: 0.1 }
 *   hotspotMatches({ x: 0.55, y: 0.52 }, region) === true   // inside
 *   hotspotMatches({ x: 0.7,  y: 0.7 },  region) === false  // outside
 *   hotspotMatches(null, region)         === false
 *   hotspotMatches({ x: 0.5 }, region)   === false  (y missing)
 */
export function hotspotMatches(given, correctRegion) {
  if (!given || typeof given !== 'object') return false
  if (!correctRegion || typeof correctRegion !== 'object') return false

  const gx = Number(given.x)
  const gy = Number(given.y)
  const cx = Number(correctRegion.x)
  const cy = Number(correctRegion.y)
  const cr = Number(correctRegion.radius)

  if (![gx, gy, cx, cy, cr].every(Number.isFinite)) return false
  if (cr < 0) return false
  // Coords must lie inside the image plane — guards against a malformed
  // doc with x = -1 or 2 (e.g. from a bad legacy import).
  if (gx < 0 || gx > 1 || gy < 0 || gy > 1) return false

  const dx = gx - cx
  const dy = gy - cy
  return Math.sqrt(dx * dx + dy * dy) <= cr
}
