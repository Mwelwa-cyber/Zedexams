import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth, hasAuthSessionHint } from '../contexts/AuthContext'
import { useTheme, applyThemeToBody, DEFAULT_THEME } from '../contexts/ThemeContext'
import { getTeacherTheme } from '../contexts/teacherThemeCore'
import TeacherThemeSync from '../contexts/TeacherThemeSync'
import ReadingThemeSync from '../contexts/ReadingThemeSync'
import { PlatformSettingsProvider } from '../contexts/PlatformSettingsContext'
import { MaintenanceBanner, AndroidUpdateBanner } from '../features/platformNotices'
import { AnnouncementBanner } from '../features/announcements'
import { SubscriptionStatusBanner } from '../features/subscription'
import ParentRouteGuard from './guards/ParentRouteGuard'
import ProtectedRoute from './guards/ProtectedRoute'
import { TEACHER_ROUTES, FlaggedStudioRoute } from './routes/teacherRoutes'
import AdminMfaGate from './guards/AdminMfaGate'
import LearnerOnlyRoute from './guards/LearnerOnlyRoute'
import LearnerSetupGate from './guards/LearnerSetupGate'
import MissingProfileRecovery from './guards/MissingProfileRecovery'
import Navbar from '../components/layout/Navbar'
import { getRoleLandingPath } from '../utils/navigation'
import { isLearnerRole } from '../utils/permissions'
import { isWithinVerificationGrace } from '../utils/verification'
import { isNativePlatform } from '../utils/runtime'
import PageLoader from '../shared/components/PageLoader'
import FullScreenLoader from '../shared/components/FullScreenLoader'
import OfflineBanner from '../shared/components/OfflineBanner'
import { OfflineIndicator } from '../offline'
import UpdatePrompt from '../shared/components/UpdatePrompt'
import CookieConsentBanner from '../components/ui/CookieConsentBanner'
import ErrorBoundary from '../shared/components/ErrorBoundary'
import ScrollToTop from '../shared/components/ScrollToTop'
import VisitorTracker from '../components/ui/VisitorTracker'
import { ActiveAssignmentSync } from '../hooks/useActiveAssignmentSync'

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

const Login = lazy(() => import('../features/auth/pages/Login'))
const Register = lazy(() => import('../features/auth/pages/Register'))
const AuthAction = lazy(() => import('../features/auth/pages/AuthAction'))
const VerifyEmail = lazy(() => import('../features/auth/pages/VerifyEmail'))
// The learner home experience (2026-07 rebuild): mobile-first dashboard +
// term-organised subject pages. The pre-redesign GradeHub it replaced was
// kept at /dashboard/classic as a transition fallback until 2026-08-20,
// when the transition finished and the fallback was retired.
const LearnerLayout = lazy(() => import('../features/learnerHome/components/LearnerLayout'))
const LearnerHomePage = lazy(() => import('../features/learnerHome/pages/LearnerHomePage'))
const LearnerSubjectPage = lazy(() => import('../features/learnerHome/pages/LearnerSubjectPage'))
const LearnerNotificationsPage = lazy(() => import('../features/notifications/pages/LearnerNotificationsPage'))
const LearnerProfilePage = lazy(() => import('../features/learnerHome/pages/LearnerProfilePage'))
const LearnerSchoolCalendarPage = lazy(() => import('../features/learnerHome/pages/LearnerSchoolCalendarPage'))
// First-run setup (grade → subjects → Meet Zed → reminders). Mounted bare:
// the mockup hides the nav here, because setup is not somewhere you tab away
// from half-done.
const LearnerSetupPage = lazy(() => import('../features/learnerOnboarding/pages/LearnerSetupPage'))
const GuardianZonePage = lazy(() => import('../features/learnerHome/pages/GuardianZonePage'))
const ProfilePage = lazy(() => import('../features/learnerDashboard/pages/ProfilePage'))

/**
 * /profile is role-branched (step 10): learners get the prototype-v6
 * "My Profile" view (it brings its own LearnerShell); every other role
 * keeps the shared ProfilePage under the classic Navbar. The branch
 * lives here because App.jsx is the one file licensed to lazy-mount
 * feature pages directly (test:import-boundaries' route-table rule).
 */
function ProfileRoute() {
  const { userProfile } = useAuth()
  // The canonical set — a legacy 'student' account is a learner and gets the
  // learner profile, not the teacher-chrome one.
  if (isLearnerRole(userProfile)) return <LearnerProfilePage />
  return <><Navbar /><ProfilePage /></>
}
// My Progress + Study Plan (prototype v26). The Study Plan REPLACES the
// pre-redesign AI study-plan page, which rendered in the old Navbar
// chrome and generated a plan from a model call; this one is built from
// the learner's own weak topics and deep-links into real practice.
const MyProgressPage = lazy(() => import('../features/learnerProgress/pages/MyProgressPage'))
const StudyPlanPage = lazy(() => import('../features/learnerProgress/pages/StudyPlanPage'))
// Exam timetable hub: /timetable is the interactive per-grade exam schedule
// (Firestore-driven with a bundled fallback); /timetable/pdf keeps the inline
// viewer for the official ECZ PDF because Android/Capacitor WebViews silently
// drop external PDF links.
const ExamTimetablePage = lazy(() => import('../features/examTimetable/pages/ExamTimetablePage'))
const TimetableViewerPage = lazy(() => import('../features/learnerDashboard/pages/TimetableViewerPage'))
const QuizList = lazy(() => import('../features/quiz/pages/QuizList'))
const LearnerSearch = lazy(() => import('../features/learnerSearch/pages/LearnerSearch'))

