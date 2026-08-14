import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth, hasAuthSessionHint } from './contexts/AuthContext'
import { useTheme, applyThemeToBody, DEFAULT_THEME } from './contexts/ThemeContext'
import { getTeacherTheme } from './contexts/teacherThemeCore'
import TeacherThemeSync from './contexts/TeacherThemeSync'
import { PlatformSettingsProvider } from './contexts/PlatformSettingsContext'
import MaintenanceBanner from './components/banners/MaintenanceBanner'
import { AnnouncementBanner } from './features/announcements'
import AndroidUpdateBanner from './components/banners/AndroidUpdateBanner'
import { SubscriptionStatusBanner } from './features/subscription'
import ProtectedRoute from './app/guards/ProtectedRoute'
import { TEACHER_ROUTES, FlaggedStudioRoute } from './components/teacher/teacherRoutes'
import AdminMfaGate from './app/guards/AdminMfaGate'
import LearnerOnlyRoute from './app/guards/LearnerOnlyRoute'
import MissingProfileRecovery from './app/guards/MissingProfileRecovery'
import Navbar from './components/layout/Navbar'
import { getRoleLandingPath } from './utils/navigation'
import { isWithinVerificationGrace } from './utils/verification'
import { isNativePlatform } from './utils/runtime'
import PageLoader from './components/ui/PageLoader'
import FullScreenLoader from './components/ui/FullScreenLoader'
import OfflineBanner from './components/ui/OfflineBanner'
import { OfflineIndicator } from './offline'
import UpdatePrompt from './components/ui/UpdatePrompt'
import CookieConsentBanner from './components/ui/CookieConsentBanner'
import { ZedChatLauncher } from './features/zedChat'
import ErrorBoundary from './components/ui/ErrorBoundary'
import ScrollToTop from './components/ui/ScrollToTop'
import VisitorTracker from './components/ui/VisitorTracker'
import { ActiveAssignmentSync } from './hooks/useActiveAssignmentSync'

// The saved reading theme applies EVERYWHERE, public routes included. The
// old PUBLIC_THEME_PATHS pin reset /login, /papers, /pricing, … to the brand
// default on navigation, which meant a learner who chose Midnight watched
// the site flash back to a light palette on every public page (and, worse,
// mixed states: boot.js paints the saved theme pre-paint, then the pin
// yanked it away after hydration). Public surfaces are Midnight-capable
// now, so the pin's original job is gone.
//
// The two REVIEW previews stay pinned: a redesign has to be looked at in
// the brand's own colours, not whichever theme the reviewing account
// happens to have saved.
function isBrandPinnedPath(pathname) {
  return pathname === '/teacher/dashboard-preview'
    || pathname.startsWith('/teacher/register-preview')
}

// The teacher workspace paints its own surface (--zt-surface via the
// data-theme tokens), so while it is showing, the browser-chrome colour must
// come from the TEACHER theme, not the learner palette — otherwise a Night
// workspace sits under a pale-blue status bar on mobile/PWA.
function isTeacherWorkspacePath(pathname) {
  return pathname.startsWith('/teacher') && !isBrandPinnedPath(pathname)
}

function ThemeApplicator() {
  const { theme, teacherTheme } = useTheme()
  const { pathname } = useLocation()
  useEffect(() => {
    applyThemeToBody(isBrandPinnedPath(pathname) ? DEFAULT_THEME : theme)
    // applyThemeToBody just set <meta name="theme-color"> from the learner
    // palette; override it with the workspace surface where that is what is
    // actually on screen.
    if (isTeacherWorkspacePath(pathname)) {
      const meta = document.querySelector('meta[name="theme-color"]')
      const surface = getTeacherTheme(teacherTheme)?.tokens?.surface
      if (meta && surface) meta.setAttribute('content', surface)
    }
  }, [pathname, theme, teacherTheme])
  return null
}

const Login = lazy(() => import('./features/auth/pages/Login'))
const Register = lazy(() => import('./features/auth/pages/Register'))
const AuthAction = lazy(() => import('./features/auth/pages/AuthAction'))
const VerifyEmail = lazy(() => import('./features/auth/pages/VerifyEmail'))
const StudentDashboard = lazy(() => import('./features/learnerDashboard/pages/StudentDashboard'))
const GradeHub = lazy(() => import('./features/learnerDashboard/pages/GradeHub'))
// New learner home experience (2026-07 rebuild): mobile-first dashboard +
// Learn / Practice hubs + term-organised subject pages. GradeHub stays
// reachable at /dashboard/classic as the transition fallback.
const LearnerHomePage = lazy(() => import('./features/learnerHome/pages/LearnerHomePage'))
const LearnPage = lazy(() => import('./features/learnerHome/pages/LearnPage'))
const PracticePage = lazy(() => import('./features/learnerHome/pages/PracticePage'))
const LearnerSubjectPage = lazy(() => import('./features/learnerHome/pages/LearnerSubjectPage'))
const StudyPlanPage = lazy(() => import('./features/learnerDashboard/pages/StudyPlanPage'))
const LearnerCalendar = lazy(() => import('./features/learnerDashboard/pages/LearnerCalendar'))
// Exam timetable hub: /timetable is the interactive per-grade exam schedule
// (Firestore-driven with a bundled fallback); /timetable/pdf keeps the inline
// viewer for the official ECZ PDF because Android/Capacitor WebViews silently
// drop external PDF links.
const ExamTimetablePage = lazy(() => import('./features/examTimetable/pages/ExamTimetablePage'))
const TimetableViewerPage = lazy(() => import('./features/learnerDashboard/pages/TimetableViewerPage'))
const SubjectDrillDown = lazy(() => import('./features/learnerDashboard/pages/SubjectDrillDown'))
const QuizList = lazy(() => import('./components/quiz/QuizList'))
const LearnerSearch = lazy(() => import('./features/learnerSearch/pages/LearnerSearch'))

