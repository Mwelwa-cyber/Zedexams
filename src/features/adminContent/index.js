/**
 * Public surface of the admin content-operations area — the agent-output
 * approval queue at `/admin/approvals` and the generation log at
 * `/admin/generations`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same reads, same routes.
 *
 * **This front door is deliberately empty.** Both are reached only by
 * `lazy(() => import(…))` in App.jsx and nothing composes with them.
 *
 * ── `/admin/content` is the third page here and did NOT come ────────────
 *
 * `ManageContent.jsx` (1,304 lines) is the obvious centre of this cluster —
 * it is literally the content manager. It is **frozen**, and unlike the two
 * previous cases the evidence is an import rather than a write: it imports
 * `components/quiz/ImportReviewBadge`, and `components/quiz/` is named on the
 * freeze list by path. It also reads `utils/pastPapers`, converts papers into
 * quiz drafts through `paperToQuizConverter`, and links quizzes to papers via
 * `quizPaperLink.js`. Four separate reasons, any one sufficient.
 *
 * `quizPaperLink.js` + its node test live in `components/admin/` and are
 * private to that page, so they wait with it.
 *
 * That is now three of seven admin clusters in which the file that looked
 * most central was the one that could not move.
 *
 * ── What did not travel ─────────────────────────────────────────────────
 *
 * Neither page owns a util. `adminGenerationsService.js` is shared with
 * `AdminDashboard` and `features/teacherLibrary`; `teacherLibraryService.js`
 * has ~50 consumers across the teacher surfaces. Both stay for the ordinary
 * reason.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * Neither page writes inline — the mutations already sit behind
 * `adminGenerationsService`. §14.2 is closer to satisfied here than anywhere
 * else in admin, which is a property of how these two were written rather
 * than anything this migration did.
 */

export {}
