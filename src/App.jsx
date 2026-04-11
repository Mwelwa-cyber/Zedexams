import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login from './components/auth/Login'
import Register from './components/auth/Register'
import ProtectedRoute from './components/layout/ProtectedRoute'
import Navbar from './components/layout/Navbar'
import StudentDashboard from './components/dashboard/StudentDashboard'
import GradeHub from './components/dashboard/GradeHub'
import QuizList from './components/quiz/QuizList'
import QuizRunner from './components/quiz/QuizRunner'
import QuizResults from './components/quiz/QuizResults'
import PapersLibrary from './components/papers/PapersLibrary'
import LessonsList from './components/lessons/LessonsList'
import LessonView from './components/lessons/LessonView'
import MyResults from './components/dashboard/MyResults'
import BadgesPage from './components/dashboard/BadgesPage'

// Admin section
import AdminLayout from './components/admin/AdminLayout'
import AdminDashboard from './components/admin/AdminDashboard'
import CreateLesson from './components/admin/CreateLesson'
import CreateQuiz from './components/admin/CreateQuiz'
import ManageContent from './components/admin/ManageContent'
import AdminResults from './components/admin/AdminResults'
import ContentApprovals from './components/admin/ContentApprovals'

// Teacher section
import TeacherLayout from './components/teacher/TeacherLayout'
import TeacherDashboard from './components/teacher/TeacherDashboard'
import TeacherContent from './components/teacher/TeacherContent'
import TeacherPaperUpload from './components/teacher/TeacherPaperUpload'

// Quiz editor (shared by admin + teacher)
import EditQuiz from './components/quiz/EditQuiz'

function RootRedirect() {
  const { currentUser, isAdmin, isTeacher } = useAuth()
  if (!currentUser) return <Navigate to="/login" replace />
  if (isAdmin)   return <Navigate to="/admin"   replace />
  if (isTeacher) return <Navigate to="/teacher" replace />
  return <Navigate to="/dashboard" replace />
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

export default function App() {
  return (
    <BrowserRouter>
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
        {/* /teacher is now handled by the TeacherRoute block below */}

        {/* ── Admin routes (all wrapped in AdminLayout) ──────── */}
        <Route path="/admin"                 element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/lessons/new"              element={<AdminRoute><CreateLesson /></AdminRoute>} />
        <Route path="/admin/quizzes/new"              element={<AdminRoute><CreateQuiz /></AdminRoute>} />
        <Route path="/admin/quizzes/:quizId/edit"     element={<AdminRoute><EditQuiz /></AdminRoute>} />
        <Route path="/admin/papers/upload"            element={<AdminRoute><TeacherPaperUpload /></AdminRoute>} />
        <Route path="/admin/content"                  element={<AdminRoute><ManageContent /></AdminRoute>} />
        <Route path="/admin/approvals"                element={<AdminRoute><ContentApprovals /></AdminRoute>} />
        <Route path="/admin/results"                  element={<AdminRoute><AdminResults /></AdminRoute>} />

        {/* ── Teacher routes (all wrapped in TeacherLayout) ─── */}
        <Route path="/teacher"                        element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
        <Route path="/teacher/content"               element={<TeacherRoute><TeacherContent /></TeacherRoute>} />
        <Route path="/teacher/quizzes/new"           element={<TeacherRoute><CreateQuiz /></TeacherRoute>} />
        <Route path="/teacher/quizzes/:quizId/edit"  element={<TeacherRoute><EditQuiz /></TeacherRoute>} />
        <Route path="/teacher/lessons/new"           element={<TeacherRoute><CreateLesson /></TeacherRoute>} />
        <Route path="/teacher/papers/upload"         element={<TeacherRoute><TeacherPaperUpload /></TeacherRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
