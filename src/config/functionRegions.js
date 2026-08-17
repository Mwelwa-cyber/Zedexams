// Client half of the Cloud Functions region registry for the staged
// us-central1 → africa-south1 migration.
//
// This MIRRORS functions/functionRegions.json (the server's copy). The two are
// kept honest by scripts/test-function-regions.mjs, which fails CI the moment
// they disagree — the same arrangement the (since-removed) passkey region
// mirror used. A single shared file would be
// nicer in theory, but the server must resolve its region SYNCHRONOUSLY from
// CommonJS at module load (firebase deploy discovers regions by running the
// source), and a JSON import needs `with { type: 'json' }` to work in plain
// Node — a bundler-dependent detail to hang a public URL on. A mirror plus a
// runnable guard is the arrangement this repo already trusts.
//
// Every `getFunctions(app, …)` call site must name its region through this
// module rather than a literal, because a callable is ADDRESSED by region:
// pointing the client at a region the function no longer serves from is a
// `functions/not-found`, not merely a slow call.
//
// See functions/functionRegions.js for how a migration wave is run.

export const LEGACY_REGION = 'us-central1'
export const FIRESTORE_REGION = 'africa-south1'

// Function exports that have MOVED to the Firestore region. Keep in sync with
// `migrated` in functions/functionRegions.json — the guard test compares them.
export const MIGRATED_FUNCTIONS = Object.freeze([])

const MIGRATED = new Set(MIGRATED_FUNCTIONS)

/**
 * The region a given function export serves from. Unknown/unmigrated names
 * resolve to the legacy region — a typo is a no-op rather than a call into a
 * region nothing is deployed in; the guard test is what catches the typo.
 */
export function regionFor(exportName) {
  if (typeof exportName !== 'string' || !exportName) {
    throw new TypeError("regionFor() needs the function's export name")
  }
  return MIGRATED.has(exportName) ? FIRESTORE_REGION : LEGACY_REGION
}

/** True once `exportName` has been moved to the Firestore region. */
export function isMigrated(exportName) {
  return MIGRATED.has(exportName)
}
