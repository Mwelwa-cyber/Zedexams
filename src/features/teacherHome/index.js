/**
 * Public surface of the teacher home feature — the classic teacher dashboard
 * and its satellites.
 *
 * Migrated out of `src/components/teacher/` on 2026-08-15 under
 * docs/architecture.md Phase 4 (§13's `components/teacher/` inventory row),
 * following docs/MIGRATION_TEMPLATE.md.
 *
 * ── EMPTY ON PURPOSE ────────────────────────────────────────────────────
 *
 * Every page here is route-mounted lazily from `src/app/routes/
 * teacherRoutes.jsx` (`/teacher/classic`, `/teacher/welcome-pro`,
 * `/teacher/calendar`, `/teacher/syllabi`) and the components are drawn only
 * by `TeacherDashboard` itself. Nothing else in `src/` imports any of them,
 * so there is nothing to export — the `quiz` / `blog` / `uiAudit` precedent:
 * an empty front door is the honest answer when every consumer is the router.
 *
 * ── What deliberately did NOT come along ───────────────────────────────
 *
 * The §13 inventory's feature-slice row named `ReminderPanel`, `StudioGate`
 * and `LockedStudio` alongside these. Each went elsewhere, on this repo's own
 * measured rules rather than the row's coarse grouping:
 *
 *   • `ReminderPanel` → `src/shared/components/` — its live consumer is
 *     `features/teacherShell`'s TeacherTopBar, which mounts on EVERY
 *     `/teacher/*` route. Exporting it here would open this front door on the
 *     shell's eager graph (the `dashboardV2` trap, recorded 2026-08-12), and
 *     its closure is two modules with no teacher knowledge.
 *   • `StudioGate` + `LockedStudio` → `src/app/guards/` — the 2026-08-13
 *     ruling stands: the gate is route infrastructure the route table imports
 *     EAGERLY (the `AdminMfaGate` precedent), and pulling it into a feature
 *     would open a paywall front door on the eager route graph. Measured
 *     before moving: neither has a single feature consumer, which is the one
 *     constraint `src/app/` placement depends on.
 */

export {}