const QuizRunner = lazy(() => import('../features/quiz/pages/QuizRunnerV2'))
const QuizResults = lazy(() => import('../features/quiz/pages/QuizResultsV2'))
// Slide-based interactive lessons. /lessons/:lessonId opens the slide
// player; the learner-facing LIST is retired (the mockup's one reading
// surface is the Notes tab), so /lessons redirects there. The teacher
// panel uses LessonEditor under /teacher/lessons for authoring, and
// LearnerLessonsList remains for that side of the house.
const LessonPlayer    = lazy(() => import('../features/lessons/pages/LessonPlayer'))

// Notes Studio admin — replaces the old slide-builder at /admin/lessons
const AdminNotesList    = lazy(() => import('../features/notes/pages/AdminNotesList').then(m => ({ default: m.AdminNotesList })))
const AdminNoteEditor   = lazy(() => import('../features/notes/pages/AdminNoteEditor').then(m => ({ default: m.AdminNoteEditor })))
const AdminNoteImport   = lazy(() => import('../features/notes/pages/AdminNoteImport').then(m => ({ default: m.AdminNoteImport })))
const AdminVisualNotesGenerator = lazy(() => import('../features/notes/pages/AdminVisualNotesGenerator').then(m => ({ default: m.AdminVisualNotesGenerator })))

// Notes Studio learner — /notes list + reader, gated by LearnerGate
const LearnerNotesList  = lazy(() => import('../features/notes/pages/LearnerNotesList').then(m => ({ default: m.LearnerNotesList })))
const LearnerNoteRead   = lazy(() => import('../features/notes/pages/LearnerNoteRead').then(m => ({ default: m.LearnerNoteRead })))
// Reader-engine preview (learner redesign step 3) — fixture data only.
const NoteReaderPreview = lazy(() => import('../features/notes/pages/ReaderPreview'))
const LearnerGate       = lazy(() => import('../features/notes/components/LearnerGate').then(m => ({ default: m.LearnerGate })))
const OfflineLibraryPage = lazy(() => import('../offline/OfflineLibraryPage.jsx'))
const ZedExamsSettings = lazy(() => import('../features/accountSettings/pages/zedexams-settings'))
const TeacherSettings = lazy(() => import('../features/teacherSettings/TeacherSettings'))
const LearnerSettingsRoute = lazy(() => import('../features/learnerSettings/pages/LearnerSettingsRoute'))
// The learner chrome (page column + 4-tab nav) for the settings screen,
// which is not mounted through the LearnerLayout route group because
// /settings/* also serves the detail panels and other roles.
const LearnerShell = lazy(() => import('../features/learnerHome/components/LearnerShell'))
const PaywallHost = lazy(() => import('../features/subscription/components/PaywallHost'))
const PostUpgradeContinuation = lazy(() => import('../features/subscription/components/PostUpgradeContinuation'))
const NativePlayBillingSync = lazy(() => import('../features/subscription/components/NativePlayBillingSync'))
const LockedFeatureModal = lazy(() => import('../features/subscription/components/LockedFeatureModal'))
const QuizLimitPopup = lazy(() => import('../features/subscription/components/QuizLimitPopup'))
const MySubscriptionRoute = lazy(() => import('../features/subscription/pages/MySubscriptionRoute'))
const AskGrownUpPage = lazy(() => import('../features/subscription/pages/AskGrownUpPage'))
const UnlockSheetHost = lazy(() => import('../features/subscription/components/UnlockSheetHost'))
const GraceRibbon = lazy(() => import('../features/subscription/components/GraceRibbon'))
const NotFound = lazy(() => import('../components/ui/NotFound'))
const Marketing = lazy(() => import('../features/marketing/pages/Marketing'))
const Plans = lazy(() => import('../features/marketing/pages/Plans'))
const TeachersLanding = lazy(() => import('../features/marketing/pages/TeachersLanding'))
const AiTeam = lazy(() => import('../features/marketing/pages/AiTeam'))
const GradePackLanding = lazy(() => import('../features/marketing/pages/GradePackLanding'))
const PrivacyPolicy = lazy(() => import('../features/marketing/pages/PrivacyPolicy'))
const Terms = lazy(() => import('../features/marketing/pages/Terms'))
// Public consent/preferences page — no auth, so the cookie banner can link
// signed-out visitors somewhere they can actually change their decision.
const CookiePreferences = lazy(() => import('../features/marketing/pages/CookiePreferences'))
// Public account-deletion request page — the no-login deletion route Google
// Play's Data safety form links to. Must stay reachable signed out.
const DeleteAccountRequest = lazy(() => import('../features/marketing/pages/DeleteAccountRequest'))
// Child safety standards — the page Play's CSAE declaration links to.
const ChildSafety = lazy(() => import('../features/marketing/pages/ChildSafety'))
const PastPapersHub = lazy(() => import('../features/papers/pages/PastPapersHub'))
const PastPaperViewer = lazy(() => import('../features/papers/pages/PastPaperViewer'))
const PastPaperPractice = lazy(() => import('../features/papers/pages/PastPaperPractice'))
const PublicQuizRunner = lazy(() => import('../features/papers/pages/PublicQuizRunner'))
const MyPapersHistory = lazy(() => import('../features/papers/pages/MyPapersHistory'))
const AdminPastPapers = lazy(() => import('../features/adminPastPapers/pages/AdminPastPapers'))
const PastPaperStudio = lazy(() => import('../features/adminPastPapers/pages/PastPaperStudio'))
const StatusPage = lazy(() => import('../features/marketing/pages/StatusPage'))
// Audit C5 — SEO blog. Markdown-driven, posts ship in the bundle.
const BlogIndex = lazy(() => import('../features/blog/pages/BlogIndex'))
const BlogPost = lazy(() => import('../features/blog/pages/BlogPost'))

