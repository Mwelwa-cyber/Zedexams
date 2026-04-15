import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const ROLE_LEVEL = { admin: 3, teacher: 2, learner: 1, student: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userProfile, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center animate-fade-in">
        <div className="text-6xl mb-4">📚</div>
        <p className="text-green-600 font-bold text-xl">Loading ZedExams…</p>
        <div className="mt-4 flex justify-center gap-1">
          {[0,150,300].map(d => (
            <div key={d} className="w-2.5 h-2.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay:`${d}ms` }} />
          ))}
        </div>
      </div>
    </div>
  )

  if (!currentUser) return <Navigate to="/login" replace />

  if (requiredRole && !userProfile) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center"><div className="text-5xl mb-3 animate-bounce">🔐</div><p className="text-gray-500 font-semibold">Checking permissions…</p></div>
    </div>
  )

  if (requiredRole && userProfile) {
    const userLevel     = ROLE_LEVEL[userProfile.role]   ?? 1
    const requiredLevel = ROLE_LEVEL[requiredRole]       ?? 1
    if (userLevel < requiredLevel) return <Navigate to="/dashboard" replace state={{ accessDenied: true }} />
  }

  return children
}
