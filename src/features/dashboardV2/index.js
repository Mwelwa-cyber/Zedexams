/**
 * Teacher Dashboard (V2) — public API (docs/architecture.md §3, §14.7).
 *
 * **Exports nothing, and here that is load-bearing rather than incidental.**
 *
 * The three pages are reached only by `lazy(() => import(…))` from
 * `teacherRoutes.jsx`: the live dashboard at `/teacher`, the mock-data preview
 * at `/teacher/dashboard-preview`, and Help & Support at `/teacher/help`.
 * Nothing composes with them.
 *
 * If this index exported anything, `TeacherLayout` would be the first caller —
 * and `TeacherLayout` is the shell for EVERY `/teacher/*` route. Importing one
 * name from a feature evaluates every module its index re-exports, so a teacher
 * opening the Assessment Studio would pull the app launcher, the onboarding
 * tour, Help & Support and the mock data into the import graph to draw a
 * sidebar. `check:bundle-edges` would not say a word: it guards four declared
 * light pages and none of them is a teacher route.
 *
 * That is the whole reason this migration was a SPLIT rather than a move
 * (§13). The shell keeps its own copies of what it needs, in
 * `src/components/teacher/dashboardV2/`, and nothing here is reachable from it.
 *
 * ## Where the seam runs
 *
 * Shell (stays next to `TeacherLayout`, imported by it directly):
 *   `Sidebar` · `LogoutDialog` · `MobileChrome` (NavDrawer, MobileHeader,
 *   MobileBottomNav) · `teacherNavActive` · `useDashboardTheme` ·
 *   `useSidebarCollapsed` + `sidebarCollapseCore` · `useRecordStudioVisit`
 *
 * ── The both-ways modules LEFT, and the seam did not reverse ────────────
 *
 * This file used to record nine modules as "shared both ways, so deliberately
 * left in the shell", on the rule that a feature may import DOWN into the
 * legacy tree while the reverse would need a debt-list entry. They are now in
 * `src/shared/` (and `useRecentStudios` in `src/hooks/`), moved by PR A of the
 * `teacherShell` migration — `dashboardV2.css` · `glassSurface.css` ·
 * `BottomSheet` · `GlassToolTile` · `teacherStudios` · `teacherLauncherCore` ·
 * `dashboardV2Config` · `dashboardV2Data` · `useRecentStudios`.
 *
 * Read that as the rule being APPLIED, not abandoned. The shell is becoming
 * `src/features/teacherShell/`, and a `features/dashboardV2` file importing
 * `features/teacherShell/components/BottomSheet` is a cross-feature violation
 * on a list that only shrinks. Sending the genuinely-shared nine to the bottom
 * layer is what lets both sides keep importing them legally.
 *
 * The coupling this file's original note refused — shell reaching THROUGH the
 * dashboard's front door, putting the launcher, the tour, Help & Support and
 * the mock data on every teacher route's import graph — is still refused. What
 * changes is the direction: the dashboard now reaches toward the shell, which
 * costs nothing new, because the dashboard already renders INSIDE
 * `TeacherLayout` at every route it mounts on.
 *
 * Here (the page):
 *   pages/     the three route-mounted screens
 *   components/ the dashboard's own views, incl. the page half of
 *              `MobileDashboardView` and the six cards
 *   launcher/  the app launcher UI
 *   lib/       `dashboardV2Core`, `onboardingTourCore`, `mockData`,
 *              `dashboardFonts` — pure, node-tested
 *   hooks/     `useTeacherDashboardData`
 *
 * `useIsMobile` went to `src/shared/hooks/` in the preparatory commit: three
 * unrelated consumers, react-only. It is the first resident of that layer.
 */

export {}
