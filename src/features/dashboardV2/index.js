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
 *   MobileBottomNav) · `dashboardV2Config` (TEACHER_NAV_GROUPS) ·
 *   `teacherNavActive` · `dashboardV2Data` (teacherFromAuth) ·
 *   `useDashboardTheme` · `useSidebarCollapsed` + `sidebarCollapseCore` ·
 *   `useRecordStudioVisit` · `dashboardV2.css` · `glassSurface.css`
 *
 * Shared BOTH ways, so deliberately left in the shell — a feature may import
 * DOWN into the legacy tree, while the reverse would need a debt-list entry:
 *   `BottomSheet` · `GlassToolTile` · `launcher/teacherStudios` ·
 *   `launcher/teacherLauncherCore` · `launcher/useRecentStudios`
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
