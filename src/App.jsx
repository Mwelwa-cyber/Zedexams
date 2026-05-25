import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useTheme, applyThemeToBody, DEFAULT_THEME } from './contexts/ThemeContext'
import { PlatformSettingsProvider } from './contexts/PlatformSettingsContext'
import MaintenanceBanner from './components/banners/MaintenanceBanner'
import AnnouncementBanner from './components/banners/AnnouncementBanner'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LearnerOnlyRoute from './components/auth/LearnerOnlyRoute'
import Navbar from './components/layout/Navbar'
import { getRoleLandingPath } from './utils/navigation'
import PageLoader from './components/ui/PageLoader'
import OfflineBanner from './components/ui/OfflineBanner'
import UpdatePrompt from './components/ui/UpdatePrompt'
import CookieConsentBanner from './components/ui/CookieConsentBanner'
import ZedChatLauncher from './components/ai/ZedChatLauncher'
import ErrorBoundary from './components/ui/ErrorBoundary'

// Auth/legal routes always render in the brand-default theme so a
// visitor's previously-saved preference (e.g. Vivid's deep violet bg)
// can't bleed onto the light-only login/register/legal screens. The
// saved theme applies again as soon as they land on an authenticated
// route.
//
// The marketing landing page ('/') is intentionally NOT pinned here: it
// follows the active/saved theme so it matches the in-app look for
// returning users. New visitors have no saved preference, so it still
// resolves to the brand default via resolveInitialTheme().
const PUBLIC_THEME_PATHS = new Set([
  '/login', '/register', '/auth/action',
  '/pricing', '/privacy', '/terms', '/status',
  '/papers',
])
function isPublicThemePath(pathname) {
  if (PUBLIC_THEME_PATHS.has(pathname)) return true
  if (pathname.startsWith('/share/')) return true
  if (pathname.startsWith('/papers/')) return true
  if (pathname.startsWith('/grade-')) return true
  if (pathname.startsWith('/parent/')) return true
  if (pathname === '/blog' || pathname.startsWith('/blog/')) return true
  // /my-papers is auth-only but visually shares the past-paper
  // theme so we keep it on the brand default.
  if (pathname === '/my-papers') return true
  return false
}

function ThemeApplicator() {
  const { theme } = useTheme()
  const { pathname } = useLocation()
  useEffect(() => {
    applyThemeToBody(isPublicThemePath(pathname) ? DEFAULT_THEME : theme)
  }, [pathname, theme])
  return null
}

const Login = lazy(() => import('./components/auth/Login'))
const Register = lazy(() => import('./components/auth/Register'))
const AuthAction = lazy(() => import('./components/auth/AuthAction'))
const StudentDashboard = lazy(() => import('./components/dashboard/StudentDashboard'))
const GradeHub = lazy(() => import('./components/dashboard/GradeHub'))
const LearnerCalendar = lazy(() => import('./components/dashboard/LearnerCalendar'))
const SubjectDrillDown = lazy(() => import('./components/dashboard/SubjectDrillDown'))
const QuizList = lazy(() => import('./components/quiz/QuizList'))
// Learner-facing AI-generated practice quizzes (feature-flagged
// via settings/global.learnerAi.showAiPracticeQuizzesToLearners).
const AiPracticeQuizList   = lazy(() => import('./components/learnerAi/AiPracticeQuizList'))
const AiPracticeQuizRunner = lazy(() => import('./components/learnerAi/AiPracticeQuizRunner'))
// Learner-facing AI-generated notes (feature-flagged via
// settings/global.learnerAi.showAiNotesToLearners). Read-only.
const AiNotesList   = lazy(() => import('./components/learnerAi/AiNotesList'))
const AiNotesReader = lazy(() => import('./components/learnerAi/AiNotesReader'))
const QuizRunner = lazy(() => import('./components/quiz/QuizRunnerV2'))
const QuizResults = lazy(() => import('./components/quiz/QuizResultsV2'))
// Slide-based interactive lessons. /lessons is the canonical learner-
// facing list (LearnerLessonsList) and /lessons/:lessonId opens the
// existing slide player. The teacher panel uses LessonEditor under
// /teacher/lessons for authoring.
const LessonEditor    = lazy(() => import('./components/lessons/LessonEditor'))
const LessonDashboard = lazy(() => import('./components/lessons/LessonDashboard'))
const LessonPlayer    = lazy(() => import('./components/lessons/LessonPlayer'))
const LearnerLessonsList = lazy(() => import('./features/lessons/pages/LearnerLessonsList').then(m => ({ default: m.LearnerLessonsList })))