const QuizRunner = lazy(() => import('./components/quiz/QuizRunnerV2'))
const QuizResults = lazy(() => import('./components/quiz/QuizResultsV2'))
// Slide-based interactive lessons. /lessons is the canonical learner-
// facing list (LearnerLessonsList) and /lessons/:lessonId opens the
// existing slide player. The teacher panel uses LessonEditor under
// /teacher/lessons for authoring.
const LessonPlayer    = lazy(() => import('./features/lessons/pages/LessonPlayer'))
const LearnerLessonsList = lazy(() => import('./features/lessons/pages/LearnerLessonsList').then(m => ({ default: m.LearnerLessonsList })))

// Notes Studio admin — replaces the old slide-builder at /admin/lessons
const AdminNotesList    = lazy(() => import('./features/notes/pages/AdminNotesList').then(m => ({ default: m.AdminNotesList })))
const AdminNoteEditor   = lazy(() => import('./features/notes/pages/AdminNoteEditor').then(m => ({ default: m.AdminNoteEditor })))
const AdminNoteImport   = lazy(() => import('./features/notes/pages/AdminNoteImport').then(m => ({ default: m.AdminNoteImport })))
const AdminVisualNotesGenerator = lazy(() => import('./features/notes/pages/AdminVisualNotesGenerator').then(m => ({ default: m.AdminVisualNotesGenerator })))

// Notes Studio learner — /notes list + reader, gated by LearnerGate
const LearnerNotesList  = lazy(() => import('./features/notes/pages/LearnerNotesList').then(m => ({ default: m.LearnerNotesList })))
const LearnerNoteRead   = lazy(() => import('./features/notes/pages/LearnerNoteRead').then(m => ({ default: m.LearnerNoteRead })))
const LearnerGate       = lazy(() => import('./features/notes/components/LearnerGate').then(m => ({ default: m.LearnerGate })))
const MyResults = lazy(() => import('./features/learnerDashboard/pages/MyResults'))
const BadgesPage = lazy(() => import('./features/learnerDashboard/pages/BadgesPage'))
const ProfilePage = lazy(() => import('./features/learnerDashboard/pages/ProfilePage'))
const OfflineLibraryPage = lazy(() => import('./offline/OfflineLibraryPage.jsx'))
const ZedExamsSettings = lazy(() => import('./features/accountSettings/pages/zedexams-settings'))
const TeacherSettings = lazy(() => import('./features/teacherSettings/TeacherSettings'))
const LearnerSettings = lazy(() => import('./features/learnerSettings/LearnerSettings'))
const PaywallHost = lazy(() => import('./features/subscription/components/PaywallHost'))
const PostUpgradeContinuation = lazy(() => import('./features/subscription/components/PostUpgradeContinuation'))
const NativePlayBillingSync = lazy(() => import('./components/native/NativePlayBillingSync'))
const LockedFeatureModal = lazy(() => import('./features/subscription/components/LockedFeatureModal'))
const QuizLimitPopup = lazy(() => import('./features/subscription/components/QuizLimitPopup'))
const SubscriptionReminderPopup = lazy(() => import('./features/subscription/components/SubscriptionReminderPopup'))
const MySubscriptionRoute = lazy(() => import('./features/subscription/pages/MySubscriptionRoute'))
const NotFound = lazy(() => import('./components/ui/NotFound'))
const Marketing = lazy(() => import('./features/marketing/pages/Marketing'))
const Plans = lazy(() => import('./features/marketing/pages/Plans'))
const TeachersLanding = lazy(() => import('./features/marketing/pages/TeachersLanding'))
const AiTeam = lazy(() => import('./features/marketing/pages/AiTeam'))
const GradePackLanding = lazy(() => import('./features/marketing/pages/GradePackLanding'))
const PrivacyPolicy = lazy(() => import('./features/marketing/pages/PrivacyPolicy'))
const Terms = lazy(() => import('./features/marketing/pages/Terms'))
// Public consent/preferences page — no auth, so the cookie banner can link
// signed-out visitors somewhere they can actually change their decision.
const CookiePreferences = lazy(() => import('./features/marketing/pages/CookiePreferences'))
// Public account-deletion request page — the no-login deletion route Google
// Play's Data safety form links to. Must stay reachable signed out.
const DeleteAccountRequest = lazy(() => import('./features/marketing/pages/DeleteAccountRequest'))
// Child safety standards — the page Play's CSAE declaration links to.
const ChildSafety = lazy(() => import('./features/marketing/pages/ChildSafety'))
const PastPapersHub = lazy(() => import('./features/papers/pages/PastPapersHub'))
const PastPaperViewer = lazy(() => import('./features/papers/pages/PastPaperViewer'))
const PastPaperPractice = lazy(() => import('./features/papers/pages/PastPaperPractice'))
const PublicQuizRunner = lazy(() => import('./features/papers/pages/PublicQuizRunner'))
const MyPapersHistory = lazy(() => import('./features/papers/pages/MyPapersHistory'))
const AdminPastPapers = lazy(() => import('./components/admin/AdminPastPapers'))
const PastPaperStudio = lazy(() => import('./components/admin/PastPaperStudio'))
const ZedChatPage = lazy(() => import('./features/zedChat/pages/ZedChatPage'))
const StatusPage = lazy(() => import('./features/marketing/pages/StatusPage'))
// Audit C5 — SEO blog. Markdown-driven, posts ship in the bundle.
const BlogIndex = lazy(() => import('./features/blog/pages/BlogIndex'))
const BlogPost = lazy(() => import('./features/blog/pages/BlogPost'))

