/**
 * The curriculum catalog — the Curriculum Engine's view of the taxonomy.
 *
 * This module RE-EXPORTS and nothing else (docs/architecture.md §5, §14.4).
 * `src/config/canonicalEducation.js` is the single taxonomy root and
 * `src/config/educationLevels.js` is its derived level registry; both keep
 * their existing paths, and every current importer keeps working unchanged.
 * What this adds is one entry point for the code that migrates into
 * `src/curriculum/` next, so a resolver reaches the taxonomy through the engine
 * it belongs to rather than reaching across into `src/config/`.
 *
 * Why `export *` rather than a named list: a hand-written list of ~50 names is
 * a second registry in everything but name — it drifts the first time the
 * canonical model gains an export, and it drifts silently, because the missing
 * name only shows up at the call site that wanted it.
 * `scripts/test-curriculum-engine-catalog.mjs`
 * (`npm run test:curriculum-engine-catalog`) pins the three properties that
 * make that safe: every export of both roots is
 * reachable here, this module adds none of its own, and the two roots share no
 * export name — an `export *` collision is silent in ESM, so it is asserted
 * rather than assumed.
 *
 * Adding a resolver? It goes in `src/curriculum/resolvers/`, not here. This
 * file stays a re-export.
 */

export * from '../../config/canonicalEducation.js'
export * from '../../config/educationLevels.js'
