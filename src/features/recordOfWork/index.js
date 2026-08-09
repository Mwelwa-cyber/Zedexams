/**
 * Public surface of the Record of Work — the studio at
 * `/teacher/generate/record-of-work` where a teacher records what was
 * ACTUALLY taught against what the scheme planned, and the renderer that draws
 * a saved record.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore reads
 * and writes, same route. Session A's second half of the recorded
 * `markSchedule`/`recordOfWork` pair.
 *
 * ── One exported name, five consumers ───────────────────────────────────
 *
 * `RecordOfWorkView` is drawn by the library detail page, the public share
 * page, `LockedStudio`, the `/teachers` marketing page and this feature's own
 * studio. Three of those are declared light pages, so `recordOfWorkToDocx`
 * sits in `src/engines/export-engine/` and its callers reach it there.
 *
 * ── `recordOfWork.js` went to `src/shared/utils/` ───────────────────────
 *
 * The engine exporter builds through it, this feature reads it twice, and
 * `lib/recordOfWorkPlanning.js` imports it — a module the engine depends on
 * cannot live in a feature (§12). It also sits beside `weeklyForecast.js`,
 * which it imports for `schemeWeeks`/`weekNumberOf`/`normalizeSchemeWeek`;
 * that module moved to this layer for the same reason two migrations ago, so
 * the import is now a same-directory one rather than a reach across the tree.
 *
 * ── What travelled and what stayed ─────────────────────────────────────
 *
 * `recordOfWorkPlanning.js` and `recordOfWorkVariance.js` came into `lib/` —
 * this studio is their only consumer. `recordOfWorkStatus.js` did NOT:
 * `TeacherDashboard` and `utils/teacherRecommendations.js` read it, both
 * legacy, so it stays in `src/utils/`, which is below this feature. It travels
 * when its remaining callers do.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The studio reads and writes `aiGenerations` directly, which §14.2 says
 * should go through `services/`. Not fixed here, under the standing Phase 4
 * policy that a migration is a pure move.
 */

export { default as RecordOfWorkView } from './components/RecordOfWorkView'
