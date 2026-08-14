/**
 * Public surface of the CBC Knowledge Base admin — `/admin/cbc-kb`, where the
 * curriculum KB is browsed and edited, syllabus PDFs are uploaded for parsing,
 * assessment papers are analysed into the library, and content is bulk-queued
 * or bulk-published against a topic.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin, slice 6),
 * following docs/MIGRATION_TEMPLATE.md. A move: same panels, same KB reads and
 * writes, same route.
 *
 * **This front door is deliberately empty.** `CbcKbAdmin` is reached by the
 * `lazy(() => import(…))` mount in App.jsx under the route-mount exception, and
 * each of the four panels has this page as its only consumer.
 *
 * ── This is the cluster that CLOSED the admin row ───────────────────────
 *
 * architecture.md recorded the row shut on it: *"The admin row is CLOSED to
 * further slices, and `CbcKbAdmin` is the reason."* The finding was that the
 * last apparently-migratable thing in `components/admin/` was inside the
 * freeze after all, on the same dependency test that caught `AdminCsvImport`
 * and `AdminDashboard` — this page renders `BulkPublishQuizzesButton`, whose
 * own docblock says it *"writes directly to the public quizzes collection"*
 * via `createQuiz` + `saveQuestions`, and `ExamPaperLibraryPanel` besides.
 *
 * That was reported rather than interpreted, per §14 rule 3, and the owner
 * ruled on 2026-08-14: released. **The quiz freeze itself has not lifted** —
 * the Phase 3 rollout flags are not at 100%. (Still true of the flags; but the freeze itself was CLOSED by owner ruling on 2026-08-14 and every surface below has migrated.) `components/quiz/` and
 * `components/games/` are untouched, and `PastPaperStudio`, `CreateQuizV2`,
 * `AdminPastPapers` and `GamesSeedAdmin` all stay exactly where they are. A
 * reader arriving here should not read this move as the freeze having lapsed.
 *
 * ── Four panels came; every shared util stayed ──────────────────────────
 *
 * `SyllabusPdfUploadPanel`, `BulkGenerateButton`, `BulkPublishQuizzesButton`
 * and `ExamPaperLibraryPanel` are rendered by this page and nothing else, so
 * they are its components. (`BulkGenerateButton` has a second importer —
 * `BulkPublishQuizzesButton`, which is inside this cluster too.)
 *
 * Not one util travelled, and the measured reason is that none is private
 * here: `adminCbcKbService` is also read by `features/adminCurriculum` and by
 * two Cloud Functions modules; `syllabusKbService` and `syllabusMapping` have
 * upwards of a dozen consumers each across the teacher surfaces, plus eight
 * `scripts/` entry points; `aiAssistant` is read by fifteen modules. Each is
 * shared infrastructure and stays in `src/utils/`.
 *
 * ── §14.2 is NOT satisfied here, and that is deliberate ─────────────────
 *
 * Two panels write Firestore inline rather than through `services/`:
 * `BulkGenerateButton` does `addDoc(collection(db, 'agentJobs'), …)` and
 * `BulkPublishQuizzesButton` creates quizzes and saves questions through
 * `useFirestore`. The layered rule says a feature touches Firebase in
 * `services/` and nowhere else.
 *
 * Extracting them was not done, because a migration is a move and not a
 * rewrite — and because the one path that would be restructured is the quiz
 * bulk-publish path, which is still inside the live freeze even though this
 * page is no longer blocked by it. Moving the code and rewriting how it
 * writes to `quizzes`, in one commit, is exactly the change that should not be
 * reviewed as a move. Recorded as debt rather than left to be discovered.
 *
 * ── The stylesheet this page carries is checked by path, twice ──────────
 *
 * `CbcKbAdmin` ships a `.ss-root` stylesheet inside a JSX template literal, so
 * it never reaches a `.css` file. `teacherDarkSurface.test.js` and
 * `scripts/audit-dark-surfaces.mjs` both `readFileSync` it BY PATH to check
 * the Night palette is declared. Both were updated in the migration commit —
 * the template's fifth hiding place, and the one that is a string in a list
 * rather than an import.
 */

export {}
