/**
 * Public surface of the Platform Control Center — the admin settings page at
 * `/admin/settings`, where the platform's runtime configuration and feature
 * flags are read and written.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same component, same Firestore reads and
 * writes, same route, same `settings/global` document.
 *
 * **This front door is deliberately empty**, on the `adminUsers` /
 * `agentsConsole` / `teacherLibrary` precedent and for the same measured
 * reason. Every reference to this area from the rest of `src/` is the route
 * STRING `/admin/settings` — the sidebar entry in `AdminLayout` and one line
 * of explanatory copy in `MaintenanceBanner` — and the only module-level
 * consumer is the `lazy(() => import(…))` mount in `App.jsx`, under the
 * route-mount exception Phase 1 recorded. Phase 2's rule is to export what is
 * consumed today; that set is empty. The file exists because the boundary is
 * real to state (§14.7).
 *
 * ── What travelled, and why the whole directory did ─────────────────────
 *
 * All six files, because nothing outside the directory imported any of them.
 * `settingsRegistry.js` and `settingsCore.js` had exactly two readers each and
 * both are TEST scripts (`test:settings-registry`, `test:engine-flag-single-reader`),
 * re-pointed in the same commit as the move. That is the shape a migration
 * wants and rarely gets: a cohesive area whose internals were never reached
 * for from elsewhere.
 *
 * `useControlCenterData.js` is a hook and sits in `lib/` rather than a
 * `hooks/` folder, matching `teacherSettings/lib/useTeachingProfile` and
 * `teacherSettings/lib/useSchoolProfileForm`.
 *
 * ── What did NOT travel ─────────────────────────────────────────────────
 *
 * `src/utils/aiCosts.js`, read by `useControlCenterData` for the spend panel.
 * It has consumers across the admin AI-cost surfaces, and the rule those
 * decisions share is the one `adminUsers` recorded: a util travels when the
 * feature is its only consumer, and stays when it is not.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The page and the hook both read and write Firestore directly, which §14.2
 * would put behind `services/`. Not fixed here, under the standing Phase 4
 * policy that a migration PR is a pure move — and this area writes the
 * platform-wide `settings/global` document, including feature flags that gate
 * rollouts, so a refactor of those call sites wants its own diff and its own
 * review rather than riding along inside a file move.
 */

export {}
