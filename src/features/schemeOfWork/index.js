/**
 * Public surface of the Scheme of Work — the studio at `/teacher/schemes-of-work`
 * that plans a term's teaching week by week against the MoE calendar, the
 * renderer that draws a saved scheme, and the table a teacher edits it in.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same callable, same
 * Firestore reads and writes, same two route mounts.
 *
 * ── Two exported names, because two are consumed ────────────────────────
 *
 * `SchemeOfWorkView` is drawn by four surfaces that have nothing else to do
 * with this studio — the library detail page, the public share page, the
 * free-plan `LockedStudio` sample and the `/teachers` marketing page — and
 * `SchemeEditableTable` by the library detail page, which lets a teacher edit a
 * saved scheme in place. The page is NOT exported: it is reached only by
 * `lazy(() => import(…))` from both route tables, under the route-mount
 * exception Phase 1 recorded.
 *
 * ── The exporters went to the engine, not into `export/` ────────────────
 *
 * `schemeOfWorkToDocx` and `schemeOfWorkToPdf` are now in
 * `src/engines/export-engine/`, the home §12's target map gives them, and
 * `LibraryItemDetail` imports them from there DIRECTLY rather than through this
 * front door. That is the rule `rubric` (#2172) measured and `#2200` made
 * structural: three of the four consumers above want a 4 kB presentational view
 * and nothing else, and one of them is the public share page. Listing an
 * exporter here would put the Word runtime in their chunk — `check:bundle-edges`
 * runs in the required build job with all three declared, so this is now a
 * failing build rather than something to remember.
 *
 * ── What travelled, and what stayed ─────────────────────────────────────
 *
 * Five `src/utils/` modules came across into `lib/` with their node tests,
 * each because this feature was their only consumer: `schemeCalendarDefaults`,
 * `schemeEditing`, `schemeReadiness`, `schemeTermPlan`, `schemeTermDivision`.
 *
 * Three deliberately stayed:
 *
 *   • `schemeFormat.js` — the column/curriculum vocabulary, read by fifteen
 *     modules including the WEEKLY FORECAST studio and two Cloud Functions.
 *     §13 records it moving to `src/shared/utils/` when `weeklyForecast`
 *     migrates, which is the second half of this pair; moving it now would
 *     make the forecast reach through this feature's front door for a column
 *     list.
 *   • `weeklyForecast.js` — same reason, plus `recordOfWork` reads it.
 *   • `schemeEditHistory.js` — the library detail page reads it too.
 *
 * The rule is the one `adminUsers` and `classList` recorded: a module travels
 * when the feature is its only consumer, and stays when it is not.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The page calls `generateSchemeOfWork` and reads/writes `aiGenerations`
 * directly, which §14.2 says should go through `services/`. Not fixed here,
 * under the standing Phase 4 policy that a migration is a pure move.
 */

export { default as SchemeOfWorkView } from './components/SchemeOfWorkView'
export { default as SchemeEditableTable } from './components/SchemeEditableTable'
