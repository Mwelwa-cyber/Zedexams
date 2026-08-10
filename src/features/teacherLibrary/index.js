/**
 * Teacher Library — public API (docs/architecture.md §3, §14.7).
 *
 * **This front door exports nothing, and that is the honest answer rather than
 * an omission.** Every reference to this area from the rest of `src/` is the
 * route STRING `/teacher/library/:id` — in nav configs, in the dashboard's link
 * builders, in `utils/prepareThisWeek.js`, in `utils/teacherReminders.js`, and
 * in a dozen studio "open the saved copy" links. Not one of them is an import.
 * The only module-level consumers are three lazy route mounts: `TeacherLibrary`
 * and `LibraryItemDetail` from `teacherRoutes.jsx`, and `LibraryItemDetail` +
 * `PublicShareView` from `App.jsx`.
 *
 * Exporting a page here would put a 1,500-line document viewer — and the ELEVEN
 * feature front doors it composes — into the chunk of whatever imported it.
 * `templateBank`, `companyHQ`, `adminUsers`, `agentsConsole` and
 * `curriculumBrowsers` all reached the same empty index for the same reason.
 * Inventing an API for a caller that does not exist is how a front door becomes
 * a barrel.
 *
 * ## What lives here
 *
 *   pages/  TeacherLibrary      — the library index at /teacher/library
 *           LibraryItemDetail   — one saved document: render, edit, export
 *           PublicShareView     — the signed-out /share/:token page
 *   lib/    planPayload         — what a studio hands back to a saved plan
 *           studioPresentation  — the tool→label/icon presentation table
 *
 * `PublicShareView` is not a "teacher library" page by its route, and it is here
 * anyway: it shares `LibraryItemDetail`'s renderer switch over `tool`, and the
 * two must agree about which view draws a saved artifact and whether answers are
 * shown. Splitting them would put that agreement across a feature boundary. A
 * migration is a move, so it travelled with the file it has to stay in step
 * with.
 *
 * ## This feature is the export engine's biggest consumer, and imports it by path
 *
 * `LibraryItemDetail` reaches 28 exporters. Twenty-two are in
 * `src/engines/export-engine/` and are imported ONE BY PATH each — never through
 * a barrel, per that engine's index. The remaining six are still in
 * `src/utils/` (`activityToDocx`, `fullLessonToDocx`/`ToPdf`,
 * `lessonPlanToDocx`/`ToPdf`, `reportCardsToDocx`), each recorded on
 * `test:exporter-home`'s shrink-only list against the feature that will bring it
 * across. This migration moves none of them: they belong to the lesson-plan
 * studio, the retired Full Lesson tool and the class register, not to the page
 * that happens to call them.
 *
 * ## Known debt, recorded rather than tolerated silently
 *
 * All three pages read Firestore directly instead of through `services/`
 * (§14.2). That is where they already were, and extracting it is a redesign of
 * how the library loads and refreshes — its own PR, on a tree where the file
 * move has already landed and cannot be confused with it. Same call
 * `companyHQ` and `agentsConsole` recorded.
 */

export {}
