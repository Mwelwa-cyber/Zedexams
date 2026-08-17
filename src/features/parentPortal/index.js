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
 * The PAGES are deliberately not exported (`FamilyHome`, `ChildProgressPage`,
 * `ParentProgressView`, `ParentNotificationsPage`). Route tables mount them
 * with `lazy(() => import(…))` under the route-mount exception; re-exporting a
 * page here would drag the whole portal into `learnerSettings`' chunk, which
 * wanted two panels.
 *
 * `lib/parentNotificationView.js` is not exported either, for the ordinary
 * reason: it is this feature's own view model, and nothing outside the inbox
 * screen reads it. Its rules are pinned under plain node in
 * `scripts/test-parent-notification-view.mjs`, which imports the file by path
 * — a test harness, not a consumer.
 *
 * ── `parentShares` did not travel with the feature, and now has ─────────
 *
 * `services/familyPortal.js` came with the feature: the parent portal was its
 * only consumer. `src/utils/parentShares.js` stayed, because it was also read
 * by `admin/ParentDigestTester.jsx` — frozen at the time as a sole-consumer
 * child of `AdminDashboard` (that page writes `collection(db, 'quizzes')`
 * through `seedData`). A util this feature would otherwise own, pinned in
 * `src/utils/` by a component in an unrelated part of the tree, for a reason
 * with nothing to do with parents. It was recorded as clearing when the
 * dashboard's freeze lifted.
 *
 * **It lifted (Wave 4 slice 4), and the util SPLIT rather than moving here.**
 * The note above expected a straight move, and by then that would have been
 * wrong: the file had readers in TWO features, so bringing it here whole would
 * have made `adminHome` import `parentPortal` — a cross-feature entry on a
 * list that only shrinks, which is exactly the trap `learnerSearch`'s entry
 * names (converting one debt entry into another).
 *
 * The file was doing two jobs and its own docblock already said so:
 * `triggerWeeklyParentDigest` was marked *"Admin-only"*. The share flow is
 * `services/parentShareService.js` here; the digest trigger is
 * `features/adminHome/services/parentDigestService.js`, beside its one
 * consumer. **Neither feature reaches across, and the cross-feature count is
 * unchanged.**
 */

export { default as ParentShareManager } from './components/ParentShareManager'
export { default as FamilyCodePanel } from './components/FamilyCodePanel'
