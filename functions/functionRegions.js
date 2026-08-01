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
// HOW A MIGRATION WAVE WORKS — deploy a TWIN, never move the original:
//   1. Add the export name(s) to `migrated` in functionRegions.json AND to
//      MIGRATED_FUNCTIONS in src/config/functionRegions.js.
//   2. Export the same handler under `<baseName>Africa` with
//      `region: regionFor("<baseName>")` — see passkeyRegionalCallable() in
//      index.js. Both regions serve at once; the original is untouched.
//   3. Verify the twin in production BEFORE any caller points at it.
//   4. Move callers to `getFunctions(app, regionFor('<exportName>'))`.
//   5. Hosting rewrite targets: update `region` in firebase.json only after
//      step 3 — a rewrite naming a region the function does not serve from is
//      a 404 on a PUBLIC url (lencoWebhook, apiWhatsAppWebhook are called by
//      third parties).
//
// WHY A TWIN AND NOT A SAME-NAME CUTOVER. Firebase will not change a live
// function's region in place; the documented procedure is to run both versions
// and retire the old one afterwards. The reason that matters here is Android:
// an installed APK calls whatever region its bundled JS names, and it does not
// update until the user takes a new build. Deleting a us-central1 endpoint
// while old installs still call it breaks those users. Retiring an original is
// a separate, explicitly-approved step behind the checklist in
// docs/architecture/27-function-region-migration.md — never automatic.
//
// NOT EVERYTHING IS ELIGIBLE. africa-south1 is 2nd-generation ONLY, so 1st-gen
// exports (e.g. setUserRole, a functions.auth.user() trigger) cannot move at
// all; and Cloud Scheduler has no African region, so onSchedule functions
// cannot be scheduled from there. Both are enforced by
// scripts/test-function-regions.mjs, not left to this comment.

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