// Admin section
const AdminLayout = lazy(() => import('../features/adminShell/pages/AdminLayout'))
const AdminDashboard = lazy(() => import('../features/adminHome/pages/AdminDashboard'))
// Mandatory MFA enrolment page — admin-only, rendered full-screen (no admin
// chrome) so a not-yet-enrolled admin gets one focused task.
const MfaSetupPage = lazy(() => import('../features/adminMfa/pages/MfaSetupPage'))
const CreateQuiz = lazy(() => import('../features/quizEditor/pages/CreateQuizV2'))
const AdminCsvImport = lazy(() => import('../features/adminContent/pages/AdminCsvImport'))
const ManageContent = lazy(() => import('../features/adminContent/pages/ManageContent'))
const AdminResults = lazy(() => import('../features/adminLearners/pages/AdminResults'))
const ContentApprovals = lazy(() => import('../features/adminContent/pages/ContentApprovals'))
const QuestionReviewQueue = lazy(() => import('../features/adminQuestionBank/pages/QuestionReviewQueue'))
const ImportQuestionBankPanel = lazy(() => import('../features/adminQuestionBank/pages/ImportQuestionBankPanel'))
const FeedbackInbox = lazy(() => import('../features/adminFeedback/pages/FeedbackInbox'))
const PaymentsPanel = lazy(() => import('../features/adminPayments/pages/PaymentsPanel'))
const BulkGrantTrialsPanel = lazy(() => import('../features/adminTrials/pages/BulkGrantTrialsPanel'))
const AdminLearners = lazy(() => import('../features/adminLearners/pages/AdminLearners'))
const AdminLearnerProfile = lazy(() => import('../features/adminLearners/pages/AdminLearnerProfile'))
const GenerationsAdmin = lazy(() => import('../features/adminContent/pages/GenerationsAdmin'))
const CbcKbAdmin = lazy(() => import('../features/adminCbcKb/pages/CbcKbAdmin'))
const PictureBankAdmin = lazy(() => import('../features/visualStudio/pages/PictureBankAdmin'))
const VisualStudioAdmin = lazy(() => import('../features/visualStudio/pages/VisualStudioAdmin'))
const CurriculumReplaceStudio = lazy(() => import('../features/adminCurriculum/pages/CurriculumReplaceStudio'))
const CurriculumUploadPanel = lazy(() => import('../features/adminCurriculum/pages/CurriculumUploadPanel'))
const AdminAiCosts = lazy(() => import('../features/adminAiCosts/pages/AdminAiCosts'))
const AdminVoice = lazy(() => import('../features/adminVoice/pages/AdminVoice'))
const AdminAppCheck = lazy(() => import('../features/adminAppCheck/pages/AdminAppCheck'))
const AdminUsersList = lazy(() => import('../features/adminUsers/pages/AdminUsersList'))
const AdminUserProfile = lazy(() => import('../features/adminUsers/pages/AdminUserProfile'))
const AdminSettings = lazy(() => import('../features/adminSettings/pages/AdminSettings'))
const AnnouncementsAdmin = lazy(() => import('../features/announcements/pages/AnnouncementsAdmin'))
const AdminActivityLog = lazy(() => import('../features/adminAnalytics/pages/AdminActivityLog'))
const AdminAnalytics = lazy(() => import('../features/adminAnalytics/pages/AdminAnalytics'))
const AdminVisitors = lazy(() => import('../features/adminAnalytics/pages/AdminVisitors'))

// Admin — Agents (operating-model dashboard)
const AgentsHome      = lazy(() => import('../features/agentsConsole/pages/AgentsHome').then(m => ({ default: m.AgentsHome })))
const AgentsAllJobs   = lazy(() => import('../features/agentsConsole/pages/AgentsHome').then(m => ({ default: m.AgentsAllJobs })))
const AgentProfile    = lazy(() => import('../features/agentsConsole/pages/AgentsHome').then(m => ({ default: m.AgentProfile })))
const AgentJobDetail  = lazy(() => import('../features/agentsConsole/pages/AgentJobDetail'))
const CompanyHQ       = lazy(() => import('../features/companyHQ/pages/CompanyHQ').then(m => ({ default: m.CompanyHQ })))

// Internal UI audit page at /dev/ui — see the route comment below.
const UiAuditPage     = lazy(() => import('../features/uiAudit/pages/UiAuditPage'))


// Audit A3 PR 1 — parent portal (public read-only progress view).
const ParentProgressView = lazy(() => import('../features/parentPortal/pages/ParentProgressView'))

// Family portal (authenticated parent accounts)

