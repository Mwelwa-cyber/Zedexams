import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LearnerOnlyRoute from './components/auth/LearnerOnlyRoute'
import Navbar from './components/layout/Navbar'
import { getRoleLandingPath } from './utils/navigation'
import PageLoader from './components/ui/PageLoader'

const Login = lazy(() => import('./components/auth/Login'))
const Register = lazy(() => import('./components/auth/Register'))
const StudentDashboard = lazy(() => import('./components/dashboard/StudentDashboard'))
const GradeHub = lazy(() => import('./components/dashboard/GradeHub'))
const QuizList = lazy(() => import('./components/quiz/QuizList'))
const QuizRunner = lazy(() => import('./components/quiz/QuizRunnerV2'))
const QuizResults = lazy(() => import('./components/quiz/QuizResultsV2'))
const LessonsList = lazy(() => import('./components/lessons/LessonLibrary'))
const LessonView = lazy(() => import('./components/lessons/LessonPlayer'))
const LessonDashboard = lazy(() => import('./components/lessons/LessonDashboard'))
const LessonEditor = lazy(() => import('./components/lessons/LessonEditor'))
const MyResults = lazy(() => import('./components/dashboard/MyResults'))
const BadgesPage = lazy(() => import('./components/dashboard/BadgesPage'))
const ProfilePage = lazy(() => import('./components/dashboard/ProfilePage'))
const ZedStudyAssistant = lazy(() => import('./components/ai/ZedStudyAssistant'))
const FloatingZedButton = lazy(() => import('./components/ai/FloatingZedButton'))
const IdleWarningModal = lazy(() => import('./components/auth/IdleWarningModal'))
const NotFound = lazy(() => import('./components/ui/NotFound'))
const Marketing = lazy(() => import('./components/marketing/Marketing'))
const PrivacyPolicy = lazy(() => import('./components/marketing/PrivacyPolicy'))
const Terms = lazy(() => import('./components/marketing/Terms'))

// Admin section
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'))
const CreateQuiz = lazy(() => import('./components/admin/CreateQuizV2'))
const ManageContent = lazy(() => import('./components/admin/ManageContent'))
const AdminResults = lazy(() => import('./components/admin/AdminResults'))
const ContentApprovals = lazy(() => import('./components/admin/ContentApprovals'))
const PaymentsPanel = lazy(() => import('./components/admin/PaymentsPanel'))
const AdminLearners = lazy(() => import('./components/admin/AdminLearners'))
const AdminLearnerProfile = lazy(() => import('./components/admin/AdminLearnerProfile'))
const GenerationsAdmin = lazy(() => import('./components/admin/GenerationsAdmin'))
const CbcKbAdmin = lazy(() => import('./components/admin/CbcKbAdmin'))
const ZedVoice = lazy(() => import('./components/admin/ZedVoice'))

// Teacher section
const TeacherLayout = lazy(() => import('./components/teacher/TeacherLayout'))
const TeacherDashboard = lazy(() => import('./components/teacher/TeacherDashboard'))
const TeacherContent = lazy(() => import('./components/teacher/TeacherContent'))