// Notes Studio admin — replaces the old slide-builder at /admin/lessons
const AdminNotesList    = lazy(() => import('./features/notes/pages/AdminNotesList').then(m => ({ default: m.AdminNotesList })))
const AdminNoteEditor   = lazy(() => import('./features/notes/pages/AdminNoteEditor').then(m => ({ default: m.AdminNoteEditor })))

// Notes Studio learner — /notes list + reader, gated by LearnerGate
const LearnerNotesList  = lazy(() => import('./features/notes/pages/LearnerNotesList').then(m => ({ default: m.LearnerNotesList })))
const LearnerNoteRead   = lazy(() => import('./features/notes/pages/LearnerNoteRead').then(m => ({ default: m.LearnerNoteRead })))
const LearnerGate       = lazy(() => import('./features/notes/components/LearnerGate').then(m => ({ default: m.LearnerGate })))
const MyResults = lazy(() => import('./components/dashboard/MyResults'))
const BadgesPage = lazy(() => import('./components/dashboard/BadgesPage'))
const ProfilePage = lazy(() => import('./components/dashboard/ProfilePage'))
const ZedExamsSettings = lazy(() => import('./components/settings/zedexams-settings'))
const PaywallHost = lazy(() => import('./components/subscription/PaywallHost'))
const NotFound = lazy(() => import('./components/ui/NotFound'))
const Marketing = lazy(() => import('./components/marketing/Marketing'))
const Plans = lazy(() => import('./components/marketing/Plans'))
const GradePackLanding = lazy(() => import('./components/marketing/GradePackLanding'))
const PrivacyPolicy = lazy(() => import('./components/marketing/PrivacyPolicy'))
const Terms = lazy(() => import('./components/marketing/Terms'))
const PastPapersHub = lazy(() => import('./components/papers/PastPapersHub'))
const PastPaperViewer = lazy(() => import('./components/papers/PastPaperViewer'))
const PastPaperPractice = lazy(() => import('./components/papers/PastPaperPractice'))
const PublicQuizRunner = lazy(() => import('./components/papers/PublicQuizRunner'))
const MyPapersHistory = lazy(() => import('./components/papers/MyPapersHistory'))
const AdminPastPapers = lazy(() => import('./components/admin/AdminPastPapers'))
const PastPaperStudio = lazy(() => import('./components/admin/PastPaperStudio'))
const ZedChatPage = lazy(() => import('./components/ai/ZedChatPage'))
const StatusPage = lazy(() => import('./components/marketing/StatusPage'))
// Audit C5 — SEO blog. Markdown-driven, posts ship in the bundle.
const BlogIndex = lazy(() => import('./components/blog/BlogIndex'))
const BlogPost = lazy(() => import('./components/blog/BlogPost'))

