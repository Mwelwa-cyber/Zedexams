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
 * travelled. It did not, because it imports
 * `features/notes/lib/firestore` — one of the four remaining entries on
 * `KNOWN_LEGACY_FEATURE_IMPORTS`. Inside a feature that same import becomes a
 * CROSS-feature one, and it cannot be routed through a front door because
 * **`features/notes` has no `index.js`**: it is a migrated feature with no
 * public surface at all.
 *
 * So moving the hook would have converted one debt entry into another and
 * pushed the cross-feature count from 3 to 4. Leaving it costs nothing — a
 * feature may import `src/hooks/` — and keeps the debt where it can still be
 * retired by giving `notes` a front door, which is its own change.
 *
 * `utils/learnerSearch` (the ranking and grouping rules) stays with the hook
 * for the same reason: the hook is its only consumer, and the hook is staying.
 */

export {}
