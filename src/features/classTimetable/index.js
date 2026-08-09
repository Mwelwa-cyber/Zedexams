/**
 * Public surface of the Class Timetable — the studio at
 * `/teacher/generate/class-timetable` where a teacher builds a school
 * timetable (setup wizard, drag-and-drop workspace, conflict panel, photo
 * upload) and the renderer that draws a saved one.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore reads
 * and writes, same two route mounts.
 *
 * ── One exported name ───────────────────────────────────────────────────
 *
 * `ClassTimetableView` is drawn by the library detail page, the public share
 * page and the free-plan `LockedStudio`. Everything else here is the studio's
 * own machinery. The page is route-mounted and NOT exported.
 *
 * The three exporters went to `src/engines/export-engine/`, and their callers
 * reach them there directly.
 *
 * ── The domain model stayed in `src/utils/`, on the recorded rule ───────
 *
 * Five modules did NOT travel, and each fails the same test — the feature is
 * not their only consumer:
 *
 *   • `classTimetable.js` — `src/data/studioSamples.js` reads it too.
 *   • `timetableGridModel.js`, `timetablePrintTemplates.js` — all THREE
 *     exporters build through them, and those now live in the engine. An
 *     engine may not import from a feature (§12), so a module the engine
 *     needs cannot come in here.
 *   • `timetableBlocks.js`, `timetableSessions.js` — `classTimetable.js`
 *     imports them, so they cannot sit above it.
 *
 * They stay in `src/utils/`, which is BELOW both this feature and the engine
 * in the layering, so nothing is violated and nothing is inverted. This is
 * deliberately not the `sbaTaskToPaper.js` / `weeklyForecast.js` treatment:
 * those were single modules with no cluster behind them, and `src/shared/utils`
 * is declared for "cross-cutting building blocks with no domain of their own".
 * A five-module timetable domain model is not that, and putting it there would
 * make the shared layer mean something looser than its own index says.
 *
 * Four modules DID travel into `lib/`, each with only feature consumers:
 * `timetableConflictEngine`, `siblingTimetables`, `timetableCoverage`,
 * `timetableExtraction`.
 *
 * `teacherTimetableCore.js` belongs to `features/teacherSettings/` — its four
 * consumers are all in that feature — and is untouched here.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The studio and `lib/siblingTimetables.js` read Firestore directly, which
 * §14.2 says should go through `services/`. Not fixed here, under the standing
 * Phase 4 policy that a migration is a pure move.
 */

export { default as ClassTimetableView } from './components/ClassTimetableView'