// Admin section
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'))
const CreateQuiz = lazy(() => import('./components/admin/CreateQuizV2'))
const AdminCsvImport = lazy(() => import('./components/admin/AdminCsvImport'))
const ManageContent = lazy(() => import('./components/admin/ManageContent'))
const AdminResults = lazy(() => import('./components/admin/AdminResults'))
const ContentApprovals = lazy(() => import('./components/admin/ContentApprovals'))
const PaymentsPanel = lazy(() => import('./components/admin/PaymentsPanel'))
const BulkGrantTrialsPanel = lazy(() => import('./components/admin/BulkGrantTrialsPanel'))
const AdminLearners = lazy(() => import('./components/admin/AdminLearners'))
const AdminLearnerProfile = lazy(() => import('./components/admin/AdminLearnerProfile'))
const GenerationsAdmin = lazy(() => import('./components/admin/GenerationsAdmin'))
const CbcKbAdmin = lazy(() => import('./components/admin/CbcKbAdmin'))
const CurriculumReplaceStudio = lazy(() => import('./components/admin/CurriculumReplaceStudio'))
const AdminAiCosts = lazy(() => import('./components/admin/AdminAiCosts'))
const AdminAppCheck = lazy(() => import('./components/admin/AdminAppCheck'))
const AdminUsersList = lazy(() => import('./components/admin/users/AdminUsersList'))
const AdminUserProfile = lazy(() => import('./components/admin/users/AdminUserProfile'))
const AdminSettings = lazy(() => import('./components/admin/settings/AdminSettings'))
const AnnouncementsAdmin = lazy(() => import('./components/admin/announcements/AnnouncementsAdmin'))
const AdminActivityLog = lazy(() => import('./components/admin/AdminActivityLog'))
const AdminAnalytics = lazy(() => import('./components/admin/AdminAnalytics'))

// Admin — Agents (operating-model dashboard)
const AgentsHome      = lazy(() => import('./components/admin/agents/AgentsHome').then(m => ({ default: m.AgentsHome })))
const AgentsAllJobs   = lazy(() => import('./components/admin/agents/AgentsHome').then(m => ({ default: m.AgentsAllJobs })))
const AgentProfile    = lazy(() => import('./components/admin/agents/AgentsHome').then(m => ({ default: m.AgentProfile })))
const AgentJobDetail  = lazy(() => import('./components/admin/agents/AgentJobDetail'))

// Learner-AI admin pages (AI Control Centre at /admin/learner-ai).
const LearnerAiHome           = lazy(() => import('./components/admin/learnerAi/LearnerAiHome'))
const LearnerAiTaskDetail     = lazy(() => import('./components/admin/learnerAi/TaskDetailPage'))
const LearnerAiLogs           = lazy(() => import('./components/admin/learnerAi/AgentLogsTable'))
const LearnerAiCurriculumRpts = lazy(() => import('./components/admin/learnerAi/CurriculumUpdateReports'))
const LearnerAiStagedModules = lazy(() => import('./components/admin/learnerAi/StagedModulesPanel'))
const LearnerAiStandards      = lazy(() => import('./components/admin/learnerAi/AssessmentStandardsList'))
// Phase A content-management tabs.
const LearnerAiContentType    = lazy(() => import('./components/admin/learnerAi/ContentTypePage'))
const LearnerAiFailedChecks   = lazy(() => import('./components/admin/learnerAi/FailedChecksPage'))
const LearnerAiWeakness       = lazy(() => import('./components/admin/learnerAi/WeaknessReportsList'))
const LearnerAiReports        = lazy(() => import('./components/admin/learnerAi/AgentReports'))
const LearnerAiSettings       = lazy(() => import('./components/admin/learnerAi/AgentSettings'))
const LearnerAiExamDetail     = lazy(() => import('./components/admin/learnerAi/ExamDraftDetailPage'))

// Teacher — Agent submissions
const AgentBriefForm       = lazy(() => import('./components/teacher/AgentBriefForm'))
const TeacherAgentJobsList = lazy(() => import('./components/teacher/AgentJobsList').then(m => ({ default: m.AgentJobsList })))
// Audit A10 — teacher classroom roster (foundation PR; quiz assignment + class analytics stack later).
const TeacherClassesList = lazy(() => import('./components/teacher/classes/TeacherClassesList'))
const TeacherClassEditor = lazy(() => import('./components/teacher/classes/TeacherClassEditor'))
const TeacherClassDetail = lazy(() => import('./components/teacher/classes/TeacherClassDetail'))
// Audit A10 PR 2 — learner-side join + view classes.
const LearnerClassesList = lazy(() => import('./components/classes/LearnerClassesList'))
const LearnerClassJoin = lazy(() => import('./components/classes/LearnerClassJoin'))
const LearnerClassDetail = lazy(() => import('./components/classes/LearnerClassDetail'))
// Audit A3 PR 1 — parent portal (public read-only progress view).
const ParentProgressView = lazy(() => import('./components/parent/ParentProgressView'))
const TeacherAgentJobView  = lazy(() => import('./components/teacher/AgentJobsList').then(m => ({ default: m.AgentJobView })))

