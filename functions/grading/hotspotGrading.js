/**
 * functions/grading/hotspotGrading.js
 *
 * CommonJS port of src/utils/hotspotGrading.js. Logic-equivalent to the
 * client copy so server-side grading matches what the client computed.
 * Pure, dependency-free. Do not add imports.
 *
 * If you change one copy, change the other (src/utils/hotspotGrading.js)
 * and update both test suites.
 */

function hotspotMatches(given, correctRegion) {
  if (!given || typeof given !== "object") return false;
  if (!correctRegion || typeof correctRegion !== "object") return false;

  const gx = Number(given.x);
  const gy = Number(given.y);
  const cx = Number(correctRegion.x);
  const cy = Number(correctRegion.y);
  const cr = Number(correctRegion.radius);

  if (![gx, gy, cx, cy, cr].every(Number.isFinite)) return false;
  if (cr < 0) return false;
  if (gx < 0 || gx > 1 || gy < 0 || gy > 1) return false;

  const dx = gx - cx;
  const dy = gy - cy;
  return Math.sqrt(dx * dx + dy * dy) <= cr;
}

module.exports = {hotspotMatches};
