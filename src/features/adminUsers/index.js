/**
 * Public surface of the admin Users area — the roster at `/admin/users`
 * (also mounted as `/admin/teachers` and `/admin/admins` with a different
 * `defaultRole`) and the per-account profile at `/admin/users/:userId`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 3, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore reads
 * and writes, same routes.
 *
 * **This front door is deliberately empty.** Both pages are reached only by
 * `lazy(() => import('…/pages/…'))` in App.jsx under the route-mount exception
 * Phase 1 recorded, and `UserStatusBadge` is used by those two pages and
 * nothing else. Phase 2's rule is to export what is consumed today; that set
 * is empty. The file exists because the boundary is real to state (§14.7).
 *
 * ── Why no util travelled with it ───────────────────────────────────────
 *
 * Unlike `companyHQ`, which took the two modules that were private to it,
 * every util this area uses is genuinely shared:
 *
 *   • `adminUsersService.js` — also `PaymentsPanel`. Moving it would make an
 *     unrelated admin page import through this feature's front door to reach
 *     a service that is not about this feature.
 *   • `requestControl.js` (14 importers) and `requestDeduplication.js` (10) —
 *     general request infrastructure used across teacher, learner and admin
 *     surfaces. They belong in `src/shared/` when that layer is populated, not
 *     here.
 *
 * The rule the two cases share: a util travels when the feature is its only
 * consumer, and stays when it is not. Pulling a shared module into a feature
 * to tidy one page's import paths inverts the dependency for everyone else.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * Both pages read and write Firestore directly, which §14.2 says should go
 * through `services/`. Not fixed here, under the standing Phase 4 policy that
 * a migration is a pure move — and this area writes user ROLE and STATUS
 * fields, so a refactor of those call sites wants its own diff and its own
 * review rather than riding along inside a file move.
 */

export {}