// Teacher section
const TeacherLayout = lazy(() => import('./components/teacher/TeacherLayout'))
const TeacherDashboard = lazy(() => import('./components/teacher/TeacherDashboard'))
const SchoolCalendar = lazy(() => import('./components/teacher/SchoolCalendar'))
const WelcomeToPro = lazy(() => import('./components/teacher/WelcomeToPro'))
const SyllabiLibrary = lazy(() => import('./components/teacher/SyllabiLibrary'))
const CurriculumHome = lazy(() => import('./components/teacher/curriculum/CurriculumHome'))
const PrimaryCurriculum = lazy(() => import('./components/teacher/curriculum/PrimaryCurriculum'))
const SecondaryCurriculum = lazy(() => import('./components/teacher/curriculum/SecondaryCurriculum'))
const AssessmentStudio = lazy(() => import('./components/teacher/AssessmentStudio'))
const EditAssessment = lazy(() => import('./components/teacher/EditAssessment'))
const AssessmentList = lazy(() => import('./components/teacher/AssessmentList'))

// Teacher — AI Generators
const LessonPlanStudio = lazy(() => import('./components/teacher/generate/LessonPlanStudio'))
const LessonPlanGenerator = lazy(() => import('./components/teacher/generate/LessonPlanGenerator'))
const CurriculumStudio = lazy(() => import('./components/teacher/generate/CurriculumStudio'))
const FullLessonStudio = lazy(() => import('./components/teacher/generate/FullLessonStudio'))
const HomeworkStudio = lazy(() => import('./components/teacher/generate/HomeworkStudio'))
const AssessmentGenerator = lazy(() => import('./components/teacher/generate/AssessmentGenerator'))
const QuizStudio = lazy(() => import('./components/teacher/generate/QuizStudio'))
const WorksheetGenerator = lazy(() => import('./components/teacher/generate/WorksheetGenerator'))
const FlashcardGenerator = lazy(() => import('./components/teacher/generate/FlashcardGenerator'))
const SchemeOfWorkGenerator = lazy(() => import('./components/teacher/generate/SchemeOfWorkGenerator'))
const RubricGenerator = lazy(() => import('./components/teacher/generate/RubricGenerator'))
const NotesStudio = lazy(() => import('./components/teacher/generate/NotesStudio'))

// Teacher — Library
const TeacherLibrary = lazy(() => import('./components/teacher/library/TeacherLibrary'))
const LibraryItemDetail = lazy(() => import('./components/teacher/library/LibraryItemDetail'))
const PublicShareView = lazy(() => import('./components/teacher/library/PublicShareView'))

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

function RootRedirect() {
  const { currentUser, userProfile, isAdmin, isTeacher, profileIssue } = useAuth()
  if (!currentUser) return <Marketing />
  if (profileIssue) return <MissingProfileRecovery />
  if (!userProfile) return <PageLoader />
  return (
    <Navigate
      to={getRoleLandingPath({ role: userProfile.role, isAdmin, isTeacher })}
      replace
    />
  )
}

function SettingsPage() {
  const { userProfile, isAdmin, isTeacher } = useAuth()
  const role = isAdmin ? 'admin' : (isTeacher ? 'teacher' : (userProfile?.role || 'learner'))
  return <ZedExamsSettings role={role} />
}

function AdminRoute({ children }) {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>{children}</AdminLayout>
    </ProtectedRoute>
  )
}