// Admin section
const AdminLayout = lazy(() => import('./features/adminShell/pages/AdminLayout'))
const AdminDashboard = lazy(() => import('./features/adminHome/pages/AdminDashboard'))
// Mandatory MFA enrolment page — admin-only, rendered full-screen (no admin
// chrome) so a not-yet-enrolled admin gets one focused task.
const MfaSetupPage = lazy(() => import('./features/adminMfa/pages/MfaSetupPage'))
const CreateQuiz = lazy(() => import('./components/admin/CreateQuizV2'))
const AdminCsvImport = lazy(() => import('./features/adminContent/pages/AdminCsvImport'))
const ManageContent = lazy(() => import('./features/adminContent/pages/ManageContent'))
const AdminResults = lazy(() => import('./features/adminLearners/pages/AdminResults'))
const ContentApprovals = lazy(() => import('./features/adminContent/pages/ContentApprovals'))
const QuestionReviewQueue = lazy(() => import('./features/adminQuestionBank/pages/QuestionReviewQueue'))
const ImportQuestionBankPanel = lazy(() => import('./features/adminQuestionBank/pages/ImportQuestionBankPanel'))
const FeedbackInbox = lazy(() => import('./features/adminFeedback/pages/FeedbackInbox'))
const PaymentsPanel = lazy(() => import('./features/adminPayments/pages/PaymentsPanel'))
const BulkGrantTrialsPanel = lazy(() => import('./features/adminTrials/pages/BulkGrantTrialsPanel'))
const AdminLearners = lazy(() => import('./features/adminLearners/pages/AdminLearners'))
const AdminLearnerProfile = lazy(() => import('./features/adminLearners/pages/AdminLearnerProfile'))
const GenerationsAdmin = lazy(() => import('./features/adminContent/pages/GenerationsAdmin'))
const CbcKbAdmin = lazy(() => import('./features/adminCbcKb/pages/CbcKbAdmin'))
const PictureBankAdmin = lazy(() => import('./features/visualStudio/pages/PictureBankAdmin'))
const VisualStudioAdmin = lazy(() => import('./features/visualStudio/pages/VisualStudioAdmin'))
const CurriculumReplaceStudio = lazy(() => import('./features/adminCurriculum/pages/CurriculumReplaceStudio'))
const CurriculumUploadPanel = lazy(() => import('./features/adminCurriculum/pages/CurriculumUploadPanel'))
const AdminAiCosts = lazy(() => import('./features/adminAiCosts/pages/AdminAiCosts'))
const AdminAppCheck = lazy(() => import('./features/adminAppCheck/pages/AdminAppCheck'))
const AdminUsersList = lazy(() => import('./features/adminUsers/pages/AdminUsersList'))
const AdminUserProfile = lazy(() => import('./features/adminUsers/pages/AdminUserProfile'))
const AdminSettings = lazy(() => import('./features/adminSettings/pages/AdminSettings'))
const AnnouncementsAdmin = lazy(() => import('./features/announcements/pages/AnnouncementsAdmin'))
const AdminActivityLog = lazy(() => import('./features/adminAnalytics/pages/AdminActivityLog'))
const AdminAnalytics = lazy(() => import('./features/adminAnalytics/pages/AdminAnalytics'))
const AdminVisitors = lazy(() => import('./features/adminAnalytics/pages/AdminVisitors'))

// Admin — Agents (operating-model dashboard)
const AgentsHome      = lazy(() => import('./features/agentsConsole/pages/AgentsHome').then(m => ({ default: m.AgentsHome })))
const AgentsAllJobs   = lazy(() => import('./features/agentsConsole/pages/AgentsHome').then(m => ({ default: m.AgentsAllJobs })))
const AgentProfile    = lazy(() => import('./features/agentsConsole/pages/AgentsHome').then(m => ({ default: m.AgentProfile })))
const AgentJobDetail  = lazy(() => import('./features/agentsConsole/pages/AgentJobDetail'))
const CompanyHQ       = lazy(() => import('./features/companyHQ/pages/CompanyHQ').then(m => ({ default: m.CompanyHQ })))

// Internal UI audit page at /dev/ui — see the route comment below.
const UiAuditPage     = lazy(() => import('./features/uiAudit/pages/UiAuditPage'))


// Audit A3 PR 1 — parent portal (public read-only progress view).
const ParentProgressView = lazy(() => import('./features/parentPortal/pages/ParentProgressView'))

// Family portal (authenticated parent accounts)
const ParentLayout = lazy(() => import('./app/guards/ParentLayout'))
const FamilyHome = lazy(() => import('./features/parentPortal/pages/FamilyHome'))
const ChildProgressPage = lazy(() => import('./features/parentPortal/pages/ChildProgressPage'))

// Teacher section. The /teacher/* routes themselves live in
// components/teacher/teacherRoutes.jsx — declared as data so a spec can
// render every one of them and fail if the shared shell is missing. Add a
// teacher page there. TeacherLayout is still imported here for the
// role-branched Settings page below, which is a /settings route.
const TeacherLayout = lazy(() => import('./features/teacherShell/pages/TeacherLayout'))
// Class List + Register preview — mock data only, intentionally unguarded.
// Teacher — AI Generators
const WorksheetGenerator = lazy(() => import('./features/worksheet/pages/WorksheetGenerator'))
const FlashcardGenerator = lazy(() => import('./features/flashcards/pages/FlashcardGenerator'))
const SchemeOfWorkGenerator = lazy(() => import('./features/schemeOfWork/pages/SchemeOfWorkGenerator'))
const ClassTimetableStudio = lazy(() => import('./features/classTimetable/pages/ClassTimetableStudio'))
// Rubric Studio is retired (2026-08); no admin route mounts it either. Saved
// rubrics still render in My Library via features/rubric's RubricView.
const NotesStudio = lazy(() => import('./features/teacherNotes/pages/NotesStudio'))
// Teacher — Visual Studio (ZedExams Picture & Diagram Studio). Self-contained
// feature module under src/features/visualStudio/.

// Teacher — Library
const LibraryItemDetail = lazy(() => import('./features/teacherLibrary/pages/LibraryItemDetail'))
const PublicShareView = lazy(() => import('./features/teacherLibrary/pages/PublicShareView'))

