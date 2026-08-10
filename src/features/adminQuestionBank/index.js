/**
 * Public surface of the admin Central Question Bank area — Qix's review queue
 * at `/admin/question-review` and the bulk importer at
 * `/admin/import-questions`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same Firestore reads and
 * writes, same callable, same routes.
 *
 * **This front door is deliberately empty.** Both pages are route mounts and
 * nothing composes with them.
 *
 * ── It reads from frozen collections, and that is allowed ───────────────
 *
 * `questionBankImport` queries published `quizzes`, their `questions`
 * subcollections, and legacy `aiGenerations` where `tool == 'exam_paper'`.
 * Quizzes and papers are frozen — but these are READS. The standard set when
 * `/admin/results` migrated holds: the freeze is about the cutover of the code
 * that PRODUCES those documents, not code that reads them. What this area
 * WRITES is `questionBank` and `agentControl/qix`, neither of which is frozen.
 *
 * Stated because the three signals that caught the other admin blockers —
 * what a child writes, what the page writes, what the page imports — all come
 * back clean here, and the reads would look alarming to anyone re-checking
 * without that reasoning written down.
 *
 * ── What travelled ──────────────────────────────────────────────────────
 *
 * `adminQuestionBankService.js` (these two pages are its only readers),
 * `questionBankImport.js` (one reader), and `questionBankImportCore.js` with
 * its node test — nothing outside this feature touches the core, and
 * `test:question-bank-import` is re-pointed in the same commit.
 *
 * ── What did not ────────────────────────────────────────────────────────
 *
 * `questionBankService.js` (13 consumers) and `questionBankCore.js` (6),
 * both reaching into `components/quiz/`, `AssessmentStudio`, the teacher
 * browser, `features/homework` and two migration scripts. They are the shared
 * vocabulary of the bank rather than anything this admin area owns.
 */

export {}
