/**
 * Public surface of the admin home — the `/admin` dashboard: the platform
 * snapshot, the review queue, the quick actions, the recent-results table and
 * the collapsed Developer tools drawer.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin, slice 4),
 * following docs/MIGRATION_TEMPLATE.md. A move: same stats, same queue, same
 * quick actions, same route.
 *
 * **This front door is deliberately empty.** `AdminDashboard` is reached by the
 * `lazy(() => import(…))` mount in App.jsx under the route-mount exception, and
 * the three Developer-tools panels have this page as their only consumer — the
 * same `git grep` before and after the move finds exactly one each.
 *
 * ── This slice exists because of an owner ruling, not a lapsed freeze ────
 *
 * `adminShell/index.js` recorded this dashboard as **frozen**, and it was: it
 * imports `utils/seedData`, whose "seed / clear sample data" buttons create
 * and destroy real `quizzes` documents, and quizzes are frozen by owner
 * instruction until the Phase 3 rollout flags reach 100%. That is still the
 * state of the flags. The owner released THIS cluster on 2026-08-14 against
 * the measured blast radius — the seed buttons are an admin-only developer
 * tool behind a collapsed `<details>`, and nothing here is reachable from a
 * learner-facing runner — and the release does not extend to any other frozen
 * surface. `adminShell`'s note is corrected in the same commit.
 *
 * ── Four files came, and each had exactly one consumer ──────────────────
 *
 * `AdminSetupBanner`, `OpsAlertTester` (+ its spec) and `ParentDigestTester`
 * are rendered by this page and by nothing else, so they are components of it
 * rather than neighbours of it — the distinction `RevenueTrendCard`
 * established. `seedData.js` came for the same reason and landed in
 * `services/` as `seedDataService.js`, since §14.2 puts every Firebase touch
 * there.
 *
 * `utils/deleteQuizWithQuestions.js` did NOT come, and the rule is the same
 * one read the other way: `hooks/useFirestore` also calls it, so it is shared
 * infrastructure and stays in `src/utils/`.
 *
 * ── What `parentShares.js` unblocks ─────────────────────────────────────
 *
 * `features/parentPortal`'s index records `utils/parentShares.js` as pinned in
 * `src/utils/` by `ParentDigestTester` — "a util this feature would otherwise
 * own is pinned by a component in an unrelated part of the tree… It clears
 * when the dashboard's freeze lifts." The freeze has now lifted, so the pin is
 * released, but moving that util is `parentPortal`'s call to make in its own
 * PR rather than a change smuggled into this one. The note there stands as the
 * record of why it is still here.
 */

export {}
