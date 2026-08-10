/**
 * Public surface of the admin learner-records area — the learner roster at
 * `/admin/learners`, one learner's record at `/admin/learners/:learnerId`, and
 * the results table at `/admin/results`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same Firestore reads, same
 * routes.
 *
 * **This front door is deliberately empty.** All three are reached only by
 * `lazy(() => import(…))` in App.jsx and nothing composes with them.
 *
 * ── All three are READ-ONLY, and that is what let them travel together ──
 *
 * None of them writes: no `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`,
 * `writeBatch` or callable in any of the three. `/admin/results` reads quiz
 * and exam results, which sounds like it should be caught by the Assessment
 * Engine freeze, and is not — the freeze is about the cutover of code that
 * PRODUCES those documents. A table that reads them and renders them has no
 * part in it. Checked rather than assumed, because the reverse mistake is the
 * one #2275 caught.
 *
 * ── `AdminCsvImport` was in this cluster and did NOT come ───────────────
 *
 * `/admin/import/csv` sits beside these pages and is about admin data entry,
 * so it read as a fourth file. It **creates quizzes and their questions** and
 * navigates to `/admin/quizzes/:id/edit` — a quiz-authoring surface, frozen by
 * the same instruction and for the same reason `BulkPublishQuizzesButton` is.
 * It waits for the rollout flags.
 *
 * ── What did not travel ─────────────────────────────────────────────────
 *
 * `csvExport.js`. Its own docblock claims "AdminLearners, AdminLearnerProfile
 * and TeacherLibrary"; two of those three are stale — only `AdminLearners`
 * imports it here, and its other live consumer is
 * `utils/attendanceExportService.js`, which belongs to the class register.
 * So it stays, and it stays for a REASON that outlives this migration: the
 * register will want it. The docblock is corrected in the same commit, since
 * a stale consumer list is exactly what a migration decision gets made on.
 */

export {}
