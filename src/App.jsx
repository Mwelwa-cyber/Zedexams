import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import Navbar from './components/layout/Navbar'
import { getRoleLandingPath } from './utils/navigation'

const Login = lazy(() => import('./components/auth/Login'))
const Register = lazy(() => import('./components/auth/Register'))
const StudentDashboard = lazy(() => import('./components/dashboard/StudentDashboard'))
const GradeHub = lazy(() => import('./components/dashboard/GradeHub'))
const QuizList = lazy(() => import('./components/quiz/QuizList'))
const QuizRunner = lazy(() => import('./components/quiz/QuizRunner'))
const QuizResults = lazy(() => import('./components/quiz/QuizResults'))
const PapersLibrary = lazy(() => import('./components/papers/PapersLibrary'))
const LessonsList = lazy(() => import('./components/lessons/LessonLibrary'))
const LessonView = lazy(() => import('./components/lessons/LessonPlayer'))
const LessonDashboard = lazy(() => import('./components/lessons/LessonDashboard'))
const LessonEditor = lazy(() => import('./components/lessons/LessonEditor'))
const MyResults = lazy(() => import('./components/dashboard/MyResults'))
const BadgesPage = lazy(() => import('./components/dashboard/BadgesPage'))
const ProfilePage = lazy(() => import('./components/dashboard/ProfilePage'))
const FloatingAIAssistant = lazy(() => import('./components/ai/FloatingAIAssistant'))

// Admin section
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'))
const CreateQuiz = lazy(() => import('./components/admin/CreateQuiz'))
const ManageContent = lazy(() => import('./components/admin/ManageContent'))
const AdminResults = lazy(() => import('./components/admin/AdminResults'))
const ContentApprovals = lazy(() => import('./components/admin/ContentApprovals'))
const PaymentsPanel = lazy(() => import('./components/admin/PaymentsPanel'))
const TeacherApplications = lazy(() => import('./components/admin/TeacherApplications'))

// Teacher section
const TeacherLayout = lazy(() => import('./components/teacher/TeacherLayout'))
const TeacherDashboard = lazy(() => import('./components/teacher/TeacherDashboard'))
const TeacherContent = lazy(() => import('./components/teacher/TeacherContent'))
const TeacherPaperUpload = lazy(() => import('./components/teacher/TeacherPaperUpload'))

// Quiz editor (shared by admin + teacher)
const EditQuiz = lazy(() => import('./components/quiz/EditQuiz'))

function RootRedirect() {
  const { currentUser, userProfile, isAdmin, isTeacher } = useAuth()
  if (!currentUser) return <Navigate to="/login" replace />
  if (!userProfile) return <RouteFallback message="Loading your workspace…" />
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

function RouteFallback({ message = 'Loading ZedExams…' }) {
  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-4">
      <div className="theme-card border theme-border rounded-2xl px-5 py-4 shadow-sm text-center">
        <div className="text-3xl mb-2 animate-bounce">📚</div>
        <p className="theme-text font-black">{message}</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* ── Learner routes ─────────────────────────────────── */}
          {/* GradeHub is the new CBC-aligned primary dashboard */}
          <Route path="/dashboard"         element={<ProtectedRoute><GradeHub /></ProtectedRoute>} />
          {/* Legacy stats page (kept for admin/teacher reference) */}
          <Route path="/my-stats"          element={<ProtectedRoute><Navbar /><StudentDashboard /></ProtectedRoute>} />
          <Route path="/quizzes"           element={<ProtectedRoute><Navbar /><QuizList /></ProtectedRoute>} />
          <Route path="/quiz/:quizId"      element={<ProtectedRoute><QuizRunner /></ProtectedRoute>} />
          <Route path="/results/:resultId" element={<ProtectedRoute><Navbar /><QuizResults /></ProtectedRoute>} />
          <Route path="/papers"            element={<ProtectedRoute><Navbar /><PapersLibrary /></ProtectedRoute>} />
          <Route path="/lessons"           element={<ProtectedRoute><Navbar /><LessonsList /></ProtectedRoute>} />
          <Route path="/lessons/:lessonId" element={<ProtectedRoute><Navbar /><LessonView /></ProtectedRoute>} />
          <Route path="/my-results"        element={<ProtectedRoute><Navbar /><MyResults /></ProtectedRoute>} />
          <Route path="/my-badges"         element={<ProtectedRoute><Navbar /><BadgesPage /></ProtectedRoute>} />
          <Route path="/profile"           element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          {/* /teacher is now handled by the TeacherRoute block below */}

          {/* ── Admin routes (all wrapped in AdminLayout) ──────── */}
          <Route path="/admin"                 element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/lessons"                  element={<AdminRoute><LessonDashboard /></AdminRoute>} />
          <Route path="/admin/lessons/new"              element={<AdminRoute><LessonEditor /></AdminRoute>} />
          <Route path="/admin/lessons/:lessonId/edit"   element={<AdminRoute><LessonEditor /></AdminRoute>} />
          <Route path="/admin/quizzes/new"              element={<AdminRoute><CreateQuiz /></AdminRoute>} />
          <Route path="/admin/quizzes/:quizId/edit"     element={<AdminRoute><EditQuiz /></AdminRoute>} />
          <Route path="/admin/papers/upload"            element={<AdminRoute><TeacherPaperUpload /></AdminRoute>} />
          <Route path="/admin/content"                  element={<AdminRoute><ManageContent /></AdminRoute>} />
          <Route path="/admin/approvals"                element={<AdminRoute><ContentApprovals /></AdminRoute>} />
          <Route path="/admin/teacher-applications"     element={<AdminRoute><TeacherApplications /></AdminRoute>} />
          <Route path="/admin/results"                  element={<AdminRoute><AdminResults /></AdminRoute>} />
          <Route path="/admin/payments"                 element={<AdminRoute><PaymentsPanel /></AdminRoute>} />

          {/* ── Teacher routes (all wrapped in TeacherLayout) ─── */}
          <Route path="/teacher"                        element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
          <Route path="/teacher/content"               element={<TeacherRoute><TeacherContent /></TeacherRoute>} />
          <Route path="/teacher/quizzes/new"           element={<TeacherRoute><CreateQuiz /></TeacherRoute>} />
          <Route path="/teacher/quizzes/:quizId/edit"  element={<TeacherRoute><EditQuiz /></TeacherRoute>} />
          <Route path="/teacher/lessons"               element={<TeacherRoute><LessonDashboard /></TeacherRoute>} />
          <Route path="/teacher/lessons/new"           element={<TeacherRoute><LessonEditor /></TeacherRoute>} />
          <Route path="/teacher/lessons/:lessonId/edit" element={<TeacherRoute><LessonEditor /></TeacherRoute>} />
          <Route path="/teacher/papers/upload"         element={<TeacherRoute><TeacherPaperUpload /></TeacherRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <FloatingAIAssistant />
      </Suspense>
    </BrowserRouter>
  )
}
