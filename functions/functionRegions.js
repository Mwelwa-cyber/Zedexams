// Cloud Functions region registry — the single source of truth for the staged
// us-central1 → africa-south1 migration of the HTTP/callable surface.
//
// WHY A JSON FILE AND NOT functions/shared/ (the usual shared-module home):
// `onCall({region})` is evaluated at MODULE LOAD, and `firebase deploy`
// discovers a function's region by running this source in a subprocess
// (firebase-tools prepare.js → discoverBuild). The region must therefore
// resolve SYNCHRONOUSLY from CommonJS. functions/shared/ is ESM with its own
// package.json, reachable only via `await import(...)` inside an async handler
// — far too late.
//
// The client mirrors this data in src/config/functionRegions.js rather than
// importing the JSON, because a JSON import needs `with { type: 'json' }` to
// work in plain Node and that is a bundler-dependent detail to hang a public
// URL on. scripts/test-function-regions.mjs fails CI if the two disagree —
// the arrangement passkeyRegions.js ⇄ passkeyRegionCore.js already uses.
//
// HOW A MIGRATION WAVE WORKS:
//   1. Add the export name(s) to `migrated` in functionRegions.json.
//   2. Replace the literal `region: "us-central1"` at the export with
//      `region: regionFor("<exportName>")`.
//   3. Client side: replace `getFunctions(app, 'us-central1')` with
//      `getFunctions(app, regionFor('<exportName>'))` from
//      src/config/functionRegions.js.
//   4. If the function is a Hosting rewrite target, update its `region` in
//      firebase.json in the SAME change — a rewrite pointing at a region the
//      function no longer serves from is a 404 on a public URL.
// Steps 2–4 land together with step 1 on purpose: converting a call site to
// the registry while it still resolves to us-central1 would hide a wrong
// export name until the wave that flips it.
//
// A REGION CHANGE IS DELETE-AND-RECREATE, NOT A MOVE. Firebase creates the
// function in the new region and the old one must be deleted separately; for
// the window between the two, a caller can reach neither. Waves are therefore
// small and never include a Hosting rewrite target and its callers in
// different deploys.

const registry = require("./functionRegions.json");

const LEGACY_REGION = registry.legacyRegion;
// Where the (default) Firestore database lives — colocating the callables here
// is the whole point of the migration.
const FIRESTORE_REGION = registry.firestoreRegion;

const MIGRATED = new Set(registry.migrated);

/**
 * The region a given function export serves from. Unknown/unmigrated names
 * resolve to the legacy region, so a typo is a no-op rather than an
 * accidental move — `test:function-regions` is what catches the typo.
 */
function regionFor(exportName) {
  if (typeof exportName !== "string" || !exportName) {
    throw new TypeError("regionFor() needs the function's export name");
  }
  return MIGRATED.has(exportName) ? FIRESTORE_REGION : LEGACY_REGION;
}

/** True once `exportName` has been moved to the Firestore region. */
function isMigrated(exportName) {
  return MIGRATED.has(exportName);
}

module.exports = {
  LEGACY_REGION,
  FIRESTORE_REGION,
  MIGRATED_FUNCTIONS: Object.freeze([...registry.migrated]),
  regionFor,
  isMigrated,
};