// Teacher — AI Generators
const LessonPlanGenerator = lazy(() => import('./components/teacher/generate/LessonPlanGenerator'))
const LessonPlanStudio = lazy(() => import('./components/teacher/generate/LessonPlanStudio'))
const WorksheetGenerator = lazy(() => import('./components/teacher/generate/WorksheetGenerator'))
const FlashcardGenerator = lazy(() => import('./components/teacher/generate/FlashcardGenerator'))
const SchemeOfWorkGenerator = lazy(() => import('./components/teacher/generate/SchemeOfWorkGenerator'))
const RubricGenerator = lazy(() => import('./components/teacher/generate/RubricGenerator'))

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
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/welcome"  element={<Marketing />} />
          <Route path="/privacy"  element={<PrivacyPolicy />} />
          <Route path="/terms"    element={<Terms />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Public share link — no auth, read-only viewer of a frozen snapshot */}
          <Route path="/share/:token"             element={<PublicShareView />} />

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
          <Route path="/dashboard-preview" element={<GradeHub />} />
          {/* Legacy stats page (kept for admin/teacher reference) */}
          <Route path="/my-stats"          element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><StudentDashboard /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exams"                        element={<ProtectedRoute><LearnerOnlyRoute><DailyExamsHub /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exams/leaderboard"           element={<ProtectedRoute><LearnerOnlyRoute><ExamLeaderboardPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exam/:examId"                element={<ProtectedRoute><LearnerOnlyRoute><DailyExamRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/exam-results/:attemptId"     element={<ProtectedRoute><LearnerOnlyRoute><ExamResultsPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quizzes"           element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizList /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/quiz/:quizId"      element={<ProtectedRoute><LearnerOnlyRoute><QuizRunner /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/results/:resultId" element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><QuizResults /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/lessons"           element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LessonsList /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/lessons/:lessonId" element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><LessonView /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/my-results"        element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><MyResults /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/my-badges"         element={<ProtectedRoute><LearnerOnlyRoute><Navbar /><BadgesPage /></LearnerOnlyRoute></ProtectedRoute>} />
          <Route path="/profile"           element={<ProtectedRoute><Navbar /><ProfilePage /></ProtectedRoute>} />
          <Route path="/study"             element={<ProtectedRoute><LearnerOnlyRoute><ZedStudyAssistant /></LearnerOnlyRoute></ProtectedRoute>} />

          {/* ── Admin routes (all wrapped in AdminLayout) ──────── */}
          <Route path="/admin"                          element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/lessons"                  element={<AdminRoute><LessonDashboard /></AdminRoute>} />
          <Route path="/admin/lessons/new"              element={<AdminRoute><LessonEditor /></AdminRoute>} />
          <Route path="/admin/lessons/:lessonId/edit"   element={<AdminRoute><LessonEditor /></AdminRoute>} />
          <Route path="/admin/quizzes/new"              element={<AdminRoute><CreateQuiz /></AdminRoute>} />
          <Route path="/admin/quizzes/:quizId/edit"     element={<AdminRoute><EditQuiz /></AdminRoute>} />
          <Route path="/admin/content"                  element={<AdminRoute><ManageContent /></AdminRoute>} />
          <Route path="/admin/approvals"                element={<AdminRoute><ContentApprovals /></AdminRoute>} />
          <Route path="/admin/generations"              element={<AdminRoute><GenerationsAdmin /></AdminRoute>} />
          <Route path="/admin/generations/:id"          element={<AdminRoute><LibraryItemDetail /></AdminRoute>} />
          <Route path="/admin/cbc-kb"                   element={<AdminRoute><CbcKbAdmin /></AdminRoute>} />
          <Route path="/admin/zed-voice"                element={<AdminRoute><ZedVoice /></AdminRoute>} />
          <Route path="/admin/games-seed"               element={<AdminRoute><GamesSeedAdmin /></AdminRoute>} />
          <Route path="/admin/learners"                 element={<AdminRoute><AdminLearners /></AdminRoute>} />
          <Route path="/admin/learners/:learnerId"      element={<AdminRoute><AdminLearnerProfile /></AdminRoute>} />
          <Route path="/admin/results"                  element={<AdminRoute><AdminResults /></AdminRoute>} />
          <Route path="/admin/payments"                 element={<AdminRoute><PaymentsPanel /></AdminRoute>} />
          <Route path="/admin/generate/lesson-plan"     element={<AdminRoute><LessonPlanGenerator /></AdminRoute>} />
          <Route path="/admin/generate/worksheet"       element={<AdminRoute><WorksheetGenerator /></AdminRoute>} />
          <Route path="/admin/generate/flashcards"      element={<AdminRoute><FlashcardGenerator /></AdminRoute>} />
          <Route path="/admin/generate/scheme-of-work"  element={<AdminRoute><SchemeOfWorkGenerator /></AdminRoute>} />
          <Route path="/admin/generate/rubric"          element={<AdminRoute><RubricGenerator /></AdminRoute>} />

          {/* ── Teacher routes (all wrapped in TeacherLayout) ─── */}
          <Route path="/teacher"                         element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
          <Route path="/teacher/content"                 element={<TeacherRoute><TeacherContent /></TeacherRoute>} />
          <Route path="/teacher/quizzes/new"             element={<TeacherRoute><CreateQuiz /></TeacherRoute>} />
          <Route path="/teacher/quizzes/:quizId/edit"    element={<TeacherRoute><EditQuiz /></TeacherRoute>} />
          <Route path="/teacher/lessons"                 element={<TeacherRoute><LessonDashboard /></TeacherRoute>} />
          <Route path="/teacher/lessons/new"             element={<TeacherRoute><LessonEditor /></TeacherRoute>} />
          <Route path="/teacher/lessons/:lessonId/edit"  element={<TeacherRoute><LessonEditor /></TeacherRoute>} />
          <Route path="/teacher/generate/lesson-plan"    element={<ProtectedRoute requiredRole="teacher"><LessonPlanStudio /></ProtectedRoute>} />
          <Route path="/teacher/generate/worksheet"      element={<TeacherRoute><WorksheetGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/flashcards"     element={<TeacherRoute><FlashcardGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/scheme-of-work" element={<TeacherRoute><SchemeOfWorkGenerator /></TeacherRoute>} />
          <Route path="/teacher/generate/rubric"          element={<TeacherRoute><RubricGenerator /></TeacherRoute>} />
          <Route path="/teacher/library"                 element={<TeacherRoute><TeacherLibrary /></TeacherRoute>} />
          <Route path="/teacher/library/:id"             element={<TeacherRoute><LibraryItemDetail /></TeacherRoute>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
        {/* Floating "Ask Zed" button — self-gates visibility per route */}
        <FloatingZedButton />
        {/* Inactivity warning + auto-logout (driven by AuthContext) */}
        <IdleWarningModal />
      </Suspense>
    </BrowserRouter>
  )
}