// Daily Exams (auth required)
const DailyExamsHub      = lazy(() => import('./components/exams/DailyExamsHub'))
const DailyExamRunner    = lazy(() => import('./components/exams/DailyExamRunner'))
const ExamResultsPage    = lazy(() => import('./components/exams/ExamResultsPage'))
const ExamLeaderboardPage = lazy(() => import('./components/exams/ExamLeaderboardPage'))

// Public games (no auth)
const GamesHub = lazy(() => import('./components/games/GamesHub'))
const SubjectSelector = lazy(() => import('./components/games/SubjectSelector'))
const GameList = lazy(() => import('./components/games/GameList'))
const PlayGame = lazy(() => import('./components/games/PlayGame'))
const GlobalLeaderboard = lazy(() => import('./components/games/GlobalLeaderboard'))

// Admin — games seed importer
const GamesSeedAdmin = lazy(() => import('./components/admin/GamesSeedAdmin'))

// Quiz editor (shared by admin + teacher)
const EditQuiz = lazy(() => import('./components/quiz/EditQuizV2'))

// Lifts the Android in-app splash (index.html + /public/zx-splash.js) once
// the app has DECIDED its first real screen — not on bare App mount. The
// splash overlays the whole boot at max z-index, so FullScreenLoader
// ("Welcome back… / Loading your workspace…") runs invisibly underneath it;
// calling hide() before the auth decision would lift the splash onto that
// loader mid-boot (the recorded launch-order bug). `settled` mirrors the
// conditions under which RootRedirect/ProtectedRoute stop rendering
// FullScreenLoader: auth restore finished, and — for a signed-in user — the
// profile round-trip resolved one way or the other (profileIssue renders
// MissingProfileRecovery, which IS a decided screen). The double
// requestAnimationFrame lets the decided screen commit AND paint before the
// splash starts its exit fade, so it reveals a finished screen. The splash's
// own 2.6s minimum and 10s failsafe bound both ends; on the website this is
// a no-op because the splash controller already removed itself.
function SplashDismissal() {
  const { currentUser, userProfile, loading, profileIssue } = useAuth()
  const settled = !loading && (!currentUser || !!userProfile || !!profileIssue)
  useEffect(() => {
    if (!settled) return undefined
    let raf2 = null
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => { window.ZedSplash?.hide?.() })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2 !== null) cancelAnimationFrame(raf2)
    }
  }, [settled])
  return null
}

function RootRedirect() {
  const { currentUser, userProfile, loading, isAdmin, isTeacher, profileIssue, needsEmailVerification } = useAuth()
  // Cold-start race: Firebase restores the persisted session asynchronously,
  // so on the first frames `currentUser` is still null even for a returning
  // logged-in user. Rendering <Marketing /> here is what made the app flash
  // the public marketing page for a few seconds before redirecting to the
  // dashboard. While auth is still resolving AND this device has a known
  // session, hold on the loader instead of flashing Marketing. A signed-out
  // visitor (no hint) still falls straight through to Marketing with no
  // spinner.
  if (loading && !currentUser && hasAuthSessionHint()) return <FullScreenLoader label="Welcome back…" />
  if (!currentUser) return <Marketing />
  if (profileIssue) return <MissingProfileRecovery />
  if (!userProfile) return <FullScreenLoader label="Loading your workspace…" />
  // Unverified email/password account (outside any migration grace window):
  // send straight to the verification gate instead of double-hopping through
  // the role landing page's ProtectedRoute.
  if (needsEmailVerification && !isWithinVerificationGrace(userProfile)) {
    return <Navigate to="/verify-email" replace />
  }
  return (
    <Navigate
      to={getRoleLandingPath({ role: userProfile.role, isAdmin, isTeacher })}
      replace
    />
  )
}

// Role-branched settings. Teachers get the redesigned Teacher Settings inside
// the studio chrome (TeacherLayout — sidebar's Settings item lights up);
// learners and admins keep the shared settings page under the global Navbar.
// isAdmin is checked FIRST: isTeacher includes superAdmins (AuthContext), and
// admins must stay on the admin tab set.
function SettingsPage() {
  const { userProfile, isAdmin, isTeacher } = useAuth()
  const role = isAdmin ? 'admin' : (isTeacher ? 'teacher' : (userProfile?.role || 'learner'))
  if (role === 'teacher') {
    return (
      <TeacherLayout>
        <TeacherSettings />
      </TeacherLayout>
    )
  }
  // Learners get the redesigned, mobile-first Learner Settings experience;
  // admins keep the shared account-preferences page under the global Navbar.
  if (role === 'learner') {
    return (
      <>
        <Navbar />
        <LearnerSettings />
      </>
    )
  }
  return (
    <>
      <Navbar />
      <ZedExamsSettings role={role} />
    </>
  )
}

// Every /admin/* route is admin-only AND now MFA-mandatory: ProtectedRoute
// enforces the admin role + verification, AdminMfaGate then forces enrolment
// before the AdminLayout (and any admin page) can render. The MFA setup page
// itself is routed separately (below) so a not-yet-enrolled admin can reach it.
function AdminRoute({ children }) {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminMfaGate>
        <AdminLayout>{children}</AdminLayout>
      </AdminMfaGate>
    </ProtectedRoute>
  )
}

// Parent portal gate. The role levels in ProtectedRoute can't distinguish a
// parent from a learner (both sit at level 1), so this checks the role
// explicitly: only a parent (or an admin, for support) reaches the family
// portal; anyone else is bounced to their own landing page.
function ParentRoute({ children }) {
  const { currentUser, userProfile, loading, isParent, isAdmin, needsEmailVerification } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader label="Loading your family hub…" />
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location }} />
  if (!userProfile) return <FullScreenLoader label="Loading your family hub…" />
  if (needsEmailVerification && !isWithinVerificationGrace(userProfile)) {
    return <Navigate to="/verify-email" replace state={{ from: location }} />
  }
  if (!isParent && !isAdmin) return <Navigate to={getRoleLandingPath(userProfile)} replace />
  return <ParentLayout>{children}</ParentLayout>
}

