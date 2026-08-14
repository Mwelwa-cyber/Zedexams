/**
 * Public surface of learner search — `/search`, the one place a learner can
 * look across quizzes, past papers, notes, lessons and games at once.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * **This front door is deliberately empty.** The page is route-mounted with
 * `lazy(() => import(…))` under the route-mount exception and nothing else
 * imports it.
 *
 * ── `useLearnerSearch` stayed in `src/hooks/`, and the reason is a gap ──
 *
 * The hook's only consumer is this page, so by the usual rule it should have
 * travelled. At the time of the migration it could not: it imports
 * `fetchLearnerNotes` from `notes`, which was then a migrated feature with NO
 * `index.js` at all — so inside a feature that import became a cross-feature
 * one with no front door to route through, trading one debt entry for another.
 *
 * `notes` has a front door now, and the hook's import goes through it: the
 * legacy entry is retired rather than moved. The hook still lives in
 * `src/hooks/`, which costs nothing — a feature may import `src/hooks/` — and
 * moving it is now an ordinary follow-up rather than something blocked.
 *
 * `utils/learnerSearch` (the ranking and grouping rules) stays with the hook
 * for the same reason: the hook is its only consumer, and the hook is staying.
 */

export {}
