/**
 * Public surface of the teacher shell — the chrome every `/teacher/*` route
 * renders inside.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, `teacherShell`),
 * following docs/MIGRATION_TEMPLATE.md. A move: same chrome, same nav, same
 * behaviour at every breakpoint.
 *
 * ── This front door is NOT empty, and that is the difference from adminShell ─
 *
 * `adminShell` exports nothing, because `AdminLayout` is reached only by the
 * `lazy(() => import(…))` mount in `App.jsx`. `TeacherLayout` has a second
 * class of caller: five specs in `features/dashboardV2` render the shell to
 * assert it —
 *
 *   components/MobileDashboardView.spec.jsx · components/responsiveNavigation.spec.jsx
 *   pages/HelpSupportPageMobile.spec.jsx    · pages/TeacherDashboardLive.spec.jsx
 *   pages/TeacherDashboardV2.spec.jsx
 *
 * Those are STATIC imports, so the route-mount exception does not reach them,
 * and `KNOWN_CROSS_FEATURE_IMPORTS` only shrinks. A front door is what makes
 * them legal: `test-import-boundaries.mjs` lets a cross-feature import through
 * when it resolves to the target feature's `index.js` (`isFrontDoor` →
 * continue) and fails it otherwise.
 *
 * ── The cost, stated, because it is exactly what #2247 refused ─────────────
 *
 * This index re-exports ONE component, and that component is the chrome every
 * `/teacher/*` route already loads. Nothing behind it is new weight on any
 * route. Adding a second export — a hook, a nav helper — is where that stops
 * being true: it would put that module on the import graph of anything opening
 * this door, which is how `features/dashboardV2` came to keep the shell out of
 * its own front door in the first place.
 *
 * The ROUTE TABLES do not come through here. `App.jsx` and
 * `teacherRoutes.jsx` — the two files `scripts/lib/declaredRoutes.mjs` names —
 * keep their deep `lazy(() => import('…/pages/TeacherLayout'))` mounts under
 * the Phase 1 route-mount exception. Routing them through this barrel would
 * put the whole shell on `App.jsx`'s eager graph for no gain.
 */

export { default as TeacherLayout } from './pages/TeacherLayout'
