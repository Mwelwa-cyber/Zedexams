/**
 * What is left of the classic learner dashboard.
 *
 * ── Most of it is gone (2026-08-20) ─────────────────────────────────────
 *
 * This feature was the pre-redesign learner surface — the grade hub,
 * results, badges, study plan and calendar — kept alongside
 * `features/learnerHome` while the 2026-07 rebuild replaced it screen by
 * screen. That transition finished, so the transitional half was retired:
 *
 *   GradeHub          /dashboard/classic  → /dashboard
 *   StudentDashboard  /my-stats           → /progress
 *   MyResults         /my-results         → /progress
 *   BadgesPage        /my-badges          → /profile
 *   LearnerCalendar   /calendar           → /timetable
 *
 * with `ProgressWidget`, `StreakXpCard`, `StudyPlanCard`, `TodayStudyPlan`
 * and the whole `components/gradeHub/` set, which nothing else rendered.
 *
 * They were deleted rather than re-skinned because none of them was
 * reachable: the legacy `Navbar`'s own menu was the only live route to any
 * of them, and that came off the note reader first. The routes stay as
 * redirects because the URLs are in bookmarks and sent notifications — a
 * 404 would tell a learner their results had been deleted, which is not
 * what happened. One thing IS lost and is named rather than implied: the
 * per-attempt results LIST. `/progress` reports mastery and weak topics,
 * not "every quiz I have taken"; an individual result is still at
 * `/results/:resultId`, where every notification and share link points.
 *
 * `lib/studyPlanProgress.js` is left in place. `TodayStudyPlan` was its
 * only consumer, so nothing imports it now, but the `studyPlanProgress`
 * collection and its rules are untouched and a future study-plan surface
 * may want it back. It is dead code, not a dead collection.
 *
 * ── What remains, and why each earns its place ──────────────────────────
 *
 * Two ROUTED pages, neither of them part of the retired set:
 * `ProfilePage` serves /profile for every role that is not a learner (a
 * learner gets `learnerHome`'s own profile), and `TimetableViewerPage`
 * serves /timetable/pdf, which exists because Android WebViews drop
 * external PDF links.
 *
 * Two EXPORTS, and the pages are deliberately not among them.
 * `InvoicesCard` and `PaymentHistoryCard` are rendered by
 * `features/learnerSettings`' Account panel and `features/teacherSettings`'
 * Subscription panel — billing history belongs on a settings page as much
 * as on a dashboard, so these are genuinely shared rather than duplicated.
 * The pages stay route-mounted with `lazy(() => import(…))`: exporting one
 * here would evaluate all of them for a consumer that wanted one billing
 * card. `ReferralCard` is unexported for the same reason — `ProfilePage`
 * is its only consumer and imports it by path.
 */

export { default as InvoicesCard } from './components/InvoicesCard'
export { default as PaymentHistoryCard } from './components/PaymentHistoryCard'
