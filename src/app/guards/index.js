/**
 * Route guards — the components that decide whether a route renders at all,
 * before the surface behind it is reached.
 *
 * Migrated from `src/components/layout/` under docs/architecture.md Phase 4,
 * following docs/MIGRATION_TEMPLATE.md. A move: same redirects, same role
 * checks, same session-restoration flow.
 *
 * `ProtectedRoute` · `LearnerOnlyRoute` · `AdminMfaGate` ·
 * `MissingProfileRecovery` · `ParentLayout` · `SessionRestorationLoader` ·
 * `SessionRestorationScreen`
 *
 * **This front door is deliberately empty.** Every consumer is `App.jsx` or
 * `components/teacher/teacherRoutes.jsx` — both route tables, both of which
 * import each guard by path. A barrel here would put every guard in the chunk
 * of anything that opened it, which is the cost `src/app/index.js` already
 * names.
 *
 * ── Two facts the scaffold recorded, and they still hold ────────────────
 *
 * This file previously said "Empty until Phase 4" and carried two warnings
 * that survive the move and must not be "tidied" now that it has happened:
 * `/admin/security/mfa-setup` sits OUTSIDE `AdminRoute` on purpose (an
 * enrolment page cannot sit behind the gate it enrols for), and the preview
 * routes are unguarded because they render mock data only — giving any of them
 * a Firestore read means adding a guard in the same PR.
 *
 * `AdminRoute`, `ParentRoute`, `StudioGate` and `PremiumGate` were also named
 * here as future residents. `AdminRoute` and `ParentRoute` are still declared
 * inline in `App.jsx` and move when the route registry does. `StudioGate` is
 * NOT coming: the studio-chrome census measured it as failing §14.6 on payment
 * logic (`AuthContext`, `teacherPlans`), and it belongs to a feature.
 *
 * ── Why these seven and not the whole directory ─────────────────────────
 *
 * `src/components/layout/` also held `Navbar` and `MobileBottomNav`, and they
 * could NOT come. `FORBIDDEN_TARGETS.features` includes `app`, and that check
 * runs before the front-door exemption and consults no allowance list — so a
 * module under `src/app/` is unreachable from `src/features/` by any legal
 * route. Measured rather than assumed: `Navbar` has a feature consumer
 * (`examTimetable`) and `MobileBottomNav` has two (`learnerDashboard`), so
 * moving either here would have been a hard boundary failure. Each of the
 * seven above has **zero**.
 *
 * That is the same rule `src/app/layouts/index.js` records having learned the
 * expensive way, after both layouts it was scaffolded for had to go out to
 * features instead. A directory is not a layer.
 */

export {}
