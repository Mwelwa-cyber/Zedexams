/**
 * Public surface of the Worksheet studio — the worksheet generator at
 * `/teacher/generate/worksheet` (and `/admin/generate/worksheet`) and its
 * renderer.
 *
 * **The studio is WITHDRAWN, not deleted** (2026-08). Its picture-dependent
 * output — tracing sheets, labelled diagrams, story-with-picture — is
 * mislabelled often enough to be unusable in children's materials, so both
 * routes are gated on `settings/global.featureFlags.worksheetStudioEnabled`
 * (default off) until worksheets are rebuilt on a curated, human-verified
 * Diagram Library. Everything in this module still builds and still works;
 * flipping the flag restores the studio and every entry point to it. Saved
 * worksheets stay readable and exportable either way, which is what
 * `WorksheetView` below is for. See `src/config/studioAvailability.js`.
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same routes, same
 * callable, same exporter output.
 *
 * ONE name, consumed by FOUR surfaces outside the studio — the teacher
 * library's detail view, the public share page, the locked-studio sample, and
 * `/teachers`, the marketing page. That last consumer is why this front door
 * is the one where the exporter rule is least optional.
 *
 * THE PAGE IS DELIBERATELY NOT EXPORTED. `pages/WorksheetGenerator.jsx` is
 * reached only by `lazy(() => import('…/pages/WorksheetGenerator'))` in the two
 * route tables, under the route-mount exception Phase 1 recorded.
 *
 * The exporters live in `src/engines/export-engine/` (#2200), and this front door does not re-export them (#2172, #2173, #2177): behind a feature
 * index a docx exporter makes Rollup group the view into its chunk, and that
 * chunk statically imports a 382 kB `docx-vendor`. Three of the four consumers
 * above export nothing and would have downloaded a Word runtime to draw a
 * worksheet. That move happened in #2200, and this file did not change when it
 * did, which is the point of a front door.
 *
 * This is no longer a rule anyone has to remember: `npm run check:bundle-edges`
 * runs in the required "Build + mobile smoke" job and fails if any declared
 * light page — `TeachersLanding` among them — gains that edge.
 */

export { default as WorksheetView } from './components/WorksheetView'
