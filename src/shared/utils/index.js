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
 * `sbaTaskToPaper.js` arrived under the same forced move: `SbaTaskView` renders
 * through it and both SBA exporters build through it.
 *
 * The class-timetable migration brought five more — `classTimetable.js`,
 * `timetableBlocks.js`, `timetableSessions.js`, `timetablePrintTemplates.js`
 * and `timetableGridModel.js` — all of them forced the same way: the three
 * timetable exporters in the engine read them, directly or transitively, and so
 * does `features/classTimetable`. `classTimetable.js` has a legacy reader too
 * (`src/data/studioSamples.js` builds the locked-studio specimen from
 * `buildPeriods`), which is the second half of the same argument: a module more
 * than one layer above depends on belongs below all of them.
 *
 * ## What this layer actually requires
 *
 * No DOM, no React, no Firebase, and no import from a layer above — the last of
 * which `eslint.config.js` enforces and `test:import-boundaries` re-checks.
 *
 * The first three arrivals were also *entirely* dependency-free, and this
 * docblock used to state that as the requirement. Two of the timetable modules
 * are not: `classTimetable.js` reads `src/config/library.js` plus
 * `libraryClassification` and `curriculumFramework` from the legacy `src/utils/`
 * residue, and `timetableGridModel.js` reads `subjectAbbreviations`. Those are
 * downward imports — the same allowance the export engine already relies on for
 * `saveBlob`/`xmlText`/`docxAttribution` — so they are permitted rather than
 * tolerated. What matters for this layer is the DIRECTION, and that every file
 * here stays loadable under plain `node`: `schemeFormat.test.js` and the ten
 * timetable scripts in `scripts/` all import these directly, with no bundler.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
