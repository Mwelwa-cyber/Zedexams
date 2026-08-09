/**
 * Shared pure utilities — the residue of `src/utils/` that genuinely belongs to
 * no single feature (formatting, ids, dates, text).
 *
 * `src/utils/` is subdivided as each owning feature migrates, so a file
 * arrives here only after its callers show it has no owner — moving one early
 * just relocates the flat bucket.
 *
 * The first two arrived with the `schemeOfWork` + `weeklyForecast` pair, and
 * each earned it a different way:
 *
 *   • `schemeFormat.js` — the column and curriculum vocabulary BOTH studios
 *     are built on, plus the template bank and `frameworkSubjectMatch`. §13
 *     recorded it moving here on the second of the pair precisely so neither
 *     studio would have to reach through the other's front door for a column
 *     list.
 *   • `weeklyForecast.js` — could not have gone into a feature at all.
 *     `src/engines/export-engine/schemeOfWorkToDocx.js` and its PDF twin call
 *     `isOfficialScheme`, and an engine may not import from a feature (§12).
 *     A module an engine depends on belongs below the engine.
 *
 * Both are dependency-free — no imports, no DOM, no React, no Firebase — which
 * is what this layer requires and what keeps `schemeFormat.test.js` runnable
 * under plain `node`.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
