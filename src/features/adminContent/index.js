/**
 * Public surface of the admin content-operations area — the content manager at
 * `/admin/content`, the CSV quiz importer at `/admin/import/csv`, the
 * agent-output approval queue at `/admin/approvals` and the generation log at
 * `/admin/generations`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same reads, same routes.
 *
 * **This front door is deliberately empty.** All four are reached only by
 * `lazy(() => import(…))` in App.jsx and nothing composes with them.
 *
 * ── `/admin/content` was the page that could not come, and now has ──────
 *
 * The note this replaces recorded `ManageContent.jsx` (1,304 lines) as the
 * obvious centre of this cluster and **frozen** — on an import rather than a
 * write: it renders `components/quiz/ImportReviewBadge`, and `components/quiz/`
 * is named on the freeze list by path. It also reads `utils/pastPapers`,
 * converts papers into quiz drafts through `paperToQuizConverter`, and links
 * quizzes to papers via `quizPaperLink.js`. Four separate reasons, any one
 * sufficient. `AdminCsvImport.jsx` was frozen on the same test one hop further
 * out — its publish step reaches `createQuiz`.
 *
 * **Both were released by owner ruling on 2026-08-14** and are here. The
 * reasoning above was not wrong and is kept: the Phase 3 rollout flags have
 * NOT reached 100%, `components/quiz/` is still frozen, and `ManageContent`
 * still imports `ImportReviewBadge` from it across the legacy boundary. What
 * changed is that the owner weighed these two surfaces specifically. Nothing
 * here licenses moving anything else the freeze names.
 *
 * `quizPaperLink.js` + its node test came too — they are pure link-description
 * rules private to `ManageContent`, so they land in `lib/`
 * (`npm run test:quiz-paper-link` follows the file).
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
