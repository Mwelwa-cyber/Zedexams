/**
 * The Assessment Paper Studio — public API.
 *
 * **This front door is deliberately empty**, on the `templateBank` /
 * `agentsConsole` / `teacherLibrary` / `curriculumBrowsers` precedent and for
 * the same measured reason: after the migration nothing outside this feature
 * imports a module inside it.
 *
 * The studio's two screens (`/teacher/assessment-papers` and the
 * `new` / `:paperId/edit` pair) are reached ONLY through the route mounts in
 * `src/components/teacher/teacherRoutes.jsx`, which import them with
 * `lazy(() => import('…/pages/…'))` under the route-mount exception recorded in
 * architecture.md Phase 1. Re-exporting a page here would put the whole studio
 * — the builder canvas, the scanner, the question bank, the export gate — into
 * the chunk of anything that wanted one small piece of it.
 *
 * Everything else that mentions this area from elsewhere in `src/` is the route
 * STRING (`/teacher/assessment-papers`), not an import: the teacher nav config,
 * the dashboard's link builders, the studio launcher tiles and the library's
 * "open the saved copy" links. A string needs no export.
 *
 * ## What deliberately did NOT travel, and why
 *
 * The travelling set was computed as a fixpoint — **a file moves only if every
 * importer of it also moves** — rather than from reachability, which is the
 * mistake the lesson-plan migration recorded (a dependency closure says what
 * this feature READS, never who else reads it).
 *
 * - `studio/sections/CurriculumPicker.jsx` stays in `src/components/teacher/`.
 *   It is drawn by `curriculum/StudioCurriculumSelector.jsx` **and by
 *   `features/lessonPlanStudio`**, so pulling it in here would have created a
 *   cross-feature import, and `KNOWN_CROSS_FEATURE_IMPORTS` only shrinks.
 * - ~~`studio/assessmentStudio.css` stays~~ — it MOVED on 2026-08-14, to
 *   `src/shared/styles/assessmentStudio.css`. The reason recorded here was
 *   "`views/PaperBlocks.jsx` imports it, and PaperBlocks is shared with the
 *   export/preview pipeline", which was a statement about the freeze rather
 *   than about the stylesheet: PaperBlocks could not move, so neither could
 *   its CSS. With the freeze closed, PaperBlocks is `src/engines/paper-render/`
 *   and the stylesheet's two consumers are that engine and this feature — so
 *   it belongs below both, beside `dashboardV2.css`. `paperPages.css`
 *   did travel — `PaperPagesPreview` is its only consumer.
 * - `studio/lessonStudio.css` stays, unchanged: it is the lesson studio's, and
 *   `CreatePaperModal` / `AssessmentSlideOvers` have always reached back for it.
 * - The paper EXPORTERS (`assessmentToDocx`, `assessmentToPdf`,
 *   `assessmentPaperLayout`, `assessmentAnswerSheet`) stay in `src/utils/`.
 *   They are read by the library detail page, the public share page and the
 *   server export path, so this feature is not their consumer set. They are
 *   also named on `scripts/visual/printAffectingPaths.js` by exact path.
 * - The shared export RULES stay in `functions/shared/assessment/`. They are
 *   imported unchanged by both this studio and the Cloud Functions export
 *   callable, and that single copy is the point (see `functions/shared/README.md`).
 *
 * ## What travelled afterwards, on the same fixpoint
 *
 * Three pure modules were left in `src/components/teacher/` by the migration and
 * moved into `lib/` on 2026-08-15. They are recorded here because the reason they
 * COULD move is the same rule that decided the original travelling set, re-run
 * once the studio was already out: **a file moves only if every importer of it
 * also moves.**
 *
 * - `assessmentStudioMeta.js` — every importer is inside this feature, plus
 *   `assessmentTitle.js` below.
 * - `assessmentTitle.js` — the two-titles module (document title vs printed
 *   header title). Its importers are this feature and `phantomAssessment.js`.
 * - `phantomAssessment.js` — had NO `src/` importer at all: its only consumers
 *   are `scripts/cleanup-phantom-assessments.mjs` and its test. A script
 *   reaching into a feature's `lib/` is the established pattern here (44 scripts
 *   do it, four of them already into this feature), so it costs no debt.
 *
 * The third one is why the set is all-or-nothing rather than a free choice.
 * Moving `assessmentTitle.js` while leaving `phantomAssessment.js` behind would
 * have turned a legacy→legacy import into the legacy tree reaching into a
 * feature's internals — a new `KNOWN_LEGACY_FEATURE_IMPORTS` entry, and that
 * list only shrinks. Moving all three keeps it at three.
 *
 * What stayed, and why the same rule keeps them out:
 *
 * - `paperTaxonomy.js` — read by `TeacherDashboard`, `TopicSubtopicPicker`,
 *   `syllabusTopicOptions.js`, `features/dashboardV2` and
 *   `features/weeklyForecast`. It is also named by exact path on
 *   `scripts/visual/printAffectingPaths.js`, which carries its own note about
 *   the earlier `src/config/paperTaxonomy.js` entry that pointed at nothing.
 * - `questionBankDeepLink.js` — `teacherRoutes.jsx` reads it to carry the query
 *   string across the retired `/teacher/question-bank` redirect.
 * - `mathsSubjects.js` — `src/editor/components/EditorToolbar.jsx` reads it.
 *
 * ## Layout note, recorded rather than silently tolerated
 *
 * Per §14.2 a feature touches Firebase only through `services/`. Three modules
 * live there; `hooks/useAssessmentDraft.js` also reads Firestore directly, and
 * `pages/` still opens its own queries. That is the standing Phase 4 policy —
 * **a migration is a move, not a rewrite** — and splitting the data access is
 * its own PR, where a reviewer can see the change on its own.
 */

export {}
