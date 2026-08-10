/**
 * Public surface of the admin observability area — platform analytics at
 * `/admin/analytics`, the visitor log at `/admin/visitors`, and the admin
 * activity log at `/admin/activity`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same Firestore reads, same
 * routes.
 *
 * **This front door is deliberately empty.** All three are reached only by
 * `lazy(() => import(…))` in App.jsx and nothing composes with them.
 *
 * ── Nothing travelled with them, and that is the whole story ────────────
 *
 * The three pages import `firebase/firestore` directly plus shared UI, and
 * nothing else — no util is private to this area, so none moved. They also
 * write nothing: no `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `writeBatch`
 * or callable between them, which is what a read-only observability surface
 * should look like and is checked here rather than assumed. Two of the five
 * admin clusters before this one contained a file that looked local and wrote
 * into a frozen surface; the check is cheap and has already paid twice.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * Queries are inline, which §14.2 would put behind `services/`. Not fixed
 * here, under the standing Phase 4 policy that a migration PR is a pure move.
 * Lower stakes than the neighbouring admin features — these are reads — so
 * this is the area where a later `services/` extraction is cheapest to try.
 */

export {}