// Route-level error boundary. Sits inside <BrowserRouter> so it can read
// the pathname and use it as the boundary's resetKey: a crash on /exam/:id
// shows the inline recovery card, but navigating away (or clicking Try
// again) auto-clears the error state instead of leaving the user stuck.
// Inline mode preserves the surrounding banners + nav chrome that the
// outer (full-screen) ErrorBoundary in main.jsx would otherwise replace.
function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary inline resetKey={pathname}>
      {children}
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <PlatformSettingsProvider>
      {/* First focusable element on every page — keyboard users press Tab
          once and can jump past the navbar straight into route content.
          Wrapper div uses id="main" rather than a <main> element because
          some routes (e.g. PublicShareView) render their own <main>, and
          the spec only allows one main landmark per document. */}
      <a href="#main" className="skip-link">Skip to main content</a>
      {/* Maintenance / announcement banners — driven by settings/global +
          announcements collection. Stay above the offline banner so they
          don't get hidden under the network indicator. */}
      <MaintenanceBanner />
      <AnnouncementBanner />
      <AndroidUpdateBanner />
      {/* Subscription status strip — "Free Plan" / "Expired Subscription"
          for users who still need to upgrade. Self-hides for Pro/Trial and
          on marketing/auth/immersive routes. */}
      <SubscriptionStatusBanner />
      {/* Offline banner — slides in at the top when navigator.onLine flips
          false. Firestore queues writes locally so the user's progress
          survives the network drop; this is the visible reassurance. */}
      <OfflineBanner />
      {/* Offline-first status pill — compact, bottom-anchored badge for the
          richer sync states (syncing / updating / waiting to sync / saved
          offline) the top OfflineBanner doesn't cover. Hidden when fully
          online + synced so it stays unobtrusive. */}
      <OfflineIndicator />
      {/* PWA update prompt (audit A1.2) — toast appears bottom-right
          when a new SW version is waiting to take over. Self-hides on
          Capacitor + when no update is pending. */}
      <UpdatePrompt />
      {/* Zed AI study chat launcher (audit A6) — floating bubble
          bottom-right that opens a slide-over chat. Self-hides on
          marketing/auth/admin routes and during quiz / exam runs. */}
      <ZedChatLauncher />
      {/* Cookie consent (audit D2) — first-visit banner, decline-by-
          default. Self-hides once a decision is recorded. */}
      <CookieConsentBanner />
      <ThemeApplicator />
      {/* Lifts the Android in-app splash once the auth boot decision is made
          and the first real screen has painted (see SplashDismissal above).
          Headless; no-op on the website. */}
      <SplashDismissal />
      {/* Binds the teacher workspace theme to users/{uid}.preferences.theme.
          Mounted here rather than in ThemeProvider because that provider sits
          above AuthProvider and so cannot read auth (headless; no-op when
          signed out). */}
      <TeacherThemeSync />
      {/* Live cross-device sync of the teacher's ACTIVE teaching assignment
          (headless; no-op unless a teacher is signed in). Notifies open
          studios via the Switch / Keep notice — never mutates form state. */}
      <ActiveAssignmentSync />
      {/* Reset scroll to the top on every client-side navigation so new
          pages don't inherit the previous page's scroll offset. */}
      <ScrollToTop />
      {/* Records a first-party page-view on every route change for the
          /admin/visitors dashboard (consent-aware, best-effort). */}
      <VisitorTracker />
      <div id="main" tabIndex={-1}>
        <Suspense fallback={<PageLoader />}>
          <RouteErrorBoundary>
          <Routes>
          <Route path="/" element={<RootRedirect />} />
          {/* /welcome and /plans were legacy aliases that served the same
              content as / and /pricing. Google Search Console flagged them
              as "Alternate page with proper canonical tag" — we now 301
              them at the hosting layer (firebase.json) and keep these
              client-side redirects as a fallback for the dev server. */}
          <Route path="/welcome"  element={<Navigate to="/" replace />} />
          <Route path="/pricing"  element={<Plans />} />
          <Route path="/plans"    element={<Navigate to="/pricing" replace />} />
          {/* Public teacher landing — sample library + funnel into /register.
              Legacy sub-paths (/teachers/samples from old launch docs)
              canonicalise to the landing itself: 301'd at the hosting layer
              (firebase.json); the splat <Navigate> is the dev-server fallback. */}
          <Route path="/teachers"   element={<TeachersLanding />} />
          <Route path="/company"  element={<AiTeam />} />
          <Route path="/teachers/*" element={<Navigate to="/teachers" replace />} />
          {/* Grade-specific landing pages — the URLs to share in WhatsApp
              posts. React Router v6 can't match a partial dynamic segment
              (`/grade-:slug`), so each live grade gets an explicit route and
              passes its slug to GradePackLanding. ECZ exam grades are Grade 7
              and Grade 12; Grade 9 was phased out, so /grade-9 has no route
              and correctly 404s. */}
          <Route path="/grade-7"  element={<GradePackLanding gradeSlug="7" />} />
          <Route path="/grade-12" element={<GradePackLanding gradeSlug="12" />} />
          <Route path="/privacy"  element={<PrivacyPolicy />} />
          <Route path="/terms"    element={<Terms />} />
          {/* Public consent/preferences — where the cookie banner sends people
              who want to change their analytics decision. No auth, so it works
              for the signed-out visitors the banner actually targets. */}
          <Route path="/preferences" element={<CookiePreferences />} />
          {/* Play Data safety "delete account" URL. No auth by requirement —
              it exists for people who can't sign in (lost password/device) and
              for parents acting for a child. */}
          <Route path="/delete-account" element={<DeleteAccountRequest />} />
          <Route path="/child-safety" element={<ChildSafety />} />
          {/* Audit A2 — public ECZ past-paper archive. Hub is no-auth so
              search engines and signed-out visitors can browse; the actual
              PDF viewer at /papers/:id requires sign-in to download. */}
          <Route path="/papers"            element={<PastPapersHub />} />
          <Route path="/papers/:paperId"   element={<PastPaperViewer />} />
          {/* SEO-friendly slug URL (/papers/:id/grade-7-mathematics-2023).
              The viewer reads :paperId only; the static /practice + /quiz
              routes below outrank :slug in React Router's specificity ranking,
              so they still win. The bare /papers/:paperId route stays valid for
              back-compat and old links. */}
          <Route path="/papers/:paperId/:slug" element={<PastPaperViewer />} />
          {/* Audit A2 PR 3 — timed practice runner. Auth-gated inside
              the component so the redirect carries the original target. */}
          <Route path="/papers/:paperId/practice" element={<PastPaperPractice />} />
          {/* Past-paper quiz — public; 30-question free preview then paywall.
              No auth required so marketing visitors can try a quiz inline. */}
          <Route path="/papers/:paperId/quiz"     element={<PublicQuizRunner />} />
          {/* Audit A2 PR 4 — learner's history of past-paper runs. */}
          <Route path="/my-papers"          element={<ProtectedRoute><MyPapersHistory /></ProtectedRoute>} />
          {/* Audit C5 — SEO blog. Public, indexable. */}
          <Route path="/blog"              element={<BlogIndex />} />
          <Route path="/blog/:slug"        element={<BlogPost />} />
          <Route path="/status"   element={<StatusPage />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Custom Firebase email action handler — branded ZedExams URL for
              password resets, email verification, and email-recovery links.
              Configure this URL in Firebase Console → Authentication → Templates
              → Customise action URL: https://zedexams.com/auth/action */}
          <Route path="/auth/action" element={<AuthAction />} />
          {/* Verification gate for unverified email/password accounts.
              Deliberately OUTSIDE ProtectedRoute — it needs to render for a
              signed-in-but-unverified user, and it redirects verified users
              away itself, so the two guards can never bounce a user back
              and forth. */}
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* Public share link — no auth, read-only viewer of a frozen snapshot */}
          <Route path="/share/:token"             element={<PublicShareView />} />
          {/* Audit A3 — parent portal. Public token-based read; no auth. */}
          <Route path="/parent/:token"            element={<ParentProgressView />} />

          {/* Family portal — authenticated parent accounts. */}
          <Route path="/family"                   element={<ParentRoute><FamilyHome /></ParentRoute>} />
          <Route path="/family/child/:childUid"   element={<ParentRoute><ChildProgressPage /></ParentRoute>} />

          {/* ── Public games (no auth) ──────────────────────────── */}
          {/* Flow: /games → /games/g/:grade → /games/g/:grade/:subject → /games/play/:gameId */}
          <Route path="/games"                         element={<GamesHub />} />
          <Route path="/games/leaderboard"             element={<GlobalLeaderboard />} />
          <Route path="/games/g/:grade"                element={<SubjectSelector />} />
          <Route path="/games/g/:grade/:subject"       element={<GameList />} />
          <Route path="/games/play/:gameId"            element={<PlayGame />} />

          {/* ── Learner routes ─────────────────────────────────── */}
          {/* The rebuilt learner home (2026-07). The previous GradeHub
              dashboard stays at /dashboard/classic during the transition. */}
          <Route path="/dashboard"         element={<ProtectedRoute><LearnerOnlyRoute><LearnerHomePage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/dashboard/classic" element={<ProtectedRoute><LearnerOnlyRoute><GradeHub /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/dashboard-preview" element={<ProtectedRoute><LearnerOnlyRoute><LearnerHomePage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/learn"             element={<ProtectedRoute><LearnerOnlyRoute><LearnPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/practice"          element={<ProtectedRoute><LearnerOnlyRoute><PracticePage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/practice/daily-exams" element={<Navigate to="/exams" replace />} />
          <Route path="/subjects/:subjectId" element={<ProtectedRoute><LearnerOnlyRoute><LearnerSubjectPage /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* /learner/* aliases from the redesign spec → canonical routes */}
          <Route path="/learner" element={<Navigate to="/dashboard" replace />} />
          <Route path="/learner/learn" element={<Navigate to="/learn" replace />} />
          <Route path="/learner/papers" element={<Navigate to="/papers" replace />} />
          <Route path="/learner/practice" element={<Navigate to="/practice" replace />} />
          <Route path="/learner/games" element={<Navigate to="/games" replace />} />
          <Route path="/learner/profile" element={<Navigate to="/profile" replace />} />
          {/* Legacy stats page (kept for admin/teacher reference) */}
          <Route path="/my-stats"          element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><StudentDashboard /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/study-plan"        element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><StudyPlanPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/calendar"          element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerCalendar /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Interactive exam timetable hub; the official ECZ PDF stays readable
              in-app at /timetable/pdf (Android WebViews drop external PDF links). */}
          <Route path="/timetable"         element={<ProtectedRoute><LearnerOnlyRoute><ExamTimetablePage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/timetable/pdf"     element={<ProtectedRoute><LearnerOnlyRoute><TimetableViewerPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exams"                        element={<ProtectedRoute><LearnerOnlyRoute><DailyExamsHub /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exams/leaderboard"           element={<ProtectedRoute><LearnerOnlyRoute><ExamLeaderboardPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exam/:examId"                element={<ProtectedRoute><LearnerOnlyRoute><DailyExamRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exam-results/:attemptId"     element={<ProtectedRoute><LearnerOnlyRoute><ExamResultsPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quizzes"           element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizList /></LearnerOnlyRoute></ProtectedRoute>} />

          {/* Course-map drill-down — clicking Practise on a subject card
              lands the learner here, with quizzes grouped by topic. */}
          <Route path="/practise/:grade/:subjectId" element={<ProtectedRoute><LearnerOnlyRoute><SubjectDrillDown /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quiz/:quizId"      element={<ProtectedRoute><LearnerOnlyRoute><QuizRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/results/:resultId" element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizResults /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Global learner search across quizzes / notes / papers / games. */}
          <Route path="/search"            element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerSearch /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Notes (standalone reading material) — canonical /notes routes. */}
          <Route path="/notes"             element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerGate><LearnerNotesList /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/notes/:id"         element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerGate><LearnerNoteRead /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />

          {/* Lessons (interactive slide-based lessons) — canonical /lessons routes.
              LearnerNoteRead handles the bookmark-back-compat case: if a learner
              lands on /notes/:id with a slide-based doc it redirects them here. */}
          <Route path="/lessons"                element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerGate><LearnerLessonsList /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/lessons/:lessonId"      element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerGate><LessonPlayer /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/my-results"        element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><MyResults /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/my-badges"         element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><BadgesPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/profile"           element={<ProtectedRoute><Navbar /><ProfilePage /></ProtectedRoute>} />
          {/* Offline Library + Storage settings (offline-first). Downloaded
              content, device-storage breakdown, and cache/sync controls. */}
          <Route path="/offline"           element={<ProtectedRoute><Navbar /><OfflineLibraryPage /></ProtectedRoute>} />
          {/* My Subscription — shared learner/teacher plan, benefits, payment
              status, and upgrade/renew. Audience-aware copy inside.
              Teachers are redirected into the teacher area (see
              MySubscriptionRoute); learners and admins render here. */}
          <Route path="/my-subscription"   element={<ProtectedRoute><MySubscriptionRoute /></ProtectedRoute>} />
          {/* Payment notifications written before 2026-07-25 carry an action
              url of /subscription, which never existed — the bell 404'd on
              "Renew now" / "View account". The senders are fixed, but those
              notifications are already in learners' inboxes, so keep the
              alias for the ones still sitting there. */}
          <Route path="/subscription"      element={<Navigate to="/my-subscription" replace />} />
          {/* Nested paths (/settings/profile, /settings/school, …) are the
              Teacher Settings detail panels; SettingsPage renders the right
              chrome per role and TeacherSettings routes the subpath. */}
          <Route path="/settings/*"        element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          {/* Audit A6 — full-page Zed AI study chat. Auth-gated; the
              floating launcher in App handles the in-context entry
              point but a direct /ask-zed URL is useful for shares. */}
          <Route path="/ask-zed"           element={<ProtectedRoute><ZedChatPage /></ProtectedRoute>} />

          {/* Mandatory admin MFA enrolment. Admin-only (ProtectedRoute), but
              deliberately NOT wrapped in AdminMfaGate/AdminLayout so a
              not-yet-enrolled admin can actually reach it (AdminMfaGate would
              otherwise redirect every admin page here — including this one —
              creating a loop). Full-screen focused enrolment flow. */}
          <Route path="/admin/security/mfa-setup"       element={<ProtectedRoute requiredRole="admin"><MfaSetupPage /></ProtectedRoute>} />

          {/* ── Admin routes (all wrapped in AdminLayout) ──────── */}
          <Route path="/admin"                          element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/lessons"                  element={<AdminRoute><AdminNotesList /></AdminRoute>} />
          <Route path="/admin/lessons/new"              element={<AdminRoute><AdminNoteEditor /></AdminRoute>} />
          <Route path="/admin/lessons/import"           element={<AdminRoute><AdminNoteImport /></AdminRoute>} />
          <Route path="/admin/lessons/visual/new"       element={<AdminRoute><AdminVisualNotesGenerator /></AdminRoute>} />
          <Route path="/admin/lessons/:id/edit"         element={<AdminRoute><AdminNoteEditor /></AdminRoute>} />
          <Route path="/admin/quizzes/new"              element={<AdminRoute><CreateQuiz /></AdminRoute>} />
          <Route path="/admin/quizzes/:quizId/edit"     element={<AdminRoute><EditQuiz /></AdminRoute>} />
          <Route path="/admin/import/csv"               element={<AdminRoute><AdminCsvImport /></AdminRoute>} />
          <Route path="/admin/content"                  element={<AdminRoute><ManageContent /></AdminRoute>} />
          <Route path="/admin/approvals"                element={<AdminRoute><ContentApprovals /></AdminRoute>} />
          <Route path="/admin/question-review"          element={<AdminRoute><QuestionReviewQueue /></AdminRoute>} />
          <Route path="/admin/import-questions"         element={<AdminRoute><ImportQuestionBankPanel /></AdminRoute>} />
          <Route path="/admin/feedback"                 element={<AdminRoute><FeedbackInbox /></AdminRoute>} />
          <Route path="/admin/generations"              element={<AdminRoute><GenerationsAdmin /></AdminRoute>} />
          <Route path="/admin/generations/:id"          element={<AdminRoute><LibraryItemDetail /></AdminRoute>} />
          <Route path="/admin/cbc-kb"                   element={<AdminRoute><CbcKbAdmin /></AdminRoute>} />
          <Route path="/admin/picture-bank"             element={<AdminRoute><PictureBankAdmin /></AdminRoute>} />
          <Route path="/admin/visuals"                  element={<AdminRoute><VisualStudioAdmin /></AdminRoute>} />
          <Route path="/admin/curriculum/replace"       element={<AdminRoute><CurriculumReplaceStudio /></AdminRoute>} />
          <Route path="/admin/curriculum-upload"        element={<AdminRoute><CurriculumUploadPanel /></AdminRoute>} />
          {/* Audit B4 — AI cost dashboard. Admin-only per route +
              Firestore rules. */}
          <Route path="/admin/ai-costs"                 element={<AdminRoute><AdminAiCosts /></AdminRoute>} />
          {/* App Check enforcement readiness — soft-verify telemetry.
              Admin-only per route + Firestore rules. */}
          <Route path="/admin/app-check"                element={<AdminRoute><AdminAppCheck /></AdminRoute>} />
          {/* Audit A2 — past-paper management (upload + edit + status).
              The Studio runs the 5-step upload flow (assets → details →
              questions → answers → publish) and links the published
              quiz to the paper. */}
          <Route path="/admin/papers"                   element={<AdminRoute><AdminPastPapers /></AdminRoute>} />
          <Route path="/admin/papers/new"               element={<AdminRoute><PastPaperStudio /></AdminRoute>} />
          <Route path="/admin/papers/:paperId/edit"     element={<AdminRoute><PastPaperStudio /></AdminRoute>} />
          <Route path="/admin/games-seed"               element={<AdminRoute><GamesSeedAdmin /></AdminRoute>} />
          <Route path="/admin/users"                    element={<AdminRoute><AdminUsersList defaultRole="all" /></AdminRoute>} />
          <Route path="/admin/users/:userId"            element={<AdminRoute><AdminUserProfile /></AdminRoute>} />
          <Route path="/admin/teachers"                 element={<AdminRoute><AdminUsersList defaultRole="teacher" /></AdminRoute>} />
          <Route path="/admin/admins"                   element={<AdminRoute><AdminUsersList defaultRole="admin" /></AdminRoute>} />
          <Route path="/admin/settings"                 element={<AdminRoute><AdminSettings /></AdminRoute>} />
          <Route path="/admin/announcements"            element={<AdminRoute><AnnouncementsAdmin /></AdminRoute>} />
          <Route path="/admin/activity"                 element={<AdminRoute><AdminActivityLog /></AdminRoute>} />
          <Route path="/admin/analytics"                element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
          <Route path="/admin/visitors"                 element={<AdminRoute><AdminVisitors /></AdminRoute>} />
          <Route path="/admin/learners"                 element={<AdminRoute><AdminLearners /></AdminRoute>} />
          <Route path="/admin/learners/:learnerId"      element={<AdminRoute><AdminLearnerProfile /></AdminRoute>} />
          <Route path="/admin/results"                  element={<AdminRoute><AdminResults /></AdminRoute>} />
          <Route path="/admin/payments"                 element={<AdminRoute><PaymentsPanel /></AdminRoute>} />
          <Route path="/admin/demo-trials"              element={<AdminRoute><BulkGrantTrialsPanel /></AdminRoute>} />
          {/* Worksheet Studio rides the same feature flag as the teacher route
              — the admin copy of a withdrawn studio is still the withdrawn
              studio, and leaving it open would be a second door into output
              we have said is not fit to print. */}
          <Route path="/admin/generate/worksheet"       element={<AdminRoute><FlaggedStudioRoute tool="worksheet"><WorksheetGenerator /></FlaggedStudioRoute></AdminRoute>} />
          <Route path="/admin/generate/flashcards"      element={<AdminRoute><FlashcardGenerator /></AdminRoute>} />
          <Route path="/admin/generate/scheme-of-work"  element={<AdminRoute><SchemeOfWorkGenerator /></AdminRoute>} />
          <Route path="/admin/generate/class-timetable" element={<AdminRoute><ClassTimetableStudio /></AdminRoute>} />
          {/* /admin/generate/rubric is gone with the studio — an admin path is
              internal, so there is no bookmark to preserve and no teacher-facing
              notice to route an admin through. */}
          <Route path="/admin/generate/notes"           element={<AdminRoute><NotesStudio /></AdminRoute>} />
          <Route path="/admin/company"                  element={<AdminRoute><CompanyHQ /></AdminRoute>} />
          <Route path="/admin/agents"                   element={<AdminRoute><AgentsHome /></AdminRoute>} />
          <Route path="/admin/agents/jobs"              element={<AdminRoute><AgentsAllJobs /></AdminRoute>} />
          <Route path="/admin/agents/jobs/:jobId"       element={<AdminRoute><AgentJobDetail /></AdminRoute>} />
          <Route path="/admin/agents/:agentId"          element={<AdminRoute><AgentProfile /></AdminRoute>} />

          {/* ── Internal UI audit ("kitchen sink") ──────────────
              Every shared primitive, every design token and all four
              workspace themes on one scrollable page, for visual regression
              QA by eyeball. Not linked from any navigation — direct URL only.

              Guarded by ProtectedRoute + AdminMfaGate, the same access gate
              every /admin route has, but deliberately NOT wrapped in
              AdminLayout: the page owns its own `.studio-theme` scope and a
              sticky toolbar, and the admin chrome would both nest a second
              themed container inside it and add navigation to a page whose
              whole point is that it is unreachable by clicking.

              Lazy like every other route, so it adds nothing to the main
              bundle — its cost to production is one entry in this table. */}
          <Route path="/dev/ui"                         element={<ProtectedRoute requiredRole="admin"><AdminMfaGate><UiAuditPage /></AdminMfaGate></ProtectedRoute>} />


          {/* ── Teacher routes ──────────────────────────────────
              Declared as data in components/teacher/teacherRoutes.jsx so the
              shell can be asserted for every one of them (teacherRoutes.spec
              renders each route and fails if TeacherLayout is missing). Add a
              teacher page THERE, not here. */}
          {TEACHER_ROUTES.map(({ path, element }) => (
            <Route key={path} path={path} element={element} />
          ))}

          <Route path="*" element={<NotFound />} />
        </Routes>
        </RouteErrorBoundary>
        {/* Paywall — listens for paywall.show(reason, ctx) from anywhere */}
          <PaywallHost />
          {/* "Pick up where you left off" card after a successful upgrade
              returned the teacher to the studio a paywall interrupted. */}
          <PostUpgradeContinuation />
          {/* Android only: restore/verify Google Play subscriptions on open.
              Gated so the web bundle never loads the billing chunk. */}
          {isNativePlatform() && <NativePlayBillingSync />}
          {/* Popup #1 — Feature Locked; listens for lockedFeature.show({feature,audience}) */}
          <LockedFeatureModal />
          {/* Popup #2 — Quiz Limit Reached; listens for paywall.show('quiz-preview-limit') */}
          <QuizLimitPopup />
          {/* Popup #3 — Welcome Back upgrade nudge for Free & Expired users (every few days) */}
          <SubscriptionReminderPopup />
        </Suspense>
      </div>
      </PlatformSettingsProvider>
    </BrowserRouter>
  )
}