// The parent app (PROMPT 8g) — the guardian's own logged-in surface, in
// the learner design system with its own four-tab IA. Mounted under one
// layout route so the navigation never remounts between tabs (the same
// fix LearnerLayout made for the learner chrome); every page is lazy, so
// a parent loads only the screen they opened.
const ParentShell = lazy(() => import('../features/parentPortal/components/ParentShell'))
const ParentHome = lazy(() => import('../features/parentPortal/pages/ParentHome'))
const ParentChildren = lazy(() => import('../features/parentPortal/pages/ParentChildren'))
const ParentChildDetail = lazy(() => import('../features/parentPortal/pages/ParentChildDetail'))
const ParentChildActivity = lazy(() => import('../features/parentPortal/pages/ParentChildActivity'))
const ParentReports = lazy(() => import('../features/parentPortal/pages/ParentReports'))
const ParentReportDetail = lazy(() => import('../features/parentPortal/pages/ParentReportDetail'))
const ParentDeletionRequest = lazy(() => import('../features/parentPortal/pages/ParentDeletionRequest'))
const ParentAccount = lazy(() => import('../features/parentPortal/pages/ParentAccount'))
const ParentPlan = lazy(() => import('../features/parentPortal/pages/ParentPlan'))
const FamilySharing = lazy(() => import('../features/parentPortal/pages/FamilySharing'))
const FamilySharingPicker = lazy(() => import('../features/parentPortal/pages/FamilySharingPicker'))
const ParentAlerts = lazy(() => import('../features/parentPortal/pages/ParentAlerts'))
const ParentBilling = lazy(() => import('../features/parentPortal/pages/ParentBilling'))
const ParentConsent = lazy(() => import('../features/parentPortal/pages/ParentConsent'))
// The parent's own Help & support screen. The Account row for it was a
// bare mailto, on the reasoning that there was no help page to send a
// guardian to — teachers have /teacher/help and guardians had nothing, so
// their only route out of a problem was composing an email by hand.
const ParentHelp = lazy(() => import('../features/parentPortal/pages/ParentHelp'))
const AcceptCoGuardian = lazy(() => import('../features/parentPortal/pages/AcceptCoGuardian'))
// The URL requestGuardianUnlock has mailed every guardian since it
// shipped. OUTSIDE the parent guard on purpose — the recipient may have
// no account at all, and the page says what the request is before it
// asks them to make one.
const GuardianUnlock = lazy(() => import('../features/parentPortal/pages/GuardianUnlock'))
const ParentNotificationsPage = lazy(() => import('../features/parentPortal/pages/ParentNotificationsPage'))

// Teacher section. The /teacher/* routes themselves live in
// app/routes/teacherRoutes.jsx — declared as data so a spec can
// render every one of them and fail if the shared shell is missing. Add a
// teacher page there. TeacherLayout is still imported here for the
// role-branched Settings page below, which is a /settings route.
const TeacherLayout = lazy(() => import('../features/teacherShell/pages/TeacherLayout'))
// Class List + Register preview — mock data only, intentionally unguarded.
// Teacher — AI Generators
const WorksheetGenerator = lazy(() => import('../features/worksheet/pages/WorksheetGenerator'))
const FlashcardGenerator = lazy(() => import('../features/flashcards/pages/FlashcardGenerator'))
const SchemeOfWorkGenerator = lazy(() => import('../features/schemeOfWork/pages/SchemeOfWorkGenerator'))
const ClassTimetableStudio = lazy(() => import('../features/classTimetable/pages/ClassTimetableStudio'))
// Rubric Studio is retired (2026-08); no admin route mounts it either. Saved
// rubrics still render in My Library via features/rubric's RubricView.
const NotesStudio = lazy(() => import('../features/teacherNotes/pages/NotesStudio'))
// Teacher — Visual Studio (ZedExams Picture & Diagram Studio). Self-contained
// feature module under src/features/visualStudio/.

// Teacher — Library
const LibraryItemDetail = lazy(() => import('../features/teacherLibrary/pages/LibraryItemDetail'))
const PublicShareView = lazy(() => import('../features/teacherLibrary/pages/PublicShareView'))

// Daily Exams (auth required)
// The Daily Quiz replaced the Daily Exam rotation in 2026-08. ExamResultsPage
// stays mounted so a learner's PAST daily-exam attempts remain readable —
// retiring the mechanism must not delete their history.
const DailyQuizPage      = lazy(() => import('../features/dailyQuiz/pages/DailyQuizPage'))
const DailyQuizLeaderboard = lazy(() => import('../features/dailyQuiz/pages/DailyQuizLeaderboard'))
const ExamResultsPage    = lazy(() => import('../features/dailyExams/pages/ExamResultsPage'))
// The prototype-v23 weekly board. It replaced the filter-driven daily
// page: grade is auto-scoped from the profile (no grade browsing on the
// child UI) and points accumulate Monday-to-Sunday rather than resetting
// every night.

// Public games (no auth)
const GamesHub = lazy(() => import('../features/games/pages/GamesHub'))
const PlayGame = lazy(() => import('../features/games/pages/PlayGame'))
const DuelRace = lazy(() => import('../features/games/pages/DuelRace'))
const DuelLive = lazy(() => import('../features/games/pages/DuelLive'))
const GlobalLeaderboard = lazy(() => import('../features/games/pages/GlobalLeaderboard'))
const StickerCollection = lazy(() => import('../features/games/pages/StickerCollection'))
const DailyIntro = lazy(() => import('../features/games/pages/DailyIntro'))

// Admin — games seed importer
const GamesSeedAdmin = lazy(() => import('../features/games/pages/GamesSeedAdmin'))
const SpellingAdmin = lazy(() => import('../features/games/pages/SpellingAdmin'))
const SpellingRideAdmin = lazy(() => import('../features/games/pages/SpellingRideAdmin'))
const AdminDailyQuizPage = lazy(() => import('../features/adminDailyQuiz/pages/AdminDailyQuizPage'))

