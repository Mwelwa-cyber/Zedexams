/**
 * Public surface of shared account settings — the `/settings` page an admin
 * (and any role that is neither learner nor teacher) sees: theme and reading
 * preferences, avatar, notification permissions, accessibility options, the
 * school profile, parent sharing, and account deletion.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * **Not to be confused with `features/adminSettings`**, which is the Platform
 * Control Center at `/admin/settings` — runtime configuration and feature
 * flags on the `settings/global` document. This is one person's account
 * preferences; that is the platform's. `App.jsx`'s settings router picks
 * between three surfaces by role: `teacherSettings`, `learnerSettings`, and
 * this one as the remaining case.
 *
 * **This front door is deliberately empty.** The page is route-mounted with
 * `lazy(() => import(…))` under the route-mount exception and nothing else
 * imports it.
 *
 * ── Nothing travelled, and every candidate was checked ──────────────────
 *
 * Seven utils were considered and all seven stayed, each with readers
 * elsewhere: `schoolProfileService` (13 other consumers), `fcm` (7),
 * `accountService` (3), `accessibility` (3), `schoolProfile` (2),
 * `accountReauth` (2), `notificationPrefs` (1). A util travels when the
 * feature is its only consumer; on an account page that composes platform-wide
 * concerns, none of them is.
 *
 * The file keeps its `zedexams-settings.jsx` name. Renaming it in the same
 * commit as the move would make a pure relocation read as a rewrite in review
 * (docs/MIGRATION_TEMPLATE.md step 1).
 *
 * ── It consumes sibling features through their front doors ──────────────
 *
 * `ParentShareManager` from `features/parentPortal` and — before this
 * migration — the dashboard billing cards were reached by deep relative
 * paths into `components/`. Those became declared dependencies as each area
 * migrated; this page is where several of them land at once.
 */

export {}
