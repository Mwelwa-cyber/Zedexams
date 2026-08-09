/**
 * Class Timetable — public API (docs/architecture.md §3, §14.7).
 *
 * ONE exported name, because one is consumed. `ClassTimetableView` is the
 * printable document rendered on screen, and four surfaces draw it: this
 * feature's own studio, the library detail page, the public share page and the
 * locked-studio sample.
 *
 * ## The exporters are deliberately NOT here
 *
 * `classTimetableToDocx` / `ToPdf` / `ToXlsx` live in
 * `src/engines/export-engine/` and every consumer imports them BY PATH. Three
 * of this view's four consumers are declared light pages in
 * `check:bundle-edges` — `PublicShareView` (public and SEO-visible),
 * `LockedStudio` and, through them, the marketing surface. Listing an exporter
 * on this index is what #2172 measured: Rollup groups the view into the
 * exporters' chunk, that chunk opens with a static import of `docx-vendor`
 * (382 kB), and a page that needs a 4 kB table gains a static edge to a Word
 * runtime. It is a failing build now rather than something to remember.
 *
 * ## The page is not here either
 *
 * `pages/ClassTimetableStudio` is reached only by `lazy(() => import(…))` from
 * the two route tables, under the route-mount exception. Exporting it would put
 * the whole studio — wizard, workspace, conflict engine, upload panel — into
 * the chunk of anything that wanted the view.
 *
 * ## What did NOT come with the move, and why
 *
 * Five modules went to `src/shared/utils/` instead of into this feature:
 * `classTimetable`, `timetableBlocks`, `timetableSessions`,
 * `timetablePrintTemplates` and `timetableGridModel`. Each is read by the three
 * exporters (directly or transitively) as well as by this feature, and an
 * engine may not import from a feature (§12) — the same forced move
 * `sbaTaskToPaper.js` recorded. `classTimetable` has a legacy consumer too:
 * `src/data/studioSamples.js` builds the locked-studio sample from
 * `buildPeriods`.
 *
 * `teacherTimetableCore.js` stayed in `src/utils/` because it is not this
 * feature's: its four consumers are all in `features/teacherSettings/`, and it
 * migrates when that surface claims it.
 *
 * ## Known debt, recorded rather than tolerated silently
 *
 * `services/timetableExtraction.js` reaches the AI Logic client through a
 * dynamic `import('../../../utils/aiLogic.js')`. That is where it already was;
 * a migration is a move, not a rewrite.
 */

export { default as ClassTimetableView } from './components/ClassTimetableView'
