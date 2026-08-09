/**
 * Public surface of the Weekly Forecast — the studio at
 * `/teacher/generate/weekly-forecast` that turns one week of a scheme of work
 * into the forecast a Zambian school files, the renderer that draws a saved
 * forecast, and the table a teacher edits it in.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same callable, same
 * Firestore reads and writes, same route.
 *
 * ── Two exported names, mirroring `schemeOfWork` ────────────────────────
 *
 * `WeeklyForecastView` is drawn by four surfaces with nothing else to do with
 * this studio — the library detail page, the public share page, `LockedStudio`
 * and the `/teachers` marketing page — and `WeeklyForecastEditableTable` by the
 * library detail page. The studio page is NOT exported: it is route-mounted.
 *
 * `weeklyForecastToDocx` went to `src/engines/export-engine/` and
 * `LibraryItemDetail` imports it from there directly, for the reason
 * `check:bundle-edges` now enforces: three of the four view consumers are
 * declared light pages.
 *
 * ── This is the migration that closes the pair, and it fills `shared/utils` ─
 *
 * §13 recorded `schemeOfWork` and `weeklyForecast` as one item because
 * `schemeFormat.js` — the column and curriculum vocabulary — is read by both.
 * It has now moved to `src/shared/utils/`, with `weeklyForecast.js` beside it.
 *
 * `weeklyForecast.js` could not have come into this feature even if it wanted
 * to: `src/engines/export-engine/schemeOfWorkToDocx.js` and its PDF twin call
 * `isOfficialScheme`, and an engine may not import from a feature (§12; the
 * `no-restricted-imports` block and `test:import-boundaries` both refuse it).
 * A module an engine depends on belongs below the engine, which is `shared`.
 * `src/utils/recordOfWork.js` reads it too.
 *
 * Both are dependency-free — no imports at all, no DOM, no React, no Firebase
 * — which is what the shared layer requires and what lets
 * `schemeFormat.test.js` keep running under plain `node`.
 */

export { default as WeeklyForecastView } from './components/WeeklyForecastView'
export { default as WeeklyForecastEditableTable } from './components/WeeklyForecastEditableTable'