// Quiz editor (shared by admin + teacher)
const EditQuiz = lazy(() => import('../features/quizEditor/pages/EditQuizV2'))

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
  const { currentUser, userProfile, loading, authReady, profileIssue } = useAuth()
  // `authReady` joins the condition for the same reason the guards now gate on
  // it: `!loading` can be the watchdog giving up rather than Firebase
  // answering, and lifting the splash onto a screen that is about to redirect
  // is the launch-order bug this component exists to avoid.
  const settled = authReady && !loading && (!currentUser || !!userProfile || !!profileIssue)
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
  const { currentUser, userProfile, loading, authReady, isAdmin, isTeacher, profileIssue, needsEmailVerification } = useAuth()
  // Cold-start race: Firebase restores the persisted session asynchronously,
  // so on the first frames `currentUser` is still null even for a returning
  // logged-in user. Rendering <Marketing /> here is what made the app flash
  // the public marketing page for a few seconds before redirecting to the
  // dashboard. While auth is still resolving AND this device has a known
  // session, hold on the loader instead of flashing Marketing. A signed-out
  // visitor (no hint) still falls straight through to Marketing with no
  // spinner.
  //
  // The hint is a fast path, not the gate. It lives in localStorage while the
  // session lives in IndexedDB, so the two can desynchronise (partial site-data
  // clearing, localStorage eviction) and leave a signed-in learner with no
  // hint — who then gets Marketing on their own root URL. `authReady` is the
  // gate because it is the same fact Firebase actually reports. For a signed-out
  // visitor it resolves in the first tick (no stored user, no network), so the
  // public page is not held up; the hint still picks the warmer copy for the
  // returning user who does have one.
  if (!authReady) {
    return <FullScreenLoader label={hasAuthSessionHint() ? 'Welcome back…' : undefined} />
  }
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
  // Learners get the prototype-v6 Settings screen in the learner shell.
  // Two of its rows open a real flow that would be reckless to
  // reimplement — the account panel (LEGAL-003 delete re-authentication)
  // and the help panel (contact dialog) — so those render BARE inside
  // the same shell: one panel, a learner back row, nothing else.
  //
  // No other section is reachable. The old settings dashboard (a rail of
  // ten sections, a settings search, a card grid) is not in the learner
  // mockup, and an unknown ?section= falls back to the mockup screen
  // rather than dropping a child into it.
  if (role === 'learner') {
    return (
      <LearnerShell>
        <LearnerSettingsRoute />
      </LearnerShell>
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

// Parent app gate, as a LAYOUT route. The role levels in ProtectedRoute
// can't distinguish a parent from a learner (both sit at level 1), so this
// checks the role explicitly: only a parent (or an admin, for support)
// reaches the family surface; anyone else is bounced to their own landing
// page. On success it renders ParentShell, which carries the four-tab
// navigation and its own Suspense boundary and renders the page through
// an <Outlet> — so the chrome is mounted once for the whole section
// instead of re-mounting on every tab change.
function ParentAppRoute() {
  const { currentUser, userProfile, loading, authReady, isParent, isAdmin, needsEmailVerification } = useAuth()
  const location = useLocation()
  // Same rule as ProtectedRoute, and it has to be stated here because this
  // route guards ITSELF rather than composing that one: `loading` is dropped by
  // the restoration watchdog without knowing who the user is, so redirecting on
  // `!currentUser` while auth is unresolved bounces a live session to /login.
  // Admins reach the family hub too, so this is not only a parent's problem.
  if (!authReady || loading) return <FullScreenLoader label="Loading your family hub…" />
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location }} />
  if (!userProfile) return <FullScreenLoader label="Loading your family hub…" />
  if (needsEmailVerification && !isWithinVerificationGrace(userProfile)) {
    return <Navigate to="/verify-email" replace state={{ from: location }} />
  }
  if (!isParent && !isAdmin) return <Navigate to={getRoleLandingPath(userProfile)} replace />
  return <ParentShell />
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
      {/* Days 0–3 after expiry — a thin amber bar, not a barrier. Everything
          stays unlocked during grace; this is the fade that replaced the wall.
          Self-hides outside the grace window and on immersive routes. */}
      <Suspense fallback={null}><GraceRibbon /></Suspense>
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
      {/* The same binding for the learner READING palette, at
          users/{uid}.preferences.readingTheme. Without it the theme lived in
          localStorage alone, so a browser that had never saved one fell back
          to the prefers-color-scheme seed — which is why a learner on a
          dark-mode machine got Midnight in incognito and on every other
          browser no matter what they had picked. Mounted here for the same
          reason as TeacherThemeSync above (headless; no-op when signed out). */}
      <ReadingThemeSync />
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
          {/* A parent session never renders a learner screen. Mounted here,
              above the table, because the failure it closes is a shape of
              link rather than one link: anything landing a guardian on
              /settings or /my-subscription produced the learner shell and
              the heading "Signed in as Learner". See guards/parentRedirects. */}
          <ParentRouteGuard>
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

          <Route path="/guardian-unlock"          element={<GuardianUnlock />} />

          {/* ── The parent app — authenticated guardian accounts ───── */}
          {/* One layout route, so the four-tab navigation is mounted once
              and only the page swaps. The guard sits on the layout rather
              than on each line because every page below it is the same
              surface for the same role; a page that needed a different
              posture would take its own line outside this block. */}
          <Route element={<ParentAppRoute />}>
            <Route path="/family"                              element={<ParentHome />} />
            <Route path="/family/children"                     element={<ParentChildren />} />
            <Route path="/family/child/:childUid"              element={<ParentChildDetail />} />
            <Route path="/family/child/:childUid/activity"     element={<ParentChildActivity />} />
            <Route path="/family/child/:childUid/report"       element={<ParentReportDetail />} />
            {/* A deletion request the guardian was asked to answer. Its own
                route rather than a modal on /family, because the decision is
                time-boxed and irreversible: it has to survive a closed tab,
                a re-read, and the deep link in the email. */}
            <Route path="/family/requests/:requestId"          element={<ParentDeletionRequest />} />
            {/* Co-guardianship is per CHILD, so the account row lands on a
                picker; with one child it redirects straight through. */}
            <Route path="/family/sharing"                      element={<FamilySharingPicker />} />
            <Route path="/family/sharing/:childUid"            element={<FamilySharing />} />
            <Route path="/family/reports"                      element={<ParentReports />} />
            <Route path="/family/account"                      element={<ParentAccount />} />
            <Route path="/family/plan"                         element={<ParentPlan />} />
            {/* The guardian's own settings, in the family shell. These
                three replace links that pointed OUT of /family/* into the
                learner surface: /settings?section=notifications rendered
                the learner shell and told a parent they were "signed in as
                Learner", and /my-subscription is written for the account
                that holds the plan — which a guardian never is, because
                the money credits the child. */}
            <Route path="/family/account/alerts"               element={<ParentAlerts />} />
            <Route path="/family/account/billing"              element={<ParentBilling />} />
            <Route path="/family/account/consent"              element={<ParentConsent />} />
            <Route path="/family/help"                          element={<ParentHelp />} />
            {/* The co-guardian invite lands here from an email. It is
                inside the guard on purpose: accepting requires a parent
                account, and the page explains that before bouncing
                anyone to /login with a return path. */}
            <Route path="/family/accept"                       element={<AcceptCoGuardian />} />
            {/* The inbox shipped self-chromed, outside the old Tailwind
                ParentLayout, because it was the parent side's first screen
                in the prototype's design system and mixing the two inside
                one shell would have read as a bug in both. The rest of that
                reskin is here now, so it renders in the shell like every
                other parent screen — a parent arrives from the bell and
                leaves to whatever the notification was about, and the tab
                bar is what they leave by. */}
            <Route path="/family/notifications"                element={<ParentNotificationsPage />} />
          </Route>

          {/* ── Public games (no auth) ──────────────────────────── */}
          {/* Flow: /games → /games/g/:grade → /games/g/:grade/:subject → /games/play/:gameId */}
          {/* The hub renders inside the learner shell (4-tab nav) but stays
              public — the LearnerLayout chrome renders nothing
              account-specific, so no guard is needed on this line. */}
          <Route element={<LearnerLayout />}>
            <Route path="/games"                       element={<GamesHub />} />
            <Route path="/games/stickers"              element={<StickerCollection />} />
            <Route path="/games/daily"                 element={<DailyIntro />} />
          </Route>
          <Route path="/games/leaderboard"             element={<GlobalLeaderboard />} />
          {/* Grade/subject browsing retired (step 8) — the hub IS the
              catalogue now, one card per mechanic like the mockup. */}
          <Route path="/games/g/:grade"                element={<Navigate to="/games" replace />} />
          <Route path="/games/g/:grade/:subject"       element={<Navigate to="/games" replace />} />
          <Route path="/games/play/:gameId"            element={<PlayGame />} />
          {/* Race Zed! — the honest duel: full-screen chrome of its own,
              so it mounts bare like the play surface. */}
          <Route path="/games/duel"                    element={<DuelRace />} />
          <Route path="/games/duel/live"               element={<DuelLive />} />

          {/* ── Learner routes ─────────────────────────────────── */}
          {/* The prototype-v3 learner shell (2026-08 redesign). The chrome
              (4-tab nav + page column) is a LAYOUT route so it never
              remounts between tab changes; auth guards stay on each child
              route's own line because the route-guard scripts parse them
              per line. */}
          {/* First-run setup, outside the shell — the mockup hides the nav so
              a half-finished setup has nowhere to tab away to. It is also
              outside LearnerSetupGate, which is what it redirects TO. */}
          <Route path="/setup" element={<ProtectedRoute><LearnerOnlyRoute><LearnerSetupPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route element={<LearnerLayout />}>
            <Route path="/dashboard"         element={<ProtectedRoute><LearnerOnlyRoute><LearnerSetupGate><LearnerHomePage /></LearnerSetupGate></LearnerOnlyRoute></ProtectedRoute>} />
            <Route path="/dashboard-preview" element={<ProtectedRoute><LearnerOnlyRoute><LearnerHomePage /></LearnerOnlyRoute></ProtectedRoute>} />
            <Route path="/subjects/:subjectId" element={<ProtectedRoute><LearnerOnlyRoute><LearnerSubjectPage /></LearnerOnlyRoute></ProtectedRoute>} />
            {/* The school calendar as a learner reads it — term dates, which
                term is running, the holidays, when school opens again. It is
                the learner's OWN screen over the shared MoE calendar data
                (src/utils/learnerCalendar.js → moeCalendar.js); the teacher's
                planning calendar at /teacher/calendar is a different page and
                neither side can reach the other. Reached from the Grade · Term
                chip on Home. NOT /calendar — that path is a redirect to the
                exam timetable and old bookmarks still mean the exams by it. */}
            <Route path="/school-calendar" element={<ProtectedRoute><LearnerOnlyRoute><LearnerSchoolCalendarPage /></LearnerOnlyRoute></ProtectedRoute>} />
            {/* Interactive exam timetable — the prototype's timetable screen
                (Home chip + Papers row tap through here). The PDF twin stays
                below, outside the shell. */}
            <Route path="/timetable"       element={<ProtectedRoute><LearnerOnlyRoute><ExamTimetablePage /></LearnerOnlyRoute></ProtectedRoute>} />
            {/* The Notes tab — the prototype-v4 revision hub. Individual
                notes (/notes/:id) stay full-screen outside the shell. */}
            <Route path="/notes"           element={<ProtectedRoute><LearnerOnlyRoute><LearnerGate><LearnerNotesList /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />
            {/* The prototype-v6 notification centre — the topbar bell lands
                here; the nav stays visible per the mockup. */}
            <Route path="/notifications"   element={<ProtectedRoute><LearnerOnlyRoute><LearnerNotificationsPage /></LearnerOnlyRoute></ProtectedRoute>} />
            {/* My Progress → Study Plan: results → weak topics → practice. */}
            <Route path="/progress"        element={<ProtectedRoute><LearnerOnlyRoute><MyProgressPage /></LearnerOnlyRoute></ProtectedRoute>} />
            <Route path="/study-plan"      element={<ProtectedRoute><LearnerOnlyRoute><StudyPlanPage /></LearnerOnlyRoute></ProtectedRoute>} />
            {/* The weekly daily-quiz board. Inside the shell because the
                mockup keeps the four tabs visible here — it is a place a
                learner browses to, not an immersive run. */}
            <Route path="/daily/leaderboard" element={<ProtectedRoute><LearnerOnlyRoute><DailyQuizLeaderboard /></LearnerOnlyRoute></ProtectedRoute>} />
            <Route path="/exams/leaderboard" element={<Navigate to="/daily/leaderboard" replace />} />
          </Route>
          {/* The five retired learner screens (2026-08-20). Each was a
              pre-redesign page the new IA replaced, and none of them was
              reachable from a live learner surface any more — the legacy
              Navbar's own menu was the only route in, and that came off
              /notes/:id in the pass before this one. They stay as
              redirects because the URLs are in bookmarks, in sent
              notifications and in learners' history; a 404 would tell a
              child their results had been deleted, which is not what
              happened. Where a redirect loses something, it is named
              below rather than implied. */}
          <Route path="/dashboard/classic" element={<Navigate to="/dashboard" replace />} />
          <Route path="/practice/daily-exams" element={<Navigate to="/daily" replace />} />
          {/* Learn + Practice retired (redesign step 5, locked scope): the
              4-tab IA carries their destinations — subjects on Home,
              lessons/notes/quizzes via Quick Access, daily exams on Home's
              Today's Exams card, results/achievements in the profile
              sheet. Old bookmarks land Home. */}
          <Route path="/learn" element={<Navigate to="/dashboard" replace />} />
          <Route path="/practice" element={<Navigate to="/dashboard" replace />} />
          {/* /learner/* aliases from the redesign spec → canonical routes */}
          <Route path="/learner" element={<Navigate to="/dashboard" replace />} />
          <Route path="/learner/learn" element={<Navigate to="/dashboard" replace />} />
          <Route path="/learner/papers" element={<Navigate to="/papers" replace />} />
          <Route path="/learner/practice" element={<Navigate to="/dashboard" replace />} />
          <Route path="/learner/games" element={<Navigate to="/games" replace />} />
          <Route path="/learner/profile" element={<Navigate to="/profile" replace />} />
          {/* Legacy stats page (kept for admin/teacher reference) */}
          {/* /my-stats → /progress. The new page carries exam readiness,
              the week, subject mastery and weak topics; the retired one's
              per-subject analytics charts are NOT carried over. */}
          <Route path="/my-stats"          element={<Navigate to="/progress" replace />} />
          {/* /calendar → /timetable, the interactive exam schedule. */}
          <Route path="/calendar"          element={<Navigate to="/timetable" replace />} />
          {/* The official ECZ PDF stays readable in-app at /timetable/pdf
              (Android WebViews drop external PDF links); the interactive
              /timetable lives in the LearnerLayout group above. */}
          <Route path="/timetable/pdf"     element={<ProtectedRoute><LearnerOnlyRoute><TimetableViewerPage /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* The Daily Quiz — five questions, once a day, the same five for
              every learner in the grade. Outside the shell: it is an
              immersive run, like the quiz runner. */}
          <Route path="/daily"                       element={<ProtectedRoute><LearnerOnlyRoute><DailyQuizPage /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* The Daily Exam rotation it replaced. Old bookmarks and push
              notifications land on today's quiz rather than a 404 — the
              destination they wanted still exists, it is just five questions
              now instead of a whole paper. */}
          <Route path="/exams"                       element={<Navigate to="/daily" replace />} />
          <Route path="/exam/:examId"                element={<Navigate to="/daily" replace />} />
          {/* Kept live, NOT redirected: a past attempt is a learner's own
              record and the link is the only way back to it. */}
          <Route path="/exam-results/:attemptId"     element={<ProtectedRoute><LearnerOnlyRoute><ExamResultsPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quizzes"           element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizList /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* /practise/:grade/:subjectId (the SubjectDrillDown course map)
              was retired — the quiz library at /quizzes is the one place a
              learner browses quizzes by subject. No redirect: the route was
              never linked from outside the app and carries no shareable
              content, so a 404 through the SPA fallback is honest. */}
          <Route path="/quiz/:quizId"      element={<ProtectedRoute><LearnerOnlyRoute><QuizRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/results/:resultId" element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizResults /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Global learner search across quizzes / notes / papers / games. */}
          <Route path="/search"            element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerSearch /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Notes (standalone reading material) — canonical /notes routes. */}
          <Route path="/notes/reader-preview" element={<ProtectedRoute><LearnerOnlyRoute><NoteReaderPreview /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* NO <Navbar />, and not the learner shell either — the reader
              brings its own chrome for every state it can be in, and both of
              the alternatives are wrong here.

              The legacy Navbar was the real cost. It mounted OUTSIDE this
              page, so the old cream header sat on top of all four states —
              including the full-screen ReaderEngine, which is deliberately
              immersive. Worse, its menu is an eight-item list of the retired
              IA (Lessons / Quizzes / Exams / Results), and this route is the
              busiest one that carried it: a learner reaching a note — the
              destination the whole Home → subject → note funnel exists for —
              was handed the door back into every pre-redesign screen. That
              menu is how those screens were still being seen at all; nothing
              else on the live learner side links to them.

              LearnerLayout would be the other mistake: it would draw the
              4-tab bar over a reading surface the prototype keeps clear.
              ReaderEngine carries its own back control (ReaderEngine.jsx),
              and the loading / not-found / retired-format states each bring
              their own `.lhx` page with a back row to /notes — so nothing
              here needs chrome from the route. `test:learner-chrome` fails
              if the Navbar comes back. */}
          <Route path="/notes/:id"         element={<ProtectedRoute><LearnerOnlyRoute><LearnerGate><LearnerNoteRead /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />

          {/* Lessons (interactive slide-based lessons) — canonical /lessons routes.
              LearnerNoteRead handles the bookmark-back-compat case: if a learner
              lands on /notes/:id with a slide-based doc it redirects them here. */}
          {/* The mockup has ONE reading surface — the Notes tab. The
              slide-lesson LIBRARY is not in it, so browsing it is
              retired; the player below stays for the handoff from
              LearnerNoteRead and for links already in the wild, so no
              published lesson becomes unreachable. */}
          <Route path="/lessons"                element={<Navigate to="/notes" replace />} />
          <Route path="/lessons/:lessonId"      element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerGate><LessonPlayer /></LearnerGate></LearnerOnlyRoute></ProtectedRoute>} />
          {/* /my-results → /progress. The per-attempt results LIST is the
              one thing genuinely lost here: /progress reports mastery and
              weak topics, not "every quiz I have taken". An individual
              result is still reachable at /results/:resultId, which is
              where every notification and share link points. */}
          <Route path="/my-results"        element={<Navigate to="/progress" replace />} />
          {/* /my-badges → /profile, which already renders the full badge
              shelf (GAME_BADGES + getMyGameBadges), earned and locked. */}
          <Route path="/my-badges"         element={<Navigate to="/profile" replace />} />
          {/* Role-branched (step 10): learners get the prototype-v6 "My
              Profile" in the learner shell; other roles keep the shared
              ProfilePage. Branch lives in ProfileRoute. */}
          <Route path="/profile"           element={<ProtectedRoute><ProfileRoute /></ProtectedRoute>} />
          {/* The prototype-v7 Guardian Zone — an adult friction check, then
              a read-only view of the child's progress plus the permission
              controls. Deliberately OUTSIDE the learner layout: the mockup
              hides the child's tab bar inside the zone so it reads as a
              separate space. Learner-only, because the zone is bound to one
              child's account (a guardian with their own login uses the
              parent portal). */}
          <Route path="/guardian"          element={<ProtectedRoute><LearnerOnlyRoute><GuardianZonePage /></LearnerOnlyRoute></ProtectedRoute>} />
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
          {/* Where an under-18 learner lands instead of a price list —
              /my-subscription and /pricing both redirect here. It carries no
              price and no checkout; the ask goes to the linked guardian
              through requestGuardianUnlock. See AskGrownUpPage. */}
          <Route path="/ask-a-grown-up"    element={<ProtectedRoute><AskGrownUpPage /></ProtectedRoute>} />
          {/* Nested paths (/settings/profile, /settings/school, …) are the
              Teacher Settings detail panels; SettingsPage renders the right
              chrome per role and TeacherSettings routes the subpath. */}
          <Route path="/settings/*"        element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

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
          <Route path="/admin/voice"                    element={<AdminRoute><AdminVoice /></AdminRoute>} />
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
          <Route path="/admin/spelling"                 element={<AdminRoute><SpellingAdmin /></AdminRoute>} />
          <Route path="/admin/spelling-ride"            element={<AdminRoute><SpellingRideAdmin /></AdminRoute>} />
          {/* The Daily Quiz Generator console — tonight's run, the funnel,
              tomorrow's preview, bank health and the event log. */}
          <Route path="/admin/daily-quiz"               element={<AdminRoute><AdminDailyQuizPage /></AdminRoute>} />
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
              Declared as data in app/routes/teacherRoutes.jsx so the
              shell can be asserted for every one of them (teacherRoutes.spec
              renders each route and fails if TeacherLayout is missing). Add a
              teacher page THERE, not here. */}
          {TEACHER_ROUTES.map(({ path, element }) => (
            <Route key={path} path={path} element={element} />
          ))}

          <Route path="*" element={<NotFound />} />
        </Routes>
        </ParentRouteGuard>
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
          {/* Tier 2 — the contextual unlock sheet. Opens ONLY from a tapped
              lock (unlockSheet.open via useUnlockFlow), never on mount, never
              on a route change, never on sign-in. The mount-time "Your Premium
              has ended" interstitial that used to sit here was deleted in full
              rather than delayed or shrunk: it charged a toll at the highest-
              intent moment of the day, before any value had landed, and it
              showed a price to learners who have no mobile money account. */}
          <UnlockSheetHost />
        </Suspense>
      </div>
      </PlatformSettingsProvider>
    </BrowserRouter>
  )
}
