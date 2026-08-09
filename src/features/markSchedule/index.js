/**
 * Public surface of the Mark Schedule — the studio at
 * `/teacher/generate/mark-schedule` that lays out a term's assessment plan and
 * its mark allocations, and the renderer that draws a saved one.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore reads
 * and writes, same route.
 *
 * ── One exported name, and an unusually wide set of consumers ───────────
 *
 * `MarkScheduleView` is drawn by FOUR surfaces outside this feature — the
 * library detail page, the public share page, the free-plan `LockedStudio`,
 * and the `/teachers` marketing page. Three of those are declared light pages
 * in `check:bundle-edges`, which is why the two exporters are in
 * `src/engines/export-engine/` and reached there directly rather than listed
 * here. The studio page is route-mounted and NOT exported.
 *
 * ── `markSchedule.js` went to `src/shared/utils/` ───────────────────────
 *
 * Six modules read it, across three layers: this feature, both exporters in
 * the engine, `reportCardsToDocx` and `classRecordExport` in the legacy
 * residue, and the marketing page. That is the shape #2220 recorded for the
 * timetable modules — a module more than one layer above depends on belongs
 * below all of them — and it satisfies what the layer requires: no DOM, no
 * React, no Firebase, no upward import, and loadable under plain `node`, which
 * `scripts/test-mark-schedule.mjs` relies on.
 *
 * ── What stayed ────────────────────────────────────────────────────────
 *
 * `teacher/register/MarkSchedulesTab.jsx` is the class register's tab, not
 * this feature's, and migrates with `register` — the same call `sbaCrossYear`
 * got. `ReportsTab` keeps its own direct import of the exporters, which now
 * resolve to the engine.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The studio reads and writes `aiGenerations` directly, which §14.2 says
 * should go through `services/`. Not fixed here, under the standing Phase 4
 * policy that a migration is a pure move.
 */

export { default as MarkScheduleView } from './components/MarkScheduleView'
