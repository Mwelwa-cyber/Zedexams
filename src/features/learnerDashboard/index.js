/**
 * Public surface of the classic learner dashboard — the grade hub, results,
 * badges, study plan, calendar and profile. (The subject drill-down —
 * `SubjectDrillDown`, the /practise/:grade/:subjectId course map — was
 * retired; the pages that linked it now point at the /quizzes library.)
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * Distinct from `features/learnerHome`, which is the 2026-07 rebuild. This is
 * the surface that rebuild is replacing; `GradeHub` remains reachable at
 * `/dashboard/classic` as the transition fallback, which is why both exist.
 *
 * ── Two exports; the seven pages are not among them ─────────────────────
 *
 * `InvoicesCard` and `PaymentHistoryCard` are rendered by
 * `features/learnerSettings`' Account panel and `features/teacherSettings`'
 * Subscription panel — billing history belongs on a settings page as much as
 * on a dashboard, so these are genuinely shared rather than duplicated.
 *
 * Everything else is route-mounted with `lazy(() => import(…))`, `GradeHub`
 * alone being 1,882 lines. Exporting a page here would evaluate all of them
 * for a consumer that wanted one billing card.
 *
 * ── Direction is what makes this migratable, and `subscription` not ─────
 *
 * Three pages here import `components/games/` (`gamesUi`,
 * `GameStickerStyles`), and games are frozen. That is fine: the imports point
 * OUTWARD, so the files being edited are the ones moving, and not one frozen
 * file is touched. A feature may import `components/` — that is the layering
 * working as designed.
 *
 * `subscription/` is the mirror image and is therefore NOT migrated:
 * `components/quiz/QuizRunnerV2`, `QuizList` and `components/games/PlayGame`
 * import IT, so moving it would require editing three frozen files. Same
 * relationship, opposite direction, opposite answer.
 *
 * **Both paragraphs are the state at this migration and both targets have since
 * moved (2026-08-14).** `BadgesPage` now reaches `GameBadgeCard` through
 * `features/games`' front door, and `GradeHub` (with `SubjectDrillDown`, before
 * it was retired) draws
 * `GameStickerStyles` from `src/shared/components/` — the games migration sent
 * it down a layer rather than exporting it, because a front door that also
 * exports `GameBadgeCard` would have made those pages fetch
 * `utils/gamesService` and the Firebase client to draw a stylesheet. The
 * reasoning above is kept because the DIRECTION test is what made this feature
 * migratable, and that has not changed.
 *
 * ── One util travelled ──────────────────────────────────────────────────
 *
 * `utils/studyPlanProgress.js`, whose only consumer was `TodayStudyPlan`.
 * `streak`, `gamificationService`, `gameBadgesService`, `referrals`,
 * `invoices` and `hooks/useBadges` all stayed — each has readers elsewhere,
 * `useBadges` in `learnerSettings`' Progress panel.
 */

export { default as InvoicesCard } from './components/InvoicesCard'
export { default as PaymentHistoryCard } from './components/PaymentHistoryCard'
