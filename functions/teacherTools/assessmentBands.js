/**
 * Assessment bands, server side — the pedagogical rules the generator must obey
 * for the level a paper targets.
 *
 * Same contract as the client (src/utils/assessmentBandService.js): the
 * `assessmentBands` Firestore collection is the live source, and the published
 * defaults are the fallback. Here the defaults come from
 * functions/data/assessmentBands.json, which is GENERATED from
 * src/config/assessmentBands.js by `npm run sync:assessment-bands` —
 * functions/ is a separate package and only its own directory is uploaded on
 * deploy, so it cannot import from src/. scripts/test-assessment-bands.mjs
 * fails CI if the generated copy is stale, so the two cannot drift.
 *
 * A stored document that fails validation is refused in favour of the defaults:
 * a band that has been broken in the console must not be able to widen what a
 * Baby Class paper may contain.
 *
 * No band rule is written into a prompt. buildBandDirective() renders the
 * resolved document into prompt text at call time, so correcting a band in
 * Firestore changes what the model is told without a deploy.
 */

const admin = require("firebase-admin");
const core = require("./assessmentBandsCore");

const {
  BAND_IDS, ASSESSMENT_BAND_SEED, LEVEL_TO_BAND, validateBand, levelIdForGrade,
} = core;

let _cache = null;

/** Clear the cached read — tests, and after a band is edited. */
function resetBandCache() {
  _cache = null;
}

/**
 * Load every band, Firestore first, defaults as fallback. Never throws.
 * @returns {Promise<{bands: object, source: string}>}
 */
async function loadAssessmentBands() {
  if (_cache) return _cache;
  const bands = {};
  let fromStore = 0;
  try {
    const snap = await admin.firestore().collection("assessmentBands").get();
    snap.forEach((doc) => {
      const data = Object.assign({}, doc.data(), {id: doc.id});
      const problems = validateBand(data);
      if (problems.length > 0) {
        console.warn(`assessmentBands: ignoring invalid band "${doc.id}"`, problems);
        return;
      }
      bands[doc.id] = data;
      fromStore += 1;
    });
  } catch (err) {
    console.warn("assessmentBands: read failed, using published defaults", err);
  }
  for (const id of BAND_IDS) {
    if (!bands[id]) bands[id] = ASSESSMENT_BAND_SEED[id];
  }
  _cache = {
    bands,
    source: fromStore === 0 ? "seed" :
      (fromStore === BAND_IDS.length ? "firestore" : "mixed"),
  };
  return _cache;
}

/** The band governing a grade token, or null when it resolves to no level. */
async function bandForGrade(grade) {
  const bandId = LEVEL_TO_BAND[levelIdForGrade(grade)];
  if (!bandId) return null;
  const {bands} = await loadAssessmentBands();
  return bands[bandId] || null;
}

module.exports = {
  // Everything pure comes from the core so there is exactly one definition.
  ...core,
  // Firestore-backed reads.
  loadAssessmentBands,
  bandForGrade,
  resetBandCache,
};
