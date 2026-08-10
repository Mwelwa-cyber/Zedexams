/**
 * Public surface of the admin curriculum-versioning area — replacing an
 * active syllabus at `/admin/curriculum/replace` and uploading curriculum
 * source documents at `/admin/curriculum-upload`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same Storage uploads, same
 * callables, same routes.
 *
 * **This front door is deliberately empty.** Both pages are reached only by
 * `lazy(() => import(…))` in App.jsx under the route-mount exception, and
 * nothing composes with either.
 *
 * ── Why the CBC KB editor is NOT here, though it is the same subject ────
 *
 * `/admin/cbc-kb` (`CbcKbAdmin.jsx`, 3,052 lines) is the third curriculum
 * surface and the obvious fourth file for this feature. It is **blocked by the
 * Assessment Engine freeze**, and the block is in its children rather than in
 * the page:
 *
 *   • `ExamPaperLibraryPanel` analyses uploaded assessment papers into the
 *     format profiles the assessment GENERATOR grounds on — squarely inside
 *     "anything the assessment engine cutover involves".
 *   • `BulkPublishQuizzesButton` writes directly to the public `quizzes`
 *     collection, and quizzes are frozen by the same instruction.
 *
 * Both are private to `CbcKbAdmin` — it is their only consumer — so the page
 * cannot migrate without either taking them along or splitting a cohesive
 * screen across two homes. It waits for the rollout flags. Recorded here
 * because the grouping looks obvious from a directory listing and is wrong.
 *
 * ── What travelled, and what could not ──────────────────────────────────
 *
 * `syllabusReplaceService.js` came with it — `CurriculumReplaceStudio` was its
 * only consumer.
 *
 * `adminCbcKbService.js` stayed. Four files read it and two of them are the
 * frozen `CbcKbAdmin` group, so it cannot travel until that page can. When it
 * does, both halves move together. `syllabusKbService` (15 consumers) and
 * `syllabusMapping` (8) stay for the ordinary reason: a util travels when the
 * feature is its only consumer.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * Storage uploads, callables and Firestore writes are inline, which §14.2
 * would put behind `services/`. Not fixed here, under the standing Phase 4
 * policy that a migration PR is a pure move — and this area REPLACES a live
 * syllabus version, so a refactor of those call sites wants its own review.
 */

export {}