function TeacherRoute({ children }) {
  return (
    <ProtectedRoute requiredRole="teacher">
      <TeacherLayout>{children}</TeacherLayout>
    </ProtectedRoute>
  )
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

function MissingProfileRecovery() {
  const { currentUser, profileIssue, ensureUserProfile, logout } = useAuth()
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  async function handleRepair() {
    setWorking(true)
    setMessage('')
    try {
      const profile = await ensureUserProfile(currentUser)
      if (!profile) {
        setMessage('We could not restore this account automatically yet. Please sign out and try again, or contact support.')
      }
    } finally {
      setWorking(false)
    }
  }

  async function handleSignOut() {
    setWorking(true)
    try {
      await logout()
    } finally {
      setWorking(false)
    }
  }

  const description = profileIssue === 'unreadable'
    ? 'We signed you in, but ZedExams could not read your account profile yet.'
    : 'We signed you in, but your ZedExams profile is missing.'

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-4">
      <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
        <div className="text-4xl mb-3">🛠️</div>
        <h1 className="text-display-md theme-text mb-2">Account Repair Needed</h1>
        <p className="theme-text-muted text-body-sm mb-2">{description}</p>
        <p className="theme-text-muted text-body-sm mb-6">
          Signed in as <span className="font-black theme-text">{currentUser?.email || 'your account'}</span>.
        </p>

        {message && (
          <p className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm mb-4" style={{ borderColor: 'var(--danger-fg)' }}>
            {message}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleRepair}
            disabled={working}
            className="w-full rounded-xl bg-green-600 px-4 py-3 text-white font-black transition hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {working ? 'Repairing account…' : 'Repair My Account'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={working}
            className="w-full rounded-xl border theme-border px-4 py-3 font-black theme-text bg-transparent hover:bg-black/5 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
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
      {/* Offline banner — slides in at the top when navigator.onLine flips
          false. Firestore queues writes locally so the user's progress
          survives the network drop; this is the visible reassurance. */}
      <OfflineBanner />
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
          {/* Grade-specific landing pages — the URLs to share in
              WhatsApp posts. Slug = grade number; data lives in
              GradePackLanding's GRADE_PACKS map. */}
          <Route path="/grade-:gradeSlug" element={<GradePackLanding />} />
          <Route path="/privacy"  element={<PrivacyPolicy />} />
          <Route path="/terms"    element={<Terms />} />
          {/* Audit A2 — public ECZ past-paper archive. Hub is no-auth so
              search engines and signed-out visitors can browse; the actual
              PDF viewer at /papers/:id requires sign-in to download. */}
          <Route path="/papers"            element={<PastPapersHub />} />
          <Route path="/papers/:paperId"   element={<PastPaperViewer />} />
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

          {/* Public share link — no auth, read-only viewer of a frozen snapshot */}
          <Route path="/share/:token"             element={<PublicShareView />} />
          {/* Audit A3 — parent portal. Public token-based read; no auth. */}
          <Route path="/parent/:token"            element={<ParentProgressView />} />

          {/* ── Public games (no auth) ──────────────────────────── */}
          {/* Flow: /games → /games/g/:grade → /games/g/:grade/:subject → /games/play/:gameId */}
          <Route path="/games"                         element={<GamesHub />} />
          <Route path="/games/leaderboard"             element={<GlobalLeaderboard />} />
          <Route path="/games/g/:grade"                element={<SubjectSelector />} />
          <Route path="/games/g/:grade/:subject"       element={<GameList />} />
          <Route path="/games/play/:gameId"            element={<PlayGame />} />

          {/* ── Learner routes ─────────────────────────────────── */}
          {/* GradeHub is the new CBC-aligned primary dashboard */}
          <Route path="/dashboard"         element={<ProtectedRoute><LearnerOnlyRoute><GradeHub /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/dashboard-preview" element={<ProtectedRoute><LearnerOnlyRoute><GradeHub /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Legacy stats page (kept for admin/teacher reference) */}
          <Route path="/my-stats"          element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><StudentDashboard /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/calendar"          element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerCalendar /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exams"                        element={<ProtectedRoute><LearnerOnlyRoute><DailyExamsHub /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exams/leaderboard"           element={<ProtectedRoute><LearnerOnlyRoute><ExamLeaderboardPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exam/:examId"                element={<ProtectedRoute><LearnerOnlyRoute><DailyExamRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exam-results/:attemptId"     element={<ProtectedRoute><LearnerOnlyRoute><ExamResultsPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quizzes"           element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizList /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* AI-generated practice quizzes. Feature-flagged inside the
              components (silent redirect to /dashboard when the
              admin flag is off). */}
          <Route path="/ai-practice"             element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><AiPracticeQuizList /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/ai-practice/:contentId"  element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><AiPracticeQuizRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* AI-generated notes. Same feature-flag pattern as
              /ai-practice — silent redirect when the admin flag is off. */}
          <Route path="/ai-notes"                element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><AiNotesList /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/ai-notes/:contentId"     element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><AiNotesReader /></LearnerOnlyRoute></ProtectedRoute>} />
          {/* Course-map drill-down — clicking Practise on a subject card
              lands the learner here, with quizzes grouped by topic. */}
          <Route path="/practise/:grade/:subjectId" element={<ProtectedRoute><LearnerOnlyRoute><SubjectDrillDown /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quiz/:quizId"      element={<ProtectedRoute><LearnerOnlyRoute><QuizRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/results/:resultId" element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizResults /></LearnerOnlyRoute></ProtectedRoute>} />
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
          {/* Audit A10 PR 2 — learner-side classroom views. */}
          <Route path="/classes"           element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerClassesList /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/classes/join"      element={<ProtectedRoute><LearnerOnlyRoute><LearnerClassJoin /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/classes/:classId"  element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LearnerClassDetail /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/profile"           element={<ProtectedRoute><Navbar /><ProfilePage /></ProtectedRoute>} />
          <Route path="/settings"          element={<ProtectedRoute><Navbar /><SettingsPage /></ProtectedRoute>} />
          {/* Audit A6 — full-page Zed AI study chat. Auth-gated; the
              floating launcher in App handles the in-context entry
              point but a direct /ask-zed URL is useful for shares. */}
          <Route path="/ask-zed"           element={<ProtectedRoute><ZedChatPage /></ProtectedRoute>} />

          {/* ── Admin routes (all wrapped in AdminLayout) ──────── */}
          <Route path="/admin"                          element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/lessons"                  element={<AdminRoute><AdminNotesList /></AdminRoute>} />
          <Route path="/admin/lessons/new"              element={<AdminRoute><AdminNoteEditor /></AdminRoute>} />
          <Route path="/admin/lessons/:id/edit"         element={<AdminRoute><AdminNoteEditor /></AdminRoute>} />
          <Route path="/admin/quizzes/new"              element={<AdminRoute><CreateQuiz /></AdminRoute>} />
          <Route path="/admin/quizzes/:quizId/edit"     element={<AdminRoute><EditQuiz /></AdminRoute>} />
          <Route path="/admin/import/csv"               element={<AdminRoute><AdminCsvImport /></AdminRoute>} />
          <Route path="/admin/content"                  element={<AdminRoute><ManageContent /></AdminRoute>} />
          <Route path="/admin/approvals"                element={<AdminRoute><ContentApprovals /></AdminRoute>} />
          <Route path="/admin/generations"              element={<AdminRoute><GenerationsAdmin /></AdminRoute>} />
          <Route path="/admin/generations/:id"          element={<AdminRoute><LibraryItemDetail /></AdminRoute>} />
          <Route path="/admin/cbc-kb"                   element={<AdminRoute><CbcKbAdmin /></AdminRoute>} />
          <Route path="/admin/curriculum/replace"       element={<AdminRoute><CurriculumReplaceStudio /></AdminRoute>} />
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
          <Route path="/admin/learners"                 element={<AdminRoute><AdminLearners /></AdminRoute>} />
          <Route path="/admin/learners/:learnerId"      element={<AdminRoute><AdminLearnerProfile /></AdminRoute>} />
          <Route path="/admin/results"                  element={<AdminRoute><AdminResults /></AdminRoute>} />
          <Route path="/admin/payments"                 element={<AdminRoute><PaymentsPanel /></AdminRoute>} />
          <Route path="/admin/demo-trials"              element={<AdminRoute><BulkGrantTrialsPanel /></AdminRoute>} />
          <Route path="/admin/generate/worksheet"       element={<AdminRoute><WorksheetGenerator /></AdminRoute>} />
          <Route path="/admin/generate/flashcards"      element={<AdminRoute><FlashcardGenerator /></AdminRoute>} />
          <Route path="/admin/generate/scheme-of-work"  element={<AdminRoute><SchemeOfWorkGenerator /></AdminRoute>} />
          <Route path="/admin/generate/rubric"          element={<AdminRoute><RubricGenerator /></AdminRoute>} />
          <Route path="/admin/generate/notes"           element={<AdminRoute><NotesStudio /></AdminRoute>} />
          <Route path="/admin/agents"                   element={<AdminRoute><AgentsHome /></AdminRoute>} />
          <Route path="/admin/agents/jobs"              element={<AdminRoute><AgentsAllJobs /></AdminRoute>} />
          <Route path="/admin/agents/jobs/:jobId"       element={<AdminRoute><AgentJobDetail /></AdminRoute>} />
          <Route path="/admin/agents/:agentId"          element={<AdminRoute><AgentProfile /></AdminRoute>} />

          {/* Learner-AI pipeline (parallel to /admin/agents). */}
          <Route path="/admin/learner-ai"                        element={<AdminRoute><LearnerAiHome /></AdminRoute>} />
          <Route path="/admin/learner-ai/tasks/:taskId"          element={<AdminRoute><LearnerAiTaskDetail /></AdminRoute>} />
          <Route path="/admin/learner-ai/logs"                   element={<AdminRoute><LearnerAiLogs /></AdminRoute>} />
          <Route path="/admin/learner-ai/curriculum-updates"     element={<AdminRoute><LearnerAiCurriculumRpts /></AdminRoute>} />
          <Route path="/admin/learner-ai/staged-modules"         element={<AdminRoute><LearnerAiStagedModules /></AdminRoute>} />
          <Route path="/admin/learner-ai/standards"              element={<AdminRoute><LearnerAiStandards /></AdminRoute>} />
          {/* Phase A content-management tabs */}
          <Route path="/admin/learner-ai/practice-quizzes"       element={<AdminRoute><LearnerAiContentType typeFilter="practice_quiz" /></AdminRoute>} />
          <Route path="/admin/learner-ai/exam-quizzes"           element={<AdminRoute><LearnerAiContentType typeFilter="exam_quiz" /></AdminRoute>} />
          <Route path="/admin/learner-ai/exams/:contentId"       element={<AdminRoute><LearnerAiExamDetail /></AdminRoute>} />
          <Route path="/admin/learner-ai/notes-drafts"           element={<AdminRoute><LearnerAiContentType typeFilter="notes" /></AdminRoute>} />
          <Route path="/admin/learner-ai/study-tips"             element={<AdminRoute><LearnerAiContentType typeFilter="study_tips" /></AdminRoute>} />
          <Route path="/admin/learner-ai/feedback"               element={<AdminRoute><LearnerAiContentType typeFilter="learner_feedback" /></AdminRoute>} />
          <Route path="/admin/learner-ai/failed-checks"          element={<AdminRoute><LearnerAiFailedChecks /></AdminRoute>} />
          <Route path="/admin/learner-ai/weakness"               element={<AdminRoute><LearnerAiWeakness /></AdminRoute>} />
          <Route path="/admin/learner-ai/reports"                element={<AdminRoute><LearnerAiReports /></AdminRoute>} />
          <Route path="/admin/learner-ai/settings"               element={<AdminRoute><LearnerAiSettings /></AdminRoute>} />

          {/* ── Teacher routes (all wrapped in TeacherLayout) ─── */}
          {/* Post-upgrade celebration page — full-bleed, outside TeacherLayout chrome */}
          <Route path="/teacher/welcome-to-pro"          element={<ProtectedRoute requiredRole="teacher"><WelcomeToPro /></ProtectedRoute>} />
          <Route path="/teacher"                         element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
          {/* Assessment Studio — teacher-only, private. Replaces the old
              teacher-side quiz creator and `/teacher/content` workflow. */}
          <Route path="/teacher/assessments"                          element={<TeacherRoute><AssessmentList /></TeacherRoute>} />
          <Route path="/teacher/assessments/new"                      element={<TeacherRoute><AssessmentStudio /></TeacherRoute>} />
          <Route path="/teacher/assessments/:assessmentId/edit"       element={<TeacherRoute><EditAssessment /></TeacherRoute>} />
          <Route path="/teacher/lessons"                 element={<TeacherRoute><LessonDashboard /></TeacherRoute>} />
          <Route path="/teacher/lessons/new"             element={<TeacherRoute><LessonEditor /></TeacherRoute>} />
          <Route path="/teacher/lessons/:lessonId/edit"  element={<TeacherRoute><LessonEditor /></TeacherRoute>} />
          <Route path="/teacher/generate/lesson-plan"    element={<ProtectedRoute requiredRole="teacher"><LessonPlanStudio /></ProtectedRoute>} />
          <Route path="/teacher/generate/lesson-plan-cbc" element={<TeacherRoute><LessonPlanGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/curriculum-studio" element={<TeacherRoute><CurriculumStudio /></TeacherRoute>} />
          <Route path="/teacher/generate/full-lesson"    element={<TeacherRoute><FullLessonStudio /></TeacherRoute>} />
          <Route path="/teacher/generate/homework"       element={<TeacherRoute><HomeworkStudio /></TeacherRoute>} />
          <Route path="/teacher/generate/assessment"     element={<TeacherRoute><AssessmentGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/quiz"           element={<TeacherRoute><QuizStudio /></TeacherRoute>} />
          <Route path="/teacher/generate/worksheet"      element={<TeacherRoute><WorksheetGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/flashcards"     element={<TeacherRoute><FlashcardGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/scheme-of-work" element={<TeacherRoute><SchemeOfWorkGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/rubric"          element={<TeacherRoute><RubricGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/notes"           element={<TeacherRoute><NotesStudio /></TeacherRoute>} />
          <Route path="/teacher/library"                 element={<TeacherRoute><TeacherLibrary /></TeacherRoute>} />
          <Route path="/teacher/library/:id"             element={<TeacherRoute><LibraryItemDetail /></TeacherRoute>} />
          <Route path="/teacher/syllabi"                 element={<TeacherRoute><SyllabiLibrary /></TeacherRoute>} />
          <Route path="/teacher/calendar"                element={<TeacherRoute><SchoolCalendar /></TeacherRoute>} />
          <Route path="/teacher/curriculum"              element={<TeacherRoute><CurriculumHome /></TeacherRoute>} />
          <Route path="/teacher/curriculum/primary"      element={<TeacherRoute><PrimaryCurriculum /></TeacherRoute>} />
          <Route path="/teacher/curriculum/secondary"    element={<TeacherRoute><SecondaryCurriculum /></TeacherRoute>} />
          <Route path="/teacher/agents"                  element={<TeacherRoute><TeacherAgentJobsList /></TeacherRoute>} />
          <Route path="/teacher/agents/new"              element={<TeacherRoute><AgentBriefForm /></TeacherRoute>} />
          <Route path="/teacher/agents/:jobId"           element={<TeacherRoute><TeacherAgentJobView /></TeacherRoute>} />
          {/* Audit A10 — class roster foundation. Quiz-assignment +
              class analytics surfaces stack onto these in follow-ups. */}
          <Route path="/teacher/classes"                 element={<TeacherRoute><TeacherClassesList /></TeacherRoute>} />
          <Route path="/teacher/classes/new"             element={<TeacherRoute><TeacherClassEditor /></TeacherRoute>} />
          <Route path="/teacher/classes/:classId"        element={<TeacherRoute><TeacherClassDetail /></TeacherRoute>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </RouteErrorBoundary>
        {/* Paywall — listens for paywall.show(reason, ctx) from anywhere */}
          <PaywallHost />
        </Suspense>
      </div>
      </PlatformSettingsProvider>
    </BrowserRouter>
  )
}
