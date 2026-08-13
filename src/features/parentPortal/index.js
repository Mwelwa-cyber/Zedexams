/**
 * Public surface of the parent portal — the family side of the product:
 * a parent's linked children, one child's progress, the learner-side controls
 * for granting and revoking that access, and the signed-out share link.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4), following
 * docs/MIGRATION_TEMPLATE.md.
 *
 * ── This front door is NOT empty, and that is the point ─────────────────
 *
 * The three admin slices before this one all had empty indexes: their pages
 * were route-mounted and nothing else imported them. Here a second feature
 * genuinely consumes two components — `learnerSettings`' Parent panel renders
 * `ParentShareManager` and `FamilyCodePanel`, because the controls for who may
 * see a learner's progress belong on the LEARNER's settings page, not in the
 * parent's own portal. So those two, and only those two, are exported.
 *
 * Before the move that was `features/learnerSettings` reaching into
 * `components/parent/` — legal only because the target was not a feature. It
 * is now a declared dependency between two features through the front door,
 * which is what §14.7 asks for and what the boundary guard can actually see.
 *
 * The three PAGES are deliberately not exported (`FamilyHome`,
 * `ChildProgressPage`, `ParentProgressView`). Route tables mount them with
 * `lazy(() => import(…))` under the route-mount exception; re-exporting a page
 * here would drag the whole portal into `learnerSettings`' chunk, which wanted
 * two panels.
 *
 * ── `parentShares` did NOT travel, and the freeze is why ────────────────
 *
 * `services/familyPortal.js` came with the feature: the parent portal was its
 * only consumer. `src/utils/parentShares.js` stayed, because it is also read
 * by `admin/ParentDigestTester.jsx` — which is frozen, as a sole-consumer
 * child of `AdminDashboard` (that page writes `collection(db, 'quizzes')`
 * through `seedData`).
 *
 * So a util this feature would otherwise own is pinned in `src/utils/` by a
 * component in a completely unrelated part of the tree, for a reason that has
 * nothing to do with parents. It clears when the dashboard's freeze lifts;
 * recorded here so the next person does not re-derive it.
 */

export { default as ParentShareManager } from './components/ParentShareManager'
export { default as FamilyCodePanel } from './components/FamilyCodePanel'
